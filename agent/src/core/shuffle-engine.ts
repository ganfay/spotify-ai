// Pure, dependency-free True Shuffle deck engine, URI normalizer, and LRU storage.
// Runs in startup core (spotify-ai-core.js) and in Node unit tests without DOM dependencies.

export const SHUFFLE_STORAGE_KEY = "spotify-ai:true-shuffle:v1";
export const DEFAULT_MAX_CONTEXTS = 4;
/** Saved decks share local storage with chats, undo points and the background picture: keep them small. */
export const MAX_SAVED_CHARS = 300_000;

export type ShuffleCycleMode = "off" | "spotify" | "true";
export interface ShuffleTrack { uri: string; uid?: string; isPlayable?: boolean; isLocal?: boolean; }
export interface ShuffleDeckState { contextUri: string; order: ShuffleTrack[]; cursor: number; updatedAt: number; }
export type ShuffleStorage = Pick<Storage, "getItem" | "setItem">;
export interface TrueShuffleOptions { storage?: ShuffleStorage | null; storageKey?: string; maxContexts?: number; rng?: () => number; now?: () => number; }
export interface PrepareDeckOptions { forceReshuffle?: boolean; }
export interface PeekOptions { wrap?: boolean; }
interface PersistedStateV1 { version: 1; mode: ShuffleCycleMode; decks: ShuffleDeckState[]; }

const sanitizeMode = (raw: unknown): ShuffleCycleMode => (raw === "off" || raw === "spotify" || raw === "true" ? raw : "off");
const clamp01 = (rng: () => number): number => { const v = rng(); return !Number.isFinite(v) || v < 0 ? 0 : v >= 1 ? 1 - Number.EPSILON : v; };
const copyTrack = (t: ShuffleTrack): ShuffleTrack => ({ uri: t.uri, ...(typeof t.uid === "string" && t.uid ? { uid: t.uid } : {}), ...(t.isLocal === true ? { isLocal: true } : {}) });
const filterPlayable = (tracks: readonly ShuffleTrack[]): ShuffleTrack[] => tracks.reduce<ShuffleTrack[]>((acc, r) => {
  const uri = r && typeof r === "object" && typeof r.uri === "string" ? r.uri.trim() : "";
  if (uri && r.isPlayable !== false) acc.push(copyTrack({ ...r, uri }));
  return acc;
}, []);
const cloneDeck = (d: ShuffleDeckState): ShuffleDeckState => ({ ...d, order: d.order.map(copyTrack) });

function findTrackIndex(order: readonly ShuffleTrack[], target: ShuffleTrack): number {
  const uri = typeof target.uri === "string" ? target.uri.trim() : "";
  const uid = typeof target.uid === "string" && target.uid ? target.uid : "";
  let fallback = -1;
  for (let i = 0; uri && i < order.length; i++) {
    const t = order[i]!;
    if (t.uri !== uri) continue;
    if (uid ? t.uid === uid : !t.uid) return i;
    if (fallback === -1 && (!uid || !t.uid)) fallback = i;
  }
  return fallback;
}

function reshuffleForNextCycle(order: readonly ShuffleTrack[], last: ShuffleTrack, rng: () => number): ShuffleTrack[] {
  if (order.length <= 1) return order.map(copyTrack);
  const next = fisherYatesShuffle(order, rng).map(copyTrack);
  const first = next[0];
  if (!first || first.uri !== last.uri) return next;
  const pick = (pred: (t: ShuffleTrack) => boolean) => {
    const cand = next.flatMap((t, i) => (i > 0 && pred(t) ? [i] : []));
    if (!cand.length) return false;
    const j = cand[Math.floor(clamp01(rng) * cand.length)]!;
    [next[0], next[j]] = [next[j]!, first];
    return true;
  };
  if (!pick((t) => t.uri !== last.uri) && last.uid && first.uid === last.uid) pick((t) => t.uid !== last.uid);
  return next;
}

export const nextCycleMode = (current: ShuffleCycleMode): ShuffleCycleMode =>
  current === "off" ? "spotify" : current === "spotify" ? "true" : "off";
export function fisherYatesShuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i >= 1; i--) { const j = Math.floor(clamp01(rng) * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}
export function normalizeContextUri(uri: string): string {
  const s = String(uri ?? "").trim().replace(/\/+$/, "");
  return !s ? "" : /^spotify:(?:user:[^:]+:)?collection(?::tracks)?$/i.test(s) ? "spotify:collection:tracks" : s;
}

export class TrueShuffleEngine {
  private readonly storage: ShuffleStorage | null;
  private readonly storageKey: string;
  private readonly maxContexts: number;
  private readonly rng: () => number;
  private readonly now: () => number;
  private mode: ShuffleCycleMode = "off";
  private readonly decks = new Map<string, ShuffleDeckState>();
  private readonly pending = new Map<string, ShuffleTrack[][]>();

  constructor(options?: TrueShuffleOptions | ShuffleStorage) {
    const opts: TrueShuffleOptions = options && "getItem" in options ? { storage: options } : (options ?? {});
    this.storage = opts.storage !== undefined ? opts.storage : (() => { try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch { return null; } })();
    this.storageKey = opts.storageKey || SHUFFLE_STORAGE_KEY;
    this.maxContexts = opts.maxContexts !== undefined && Number.isFinite(opts.maxContexts) ? Math.max(0, Math.floor(opts.maxContexts)) : DEFAULT_MAX_CONTEXTS;
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? Date.now;
    this.load();
  }
  getMode(): ShuffleCycleMode { return this.mode; }
  cycleMode(): ShuffleCycleMode { return this.setMode(nextCycleMode(this.mode)); }
  setMode(mode: ShuffleCycleMode): ShuffleCycleMode {
    const v = sanitizeMode(mode);
    if (v === this.mode) return this.mode;
    this.mode = v; this.persist(); return this.mode;
  }
  getDeck(contextUri: string): ShuffleDeckState | null {
    const d = this.decks.get(normalizeContextUri(contextUri));
    return d ? cloneDeck(d) : null;
  }
  prepareDeck(contextUri: string, tracks: readonly ShuffleTrack[], currentTrack?: ShuffleTrack | null, options?: PrepareDeckOptions): ShuffleDeckState {
    const ctx = normalizeContextUri(contextUri);
    if (!ctx) return { contextUri: "", order: [], cursor: 0, updatedAt: this.now() };
    if (this.decks.get(ctx) && !options?.forceReshuffle) return this.syncTracks(ctx, tracks, currentTrack);
    const order = fisherYatesShuffle(filterPlayable(tracks), this.rng);
    const idx = currentTrack && order.length > 1 ? findTrackIndex(order, currentTrack) : -1;
    if (idx > 0) [order[0], order[idx]] = [order[idx]!, order[0]!];
    const deck: ShuffleDeckState = { contextUri: ctx, order, cursor: 0, updatedAt: this.now() };
    this.saveDeck(deck, true);
    return cloneDeck(deck);
  }
  syncTracks(contextUri: string, tracks: readonly ShuffleTrack[], currentTrack?: ShuffleTrack | null): ShuffleDeckState {
    const ctx = normalizeContextUri(contextUri), existing = ctx ? this.decks.get(ctx) : undefined;
    if (!ctx || !existing?.order.length) return this.prepareDeck(ctx, tracks, currentTrack, { forceReshuffle: true });
    const playable = filterPlayable(tracks), byUri = new Map<string, number[]>();
    playable.forEach((t, i) => (byUri.get(t.uri) ?? byUri.set(t.uri, []).get(t.uri)!).push(i));
    const used = new Uint8Array(playable.length), matched: Array<ShuffleTrack | null> = new Array(existing.order.length).fill(null);
    for (const strict of [true, false]) {
      existing.order.forEach((old, i) => {
        if (matched[i] || (strict && !old.uid)) return;
        const pIdx = byUri.get(old.uri)?.find((j) => !used[j] && (strict ? playable[j]!.uid === old.uid : !old.uid || !playable[j]!.uid));
        if (pIdx !== undefined) { used[pIdx] = 1; matched[i] = playable[pIdx]!; }
      });
    }
    const surviving = matched.filter((m): m is ShuffleTrack => m !== null).map(copyTrack);
    const added = playable.filter((_, i) => !used[i]).map(copyTrack);
    if (!surviving.length) return this.prepareDeck(ctx, added, currentTrack, { forceReshuffle: true });
    const nextCursor = Math.min(matched.slice(0, existing.cursor).filter(Boolean).length, surviving.length - 1);
    const nextOrder = added.length ? [...surviving.slice(0, nextCursor + 1), ...fisherYatesShuffle([...surviving.slice(nextCursor + 1), ...added], this.rng)] : surviving;
    const deck: ShuffleDeckState = { contextUri: ctx, order: nextOrder, cursor: nextCursor, updatedAt: this.now() };
    if (currentTrack && deck.order.length) {
      const idx = findTrackIndex(deck.order, currentTrack);
      if (idx !== -1 && idx !== deck.cursor) this.moveToCursor(deck, idx);
    }
    this.saveDeck(deck, true);
    return cloneDeck(deck);
  }
  current(contextUri: string): ShuffleTrack | null { const d = this.deckFor(contextUri); return d ? copyTrack(d.order[d.cursor]!) : null; }
  peekNext(contextUri: string, count = 1, options?: PeekOptions): ShuffleTrack[] {
    const limit = Math.floor(count), d = limit > 0 ? this.deckFor(contextUri) : undefined;
    if (!d) return [];
    const out = d.order.slice(d.cursor + 1, d.cursor + 1 + limit).map(copyTrack);
    if (!options?.wrap || out.length >= limit) return out;
    const cycles = this.pending.get(d.contextUri) ?? (this.pending.set(d.contextUri, []), this.pending.get(d.contextUri)!);
    for (let c = 0, prevLast = d.order[d.order.length - 1]!; out.length < limit; c++) {
      const cycle = cycles[c] ?? (cycles[c] = reshuffleForNextCycle(c ? cycles[c - 1]! : d.order, prevLast, this.rng));
      for (let i = 0; i < cycle.length && out.length < limit; i++) out.push(copyTrack(cycle[i]!));
      prevLast = cycle[cycle.length - 1]!;
    }
    return out;
  }
  advance(contextUri: string): ShuffleTrack | null {
    const d = this.deckFor(contextUri);
    if (!d) return null;
    if (d.order.length === 1) d.cursor = 0;
    else if (d.cursor + 1 < d.order.length) d.cursor += 1;
    else {
      const cached = this.pending.get(d.contextUri);
      d.order = cached?.length ? cached.shift()! : reshuffleForNextCycle(d.order, d.order[d.order.length - 1]!, this.rng);
      if (cached && !cached.length) this.pending.delete(d.contextUri);
      d.cursor = 0;
    }
    this.saveDeck(d); return copyTrack(d.order[d.cursor]!);
  }
  previous(contextUri: string): ShuffleTrack | null {
    const d = this.deckFor(contextUri);
    if (!d || d.cursor <= 0) return null;
    d.cursor -= 1; this.saveDeck(d); return copyTrack(d.order[d.cursor]!);
  }
  jumpToTrack(contextUri: string, track: ShuffleTrack): ShuffleTrack | null {
    const d = this.deckFor(contextUri), idx = d ? findTrackIndex(d.order, track) : -1;
    if (!d || idx === -1) return null;
    if (idx !== d.cursor) { this.moveToCursor(d, idx); this.saveDeck(d, true); }
    return copyTrack(d.order[d.cursor]!);
  }
  clearDeck(contextUri: string): boolean {
    const ctx = normalizeContextUri(contextUri);
    this.pending.delete(ctx);
    const had = Boolean(ctx && this.decks.delete(ctx));
    if (had) this.persist();
    return had;
  }
  clearAllDecks(): void { if (this.decks.size) { this.decks.clear(); this.pending.clear(); this.persist(); } }
  reset(): void { if (this.mode !== "off" || this.decks.size) { this.mode = "off"; this.decks.clear(); this.pending.clear(); this.persist(); } }
  private deckFor(uri: string): ShuffleDeckState | undefined { const d = this.decks.get(normalizeContextUri(uri)); return d?.order.length ? d : undefined; }
  private moveToCursor(deck: ShuffleDeckState, idx: number): void {
    const [picked] = deck.order.splice(idx, 1);
    if (!picked) return;
    deck.order.splice(idx > deck.cursor ? deck.cursor + 1 : deck.cursor, 0, picked);
    if (idx > deck.cursor) deck.cursor += 1;
  }
  private saveDeck(deck: ShuffleDeckState, clearPending = false): void {
    if (clearPending) this.pending.delete(deck.contextUri);
    deck.updatedAt = this.now();
    this.decks.delete(deck.contextUri);
    if (this.maxContexts > 0) {
      while (this.decks.size >= this.maxContexts) {
        const oldest = this.decks.keys().next().value;
        if (oldest === undefined) break;
        this.decks.delete(oldest); this.pending.delete(oldest);
      }
      this.decks.set(deck.contextUri, deck);
    }
    this.persist();
  }
  private load(): void {
    let data: Partial<PersistedStateV1> | null = null;
    try { const raw = this.storage?.getItem(this.storageKey); if (raw) data = JSON.parse(raw); } catch { return; }
    if (!data || typeof data !== "object" || data.version !== 1) return;
    this.mode = sanitizeMode(data.mode);
    if (!Array.isArray(data.decks) || this.maxContexts <= 0) return;
    (data.decks as Array<Partial<ShuffleDeckState> | null>)
      .reduce<ShuffleDeckState[]>((acc, d) => {
        const ctx = d && typeof d === "object" && typeof d.contextUri === "string" ? normalizeContextUri(d.contextUri) : "";
        if (!ctx || !Array.isArray(d?.order)) return acc;
        const order = filterPlayable(d.order as ShuffleTrack[]), rawC = typeof d.cursor === "number" && Number.isFinite(d.cursor) ? Math.floor(d.cursor) : 0;
        acc.push({ contextUri: ctx, order, cursor: order.length ? Math.max(0, Math.min(rawC, order.length - 1)) : 0, updatedAt: typeof d.updatedAt === "number" && Number.isFinite(d.updatedAt) ? d.updatedAt : 0 });
        return acc;
      }, [])
      .sort((a, b) => a.updatedAt - b.updatedAt).slice(-this.maxContexts)
      .forEach((deck) => { this.decks.delete(deck.contextUri); this.decks.set(deck.contextUri, deck); });
  }
  private persist(): void {
    if (!this.storage) return;
    const decks = this.maxContexts <= 0 ? [] : Array.from(this.decks.values()).slice(-this.maxContexts);
    for (;;) {
      const text = JSON.stringify({ version: 1, mode: this.mode, decks });
      // Oldest decks go first; a deck too big on its own is kept in memory only (it is reshuffled after a restart).
      if (text.length > MAX_SAVED_CHARS && decks.length) { decks.shift(); continue; }
      try { this.storage.setItem(this.storageKey, text); return; }
      catch { if (!decks.length) return; decks.shift(); }
    }
  }
}
