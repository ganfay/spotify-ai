// True Shuffle controller for Spotify desktop's player-bar Shuffle button.
// Consumes ONLY ./shuffle-engine and ./shuffle-texts so dist/spotify-ai-core.js stays tiny.
// Uses internal Spotify client APIs only — never public Web API or network/telemetry patching.

import { type ShuffleCycleMode, type ShuffleStorage, type ShuffleTrack, TrueShuffleEngine, nextCycleMode, normalizeContextUri } from "./shuffle-engine";
import { type CoreLang, SHUFFLE_TEXTS, detectCoreLang } from "./shuffle-texts";

export const TRUE_SHUFFLE_STYLE_ID = "sai-true-shuffle-style";
const NON_MUSIC_TYPES = new Set(["episode", "ad", "podcast_chapter", "chapter"]);
const TOOLTIP_EVENTS = ["mouseover", "mouseout", "focusin", "focusout"] as const;
const TRUE_SHUFFLE_CSS = `button[data-sai-shuffle-mode="true"]{position:relative!important;color:var(--sai-true-shuffle-accent,var(--sai-cyan,#22d3ee))!important;--encore-icon-fill:currentColor}button[data-sai-shuffle-mode="true"] svg{color:currentColor!important;fill:currentColor!important}button[data-sai-shuffle-mode="true"]::before{content:"\\221E";position:absolute;top:2px;right:2px;font-size:9px;font-weight:700;line-height:1;letter-spacing:-0.02em;pointer-events:none;color:currentColor}button[data-sai-shuffle-mode="true"]::after{content:"";position:absolute;bottom:0;left:50%;width:4px;height:4px;border-radius:50%;transform:translateX(-50%);background-color:currentColor;pointer-events:none}button[data-sai-shuffle-mode][aria-disabled="true"],button[data-sai-shuffle-mode]:disabled{opacity:.45!important}`;

export interface TrueShuffleControllerDeps {
  engine?: TrueShuffleEngine; win?: Partial<Window> & Record<string, any>; doc?: Document; spicetify?: any;
  storage?: ShuffleStorage | null; styleId?: string; queueLookahead?: number; now?: () => number; MutationObserver?: typeof MutationObserver;
}
export interface TrueShuffleHandle { destroy(): void; getMode(): ShuffleCycleMode; refresh(): Promise<void>; }
interface ButtonStateLike { item?: { type?: string } | null; shuffle?: boolean | null; smartShuffle?: boolean | null; restrictions?: { canToggleShuffle?: boolean } | null; }
const NOOP_HANDLE: TrueShuffleHandle = { destroy() {}, getMode: () => "off", refresh: async () => {} };

const pickLang = (v: unknown): CoreLang | null => { const c = typeof v === "string" ? v.trim().slice(0, 2).toLowerCase() : ""; return c === "en" || c === "uk" || c === "ru" || c === "de" ? c : null; };
const resolveLang = (storage?: Pick<Storage, "getItem">, sp?: any, win?: Record<string, any>): CoreLang => {
  try { const ov = pickLang(JSON.parse(storage?.getItem?.("spotify-ai:settings") || "{}")?.language); if (ov) return ov; } catch {}
  try { return (!sp && !win ? detectCoreLang(storage) : pickLang(sp?.Locale?.getLocale?.() || sp?.Platform?.Session?.locale || win?.navigator?.language)) ?? "en"; } catch { return "en"; }
};
export function getShuffleTooltipText(mode: ShuffleCycleMode, options?: { smartShuffle?: boolean; unavailable?: boolean; lang?: CoreLang; storage?: Pick<Storage, "getItem"> }): string {
  const texts = SHUFFLE_TEXTS[options?.lang ?? resolveLang(options?.storage)] ?? SHUFFLE_TEXTS.en;
  if (options?.unavailable) return texts.unavailable;
  return mode === "true" ? texts.trueShuffle : mode === "spotify" ? (options?.smartShuffle ? texts.smartShuffle : texts.spotify) : texts.off;
}

const isNonMusic = (item: { type?: unknown } | null | undefined) => typeof item?.type === "string" && NON_MUSIC_TYPES.has(item.type);
const matches = (el: unknown, sel: string): boolean => { try { return Boolean((el as Element)?.matches?.(sel)); } catch { return false; } };

export function findShuffleButton(root: ParentNode, state?: ButtonStateLike | null): HTMLButtonElement | null {
  if (!root || isNonMusic(state?.item)) return null;
  const left = matches(root, ".player-controls__left") ? (root as Element)
    : root.querySelector?.(".main-nowPlayingBar-center .player-controls__left") ?? root.querySelector?.(".player-controls__left") ?? null;
  const center = (matches(root, ".main-nowPlayingBar-center") ? (root as Element) : null) ??
    root.querySelector?.(".main-nowPlayingBar-center") ?? left?.closest?.(".main-nowPlayingBar-center") ?? left;
  const excl = '[data-testid="ad-controls"], [data-testid="control-button-seek-back-15"]';
  if (!left || left.closest?.('[data-testid="ad-controls"]') || center?.querySelector?.(excl) || left.querySelector?.(excl)) return null;
  const explicit = left.querySelector?.('[data-testid="control-button-shuffle"]');
  if (explicit) return explicit as HTMLButtonElement;
  const skipBack = left.querySelector?.('[data-testid="control-button-skip-back"]');
  if (!skipBack) return null;
  const btns = Array.from(left.querySelectorAll?.("button") ?? []), skipIdx = btns.indexOf(skipBack as HTMLButtonElement);
  const valid = (Array.from(left.querySelectorAll?.('button[data-encore-id="buttonTertiary"]') ?? []) as HTMLButtonElement[])
    .filter((c) => !["control-button-skip-back", "control-button-seek-back-15"].includes(c.getAttribute?.("data-testid") ?? ""));
  return valid.find((c) => { const i = btns.indexOf(c); return skipIdx !== -1 && i !== -1 && i < skipIdx; }) ?? valid[0] ?? null;
}

const isUnavailable = (btn: HTMLButtonElement | null, state?: ButtonStateLike | null) =>
  !btn || btn.disabled || btn.getAttribute?.("aria-disabled") === "true" || state?.restrictions?.canToggleShuffle === false;
const normalizeDeckContextUri = (rawUri: string): string => {
  const s = String(rawUri ?? "").trim().replace(/\/+$/, "");
  const m = /^spotify:list:popular-release-segments-main-roles:artist_([^/?#]+)$/i.exec(s);
  return m?.[1] ? `spotify:artist:${m[1]}` : normalizeContextUri(s);
};
const isSynthUid = (u?: string) => Boolean(u && /^q[0-9a-f]{16}$/i.test(u));
const toTrackId = (raw: any): ShuffleTrack | null => {
  const uri = typeof raw?.uri === "string" ? raw.uri.trim() : "";
  return uri ? (typeof raw.uid === "string" && raw.uid && !isSynthUid(raw.uid) ? { uri, uid: raw.uid } : { uri }) : null;
};
const isSameTrack = (a?: ShuffleTrack | null, b?: ShuffleTrack | null) =>
  Boolean(a?.uri && b?.uri && a.uri === b.uri && (!a.uid || !b.uid || isSynthUid(a.uid) || isSynthUid(b.uid) || a.uid === b.uid));
const isQueued = (it: any) =>
  Boolean(it && typeof it === "object" && (it.provider === "queue" || (it.provider !== "context" && (it.metadata?.is_queued === "true" || it.contextTrack?.metadata?.is_queued === "true"))));
const toRev = (rev: unknown): unknown => typeof rev === "bigint" ? rev :
  (typeof rev === "number" && Number.isFinite(rev)) || (typeof rev === "string" && /^\d+$/.test(rev))
    ? (typeof BigInt === "function" ? BigInt(typeof rev === "number" ? Math.trunc(rev) : rev) : rev) : (rev ?? 0);
const progressMs = (s: any, now: number) => Math.max(0,
  (typeof s?.positionAsOfTimestamp === "number" && Number.isFinite(s.positionAsOfTimestamp) ? s.positionAsOfTimestamp : 0) +
  (s?.isPaused ? 0 : Math.max(0, now - (typeof s?.timestamp === "number" && Number.isFinite(s.timestamp) ? s.timestamp : now))));

function mapItems(raw: any, forceLocal = false): ShuffleTrack[] | null {
  const items = Array.isArray(raw) ? raw : raw?.items;
  if (!Array.isArray(items)) return null;
  return items.reduce<ShuffleTrack[]>((acc, item) => {
    if (!item || typeof item !== "object") return acc;
    const t = item.track && typeof item.track === "object" ? item.track : item;
    const uri = typeof t.uri === "string" ? t.uri.trim() : typeof item.uri === "string" ? item.uri.trim() : "";
    if (!uri || NON_MUSIC_TYPES.has(t.type ?? item.type)) return acc;
    const uid = typeof item.uid === "string" && item.uid ? item.uid : typeof t.uid === "string" && t.uid ? t.uid : undefined;
    acc.push({ uri, isPlayable: t.playability?.playable !== false && t.isPlayable !== false && item.isPlayable !== false, ...(uid ? { uid } : {}), ...(forceLocal || t.isLocal || item.isLocal || uri.startsWith("spotify:local:") ? { isLocal: true } : {}) });
    return acc;
  }, []);
}

let activeSingleton: { doc: Document; handle: TrueShuffleHandle } | null = null;
const winDoc = (d?: TrueShuffleControllerDeps) => [
  d?.win ?? (typeof window !== "undefined" ? (window as unknown as Partial<Window> & Record<string, any>) : undefined),
  d?.doc ?? (typeof document !== "undefined" ? document : undefined),
] as const;

export function createTrueShuffleController(deps?: TrueShuffleControllerDeps): TrueShuffleHandle {
  const [win, doc] = winDoc(deps);
  if (!win || !doc) return NOOP_HANDLE;
  const storage = deps?.storage !== undefined ? deps.storage : (() => { try { const ls = win.localStorage; return ls && typeof ls.getItem === "function" && typeof ls.setItem === "function" ? ls : null; } catch { return null; } })();
  const nowFn = deps?.now ?? Date.now, styleId = deps?.styleId || TRUE_SHUFFLE_STYLE_ID;
  const bufferSize = Number.isFinite(deps?.queueLookahead) ? Math.max(1, Math.min(20, Math.floor(deps!.queueLookahead!))) : 8;
  const engine = deps?.engine ?? new TrueShuffleEngine({ storage, now: nowFn });
  const ObserverCtor = deps?.MutationObserver ?? (win.MutationObserver as typeof MutationObserver | undefined);
  const getSp = () => (typeof deps?.spicetify === "function" ? deps.spicetify() : deps?.spicetify ?? win.Spicetify);
  const getPlayerApi = () => getSp()?.Platform?.PlayerAPI;
  const getBarRoot = () => doc.querySelector?.(".main-nowPlayingBar-center") ?? doc.querySelector?.(".Root__now-playing-bar") ?? doc;

  let destroyed = false, isApplyingDom = false, runtimeActive = false, queueBufferSupported = true;
  let activeDeckCtx = "", fetchGeneration = 0, suppressExternalUntil = 0, isInternalShuffleWrite = false;
  let isInternalSkip = false, syncInProgress = false, pendingResync = false, wasPlayingQueued = false;
  let lastTrack: ShuffleTrack | null = null, pendingSkip: ShuffleTrack | null = null, pendingSkipUntil = 0;
  let recentSkips: ShuffleTrack[] = [], readinessTimer: ReturnType<typeof setInterval> | null = null;
  let observer: MutationObserver | null = null, observedNode: Node | null = null, clickBox: EventTarget | null = null;
  let boundBtn: HTMLButtonElement | null = null, boundTippy: { setContent?: (c: string) => void; destroy?: () => void } | null = null;
  let boundTipListener: ((e: Event) => void) | null = null, hasOverriddenLabel = engine.getMode() !== "off";
  let styleEl: HTMLStyleElement | null = null, playerBound = false, shuffleBound = false;
  const unsubs: Array<() => void> = [];

  const stopTimer = () => { if (readinessTimer) { clearInterval(readinessTimer); readinessTimer = null; } };
  const resetPending = () => { fetchGeneration++; runtimeActive = false; pendingSkip = null; recentSkips = []; };
  const displayMode = (s: ButtonStateLike | null | undefined): ShuffleCycleMode =>
    engine.getMode() === "true" ? "true" : s ? (s.shuffle || s.smartShuffle ? "spotify" : "off") : engine.getMode();
  const exitToSpotify = (s?: ButtonStateLike | null) => { resetPending(); engine.setMode("spotify"); syncButtonUi(s); attach(); };

  const ensureStyle = () => {
    if (destroyed) return;
    let el = doc.getElementById?.(styleId) as HTMLStyleElement | null;
    if (!el) { el = doc.createElement("style") as HTMLStyleElement; el.id = styleId; (doc.head ?? doc.documentElement)?.appendChild?.(el); }
    if (el.textContent !== TRUE_SHUFFLE_CSS) el.textContent = TRUE_SHUFFLE_CSS;
    styleEl = el;
  };
  const cleanupBoundBtn = () => {
    if (boundBtn && boundTipListener) TOOLTIP_EVENTS.forEach((ev) => boundBtn?.removeEventListener?.(ev, boundTipListener!));
    boundTipListener = null; try { boundTippy?.destroy?.(); } catch {} boundTippy = null;
    if (boundBtn) { isApplyingDom = true; try { boundBtn.removeAttribute?.("data-sai-shuffle-mode"); } finally { isApplyingDom = false; } }
    boundBtn = null;
  };
  const syncButtonUi = (stateOverride?: ButtonStateLike | null) => {
    if (destroyed) return;
    const sp = getSp(), state = stateOverride ?? sp?.Platform?.PlayerAPI?.getState?.() ?? null, btn = findShuffleButton(getBarRoot(), state);
    if (!btn) { if (boundBtn) cleanupBoundBtn(); return; }
    const mode = displayMode(state), unavailable = isUnavailable(btn, state), shouldLabel = hasOverriddenLabel || mode !== "off" || unavailable;
    const label = shouldLabel ? getShuffleTooltipText(mode, { smartShuffle: Boolean(state?.smartShuffle), unavailable, lang: resolveLang(storage ?? undefined, sp, win) }) : null;
    if (boundBtn !== btn) {
      cleanupBoundBtn(); boundBtn = btn;
      boundTipListener = (ev: Event) => { if (displayMode(getPlayerApi()?.getState?.() ?? state) === "true" || boundTippy !== null) ev.stopPropagation?.(); };
      TOOLTIP_EVENTS.forEach((ev) => btn.addEventListener?.(ev, boundTipListener!));
    }
    if (shouldLabel && label !== null && !boundTippy && typeof sp?.Tippy === "function") {
      try { boundTippy = sp.Tippy(btn, { ...(sp.TippyProps ?? {}), content: label }); } catch { boundTippy = null; }
    }
    isApplyingDom = true;
    try {
      if (btn.getAttribute?.("data-sai-shuffle-mode") !== mode) btn.setAttribute?.("data-sai-shuffle-mode", mode);
      if (label !== null && btn.getAttribute?.("aria-label") !== label) btn.setAttribute?.("aria-label", label);
    } finally { isApplyingDom = false; }
    if (label !== null) try { boundTippy?.setContent?.(label); } catch {}
  };
  const setNativeShuffle = async (rawCtx: string, mode: 0 | 1 | 2) => {
    const sp = getSp(), shuffleApi = sp?.Platform?.ShuffleAPI, playerApi = sp?.Platform?.PlayerAPI;
    suppressExternalUntil = nowFn() + 1500; isInternalShuffleWrite = true;
    try {
      if (typeof shuffleApi?.setShuffle === "function" && rawCtx) await shuffleApi.setShuffle(rawCtx, mode);
      else if (typeof playerApi?.setShuffle === "function") await playerApi.setShuffle(mode !== 0);
    } catch {} finally { isInternalShuffleWrite = false; suppressExternalUntil = nowFn() + 1500; }
  };
  const fetchContextTracks = async (rawCtx: string, normCtx: string, gen: number): Promise<ShuffleTrack[] | null> => {
    if (!normCtx || /^spotify:(?:station|show|episode|audiobook|track):/.test(normCtx) || normCtx === "spotify:collection:your-episodes") return null;
    const sp = getSp(), plat = sp?.Platform, gql = sp?.GraphQL, defs = gql?.Definitions;
    const fetchGql = async (def: any, vars: Record<string, any>, pick: (d: any) => any) => {
      if (typeof gql?.Request !== "function" || !def) return null;
      const out: ShuffleTrack[] = [];
      for (let page = 0, offset = 0; page < 20; page++) {
        const res = await gql.Request(def, { ...vars, offset, limit: 200, locale: "" });
        if (gen !== fetchGeneration || destroyed) return null;
        const c = pick(res?.data), mapped = mapItems(c?.items);
        if (!mapped?.length) break;
        out.push(...mapped);
        offset = typeof c?.pagingInfo?.nextOffset === "number" && c.pagingInfo.nextOffset > offset ? c.pagingInfo.nextOffset : -1;
        if (offset < 0) break;
      }
      return out;
    };
    try {
      const isLocal = /^spotify:(?:internal:|collection:)?local-files$/.test(normCtx), isLiked = normCtx === "spotify:collection:tracks";
      if (isLiked || isLocal || normCtx.startsWith("spotify:playlist:") || /^spotify:user:[^:]+:playlist:/.test(normCtx)) {
        const res = await (isLiked ? plat?.LibraryAPI?.getTracks?.({ limit: 9_999_999 }) : isLocal ? plat?.LocalFilesAPI?.getTracks?.() : plat?.PlaylistAPI?.getContents?.(rawCtx, { limit: 9_999_999 }));
        return gen !== fetchGeneration || destroyed ? null : mapItems(res, isLocal);
      }
      if (normCtx.startsWith("spotify:album:")) return await fetchGql(defs?.getAlbumNameAndTracks ?? defs?.queryAlbumTracks ?? defs?.getAlbum, { uri: normCtx }, (d) => d?.albumUnion?.tracksV2 ?? d?.albumUnion?.tracks);
      if (normCtx.startsWith("spotify:artist:")) return await fetchGql(defs?.getArtistNameAndTracks ?? defs?.queryArtistOverview, { uri: normCtx, preReleaseV2: false }, (d) => d?.artistUnion?.discography?.topTracks);
      return null;
    } catch { return null; }
  };
  const syncRollingQueue = async (): Promise<void> => {
    if (destroyed || engine.getMode() !== "true" || !runtimeActive || !activeDeckCtx) return;
    if (syncInProgress) { pendingResync = true; return; }
    const playerApi = getPlayerApi(), state = playerApi?.getState?.(), reasons = state?.restrictions?.disallowSetQueueReasons;
    const queueObj = playerApi?._queue, setQueueFn = queueObj?._client?.setQueue;
    if ((Array.isArray(reasons) && reasons.length) || !queueBufferSupported || typeof queueObj?.getInternalQueue !== "function" || typeof setQueueFn !== "function") { queueBufferSupported = false; return; }
    if (typeof queueObj.createQueueItem === "function" && pendingSkip && nowFn() < pendingSkipUntil) { pendingResync = true; return; }
    syncInProgress = true;
    try {
      const expected = engine.peekNext(activeDeckCtx, bufferSize, { wrap: state?.repeat === 1 }), internal = queueObj.getInternalQueue();
      if (!internal || !Array.isArray(internal.nextTracks)) return;
      const hasLiveQ = typeof queueObj.createQueueItem === "function";
      const ctxPrefix = internal.nextTracks.filter((it: any) => { const u = it?.contextTrack?.uri ?? it?.uri ?? ""; return !isQueued(it) && u !== "spotify:delimiter" && u !== "spotify:meta:delimiter"; });
      if (hasLiveQ
        ? (ctxPrefix.length >= Math.min(3, expected.length) && ctxPrefix.length <= expected.length && ctxPrefix.every((it: any, i: number) => isSameTrack(toTrackId(it?.contextTrack ?? it), expected[i])))
        : (ctxPrefix.length === expected.length && expected.every((t, i) => isSameTrack(toTrackId(ctxPrefix[i]?.contextTrack ?? ctxPrefix[i]), t)))) return;
      const toQItem = (t: ShuffleTrack) => hasLiveQ
        ? queueObj.createQueueItem(t, false)
        : { contextTrack: { uri: t.uri, ...(t.uid ? { uid: t.uid } : {}), metadata: { is_queued: "false" } }, provider: "context" };
      const build = (src: any) => ({
        nextTracks: [...(src?.nextTracks ?? []).filter(isQueued), ...expected.map(toQItem)],
        prevTracks: src?.prevTracks ?? [], queueRevision: toRev(src?.queueRevision),
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        const src = attempt === 0 ? internal : queueObj.getInternalQueue();
        if (!src || !Array.isArray(src.nextTracks)) break;
        try { await setQueueFn.call(queueObj._client, build(src)); return; }
        catch (err: any) { if (attempt > 0 || !/QUEUE_REVISION_MISMATCH/i.test(String(err?.message ?? err?.code ?? err ?? ""))) break; }
      }
      queueBufferSupported = false;
    } finally {
      syncInProgress = false;
      if (pendingResync && !destroyed && engine.getMode() === "true" && runtimeActive && !(typeof queueObj?.createQueueItem === "function" && pendingSkip && nowFn() < pendingSkipUntil)) { pendingResync = false; void syncRollingQueue(); } else if (!pendingSkip) pendingResync = false;
    }
  };
  const skipToProgrammatic = (track: ShuffleTrack) => {
    const playerApi = getPlayerApi();
    if (typeof playerApi?.skipTo !== "function") return;
    if (pendingSkip) { recentSkips.push(pendingSkip); if (recentSkips.length > 20) recentSkips.shift(); }
    pendingSkip = track; pendingSkipUntil = nowFn() + 2000; isInternalSkip = true;
    try {
      const hasLiveQueue = typeof playerApi?._queue?.createQueueItem === "function";
      const internal = playerApi?._queue?.getInternalQueue?.()?.nextTracks;
      const qMatch = hasLiveQueue && Array.isArray(internal)
        ? internal.find((it: any) => !isQueued(it) && (it?.contextTrack?.uri ?? it?.uri) === track.uri)
        : null;
      if (hasLiveQueue && !qMatch && typeof playerApi?.play === "function") {
        const rawCtx = playerApi.getState?.()?.context?.uri || activeDeckCtx;
        const res = playerApi.play({ uri: rawCtx }, {}, { skipTo: track.uid ? { uri: track.uri, uid: track.uid } : { uri: track.uri } });
        if (res?.then) void res.catch(() => {});
        return;
      }
      const qUid = qMatch?.contextTrack?.uid;
      const arg = typeof qUid === "string" && qUid ? { uri: track.uri, uid: qUid } : track.uid ? { uri: track.uri, uid: track.uid } : { uri: track.uri };
      const res = playerApi.skipTo(arg);
      if (res?.then) void res.catch(() => {});
    } finally { isInternalSkip = false; }
  };
  const activateContext = async (rawCtx: string, initialState?: any): Promise<void> => {
    const gen = ++fetchGeneration, normCtx = normalizeDeckContextUri(rawCtx);
    activeDeckCtx = normCtx; runtimeActive = false;
    if (!normCtx || isNonMusic(initialState?.item) || initialState?.restrictions?.canToggleShuffle === false) { syncButtonUi(initialState); return; }
    await setNativeShuffle(rawCtx, 0);
    if (gen !== fetchGeneration || destroyed || engine.getMode() !== "true") return;
    const tracks = await fetchContextTracks(rawCtx, normCtx, gen);
    if (gen !== fetchGeneration || destroyed || engine.getMode() !== "true") return;
    const latest = getPlayerApi()?.getState?.() ?? initialState;
    if ((latest?.context?.uri ? normalizeDeckContextUri(latest.context.uri) : "") !== normCtx) return;
    const cur = latest?.item ? toTrackId(latest.item) : null;
    if (!tracks?.length) { if (tracks === null) activeDeckCtx = ""; runtimeActive = false; syncButtonUi(latest); return; }
    if (engine.prepareDeck(normCtx, tracks, cur).order.length <= 1) { runtimeActive = false; syncButtonUi(latest); return; }
    lastTrack = cur; wasPlayingQueued = isQueued(latest?.item); runtimeActive = true;
    syncButtonUi(latest); await syncRollingQueue();
  };
  const onPlayerUpdate = (ev?: any) => {
    if (destroyed) return;
    const state = ev?.data && typeof ev.data === "object" && ("item" in ev.data || "context" in ev.data) ? ev.data : getPlayerApi()?.getState?.();
    syncButtonUi(state);
    if (engine.getMode() !== "true") { runtimeActive = false; return; }
    if (!state) return;
    const rawCtx = typeof state.context?.uri === "string" ? state.context.uri : "", normCtx = rawCtx ? normalizeDeckContextUri(rawCtx) : "";
    if (!state.hasContext || !normCtx || isNonMusic(state.item) || state.restrictions?.canToggleShuffle === false) { runtimeActive = false; activeDeckCtx = ""; return; }
    // Context switch MUST run before external-shuffle check so cached Spotify shuffle on a new context does not exit True Shuffle.
    if (normCtx !== activeDeckCtx) { resetPending(); wasPlayingQueued = false; lastTrack = state.item ? toTrackId(state.item) : null; void activateContext(rawCtx, state); return; }
    if ((state.shuffle === true || state.smartShuffle === true) && !isInternalShuffleWrite && nowFn() >= suppressExternalUntil) { exitToSpotify(state); return; }
    const item = state.item;
    if (!item || isNonMusic(item) || item.metadata?.is_transition_preview === "true" || item.provider === "autoplay" || !runtimeActive) return;
    if (isQueued(item)) { wasPlayingQueued = true; lastTrack = toTrackId(item); return; }
    const newTrack = toTrackId(item);
    if (!newTrack) return;
    if (lastTrack && isSameTrack(newTrack, lastTrack)) {
      if (pendingSkip && isSameTrack(newTrack, pendingSkip)) { pendingSkip = null; recentSkips = []; void syncRollingQueue(); }
      return;
    }
    lastTrack = newTrack;
    const syncDone = () => { wasPlayingQueued = false; void syncRollingQueue(); };
    if (pendingSkip) {
      if (isSameTrack(newTrack, pendingSkip)) { pendingSkip = null; recentSkips = []; syncDone(); return; }
      if (nowFn() < pendingSkipUntil && recentSkips.some((t) => isSameTrack(newTrack, t))) return;
      pendingSkip = null; recentSkips = [];
    }
    if (isSameTrack(newTrack, engine.current(activeDeckCtx))) { syncDone(); return; }
    const expNext = engine.peekNext(activeDeckCtx, 1, { wrap: state.repeat === 1 })[0];
    if (expNext && isSameTrack(newTrack, expNext)) { engine.advance(activeDeckCtx); syncDone(); return; }
    if (!queueBufferSupported && wasPlayingQueued && expNext) {
      wasPlayingQueued = false; const adv = engine.advance(activeDeckCtx);
      if (adv) { lastTrack = toTrackId(adv) ?? adv; skipToProgrammatic(adv); }
      return;
    }
    engine.jumpToTrack(activeDeckCtx, newTrack); syncDone();
  };
  const stepDeck = (t: ShuffleTrack | null) => { if (!t) return; lastTrack = toTrackId(t) ?? t; wasPlayingQueued = false; skipToProgrammatic(t); void syncRollingQueue(); };
  const onPlayerAction = (ev: any) => {
    if (destroyed || engine.getMode() !== "true" || !runtimeActive || !activeDeckCtx) return;
    const action = ev?.data?.action ?? ev?.action, playerApi = getPlayerApi(), state = playerApi?.getState?.();
    if (isNonMusic(state?.item)) return;
    if (action === "skipToNext" && !isInternalSkip) {
      const internal = playerApi?._queue?.getInternalQueue?.()?.nextTracks;
      const hasQ = Array.isArray(internal) ? internal.some(isQueued) : Boolean(playerApi?.getQueue?.()?.queued?.length);
      const exp0 = engine.peekNext(activeDeckCtx, 1, { wrap: state?.repeat === 1 })[0];
      const nativeFrontReady = typeof playerApi?._queue?.createQueueItem === "function" && Array.isArray(internal) && exp0 && isSameTrack(toTrackId(internal[0]?.contextTrack ?? internal[0]), exp0);
      if (!hasQ && exp0 && !nativeFrontReady) { ev?.preventDefault?.(); stepDeck(engine.advance(activeDeckCtx)); }
    } else if (action === "skipToPrevious" && !wasPlayingQueued && !isQueued(state?.item) && progressMs(state, nowFn()) <= 3000) {
      const deck = engine.getDeck(activeDeckCtx);
      if (deck && deck.cursor > 0) { ev?.preventDefault?.(); stepDeck(engine.previous(activeDeckCtx)); }
    }
  };
  const onShuffleEvent = (ev?: any) => {
    if (destroyed) return;
    const state = getPlayerApi()?.getState?.(); syncButtonUi(state);
    if (engine.getMode() !== "true" || isInternalShuffleWrite || nowFn() < suppressExternalUntil) return;
    const data = ev?.data ?? ev, evCtx = typeof data?.contextURI === "string" ? normalizeDeckContextUri(data.contextURI) : activeDeckCtx;
    if ((!activeDeckCtx || !evCtx || evCtx === activeDeckCtx) && (data?.shuffleMode === 1 || data?.shuffleMode === 2)) exitToSpotify(state);
  };
  const onClickCapture = (ev: Event) => {
    // Listens on the whole document, so most clicks must leave at once.
    if (destroyed || !ev.target || !(ev.target as Element).closest?.(".player-controls__left")) return;
    const state = getPlayerApi()?.getState?.(), btn = findShuffleButton(getBarRoot(), state);
    if (!btn || (btn !== ev.target && !btn.contains?.(ev.target as Node))) return;
    ev.preventDefault?.(); ev.stopPropagation?.(); ev.stopImmediatePropagation?.();
    hasOverriddenLabel = true;
    if (isUnavailable(btn, state)) { syncButtonUi(state); return; }
    // Spotify's own order is kept and True Shuffle comes last: off -> shuffle -> Smart Shuffle (where
    // Spotify offers it) -> True Shuffle -> off.
    const cur = displayMode(state), rawCtx = typeof state?.context?.uri === "string" ? state.context.uri : "";
    const smartNext = cur === "spotify" && !state?.smartShuffle && state?.restrictions?.canToggleSmartShuffle === true;
    const nextMode = smartNext ? "spotify" : nextCycleMode(cur);
    if (nextMode === "true") {
      engine.setMode("true"); syncButtonUi({ ...state, shuffle: false, smartShuffle: false });
      // Activate first: it marks our own shuffle change, so the watcher started next does not take it for the user's.
      if (state?.hasContext && rawCtx) void activateContext(rawCtx, state); else runtimeActive = false;
      attach();
    } else {
      resetPending(); engine.setMode(nextMode); void setNativeShuffle(rawCtx, smartNext ? 2 : nextMode === "spotify" ? 1 : 0);
      attach();
    }
  };
  // Watching the player costs a little on every update, so it runs only while True Shuffle is on.
  const stopLive = () => {
    observer?.disconnect(); observer = null; observedNode = null;
    for (const u of unsubs) try { u(); } catch {}
    unsubs.length = 0; playerBound = false; shuffleBound = false; cleanupBoundBtn();
    resetPending(); activeDeckCtx = "";
  };
  const sub = (em: any, pairs: Array<[string, (e: any) => void]>) => {
    if (typeof em?.addListener !== "function") return false;
    for (const [e, fn] of pairs) { const u = em.addListener(e, fn); unsubs.push(typeof u === "function" ? u : () => em.removeListener?.(e, fn)); }
    return true;
  };
  const attach = (): boolean => {
    if (destroyed) return true;
    if (!clickBox) { clickBox = doc; clickBox.addEventListener?.("click", onClickCapture, true); }
    if (engine.getMode() !== "true") { if (playerBound || shuffleBound || observer || boundBtn) stopLive(); return true; }
    const center = doc.querySelector?.(".main-nowPlayingBar-center"), barRoot = center ?? doc.querySelector?.(".Root__now-playing-bar");
    if (barRoot) {
      if (ObserverCtor && observedNode !== barRoot) {
        observer?.disconnect();
        observer = new ObserverCtor(() => { if (!destroyed && !isApplyingDom) { const up = doc.querySelector?.(".main-nowPlayingBar-center"); if (up && observedNode !== up) attach(); else syncButtonUi(); } });
        observer.observe(barRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label", "aria-disabled", "disabled", "data-sai-shuffle-mode"] });
        observedNode = barRoot;
      }
      syncButtonUi();
    }
    const sp = getSp();
    const apiReady = Boolean(sp?.Platform?.PlayerAPI && sp?.Platform?.PlaylistAPI);
    if (!playerBound && apiReady) playerBound = sub(sp?.Platform?.PlayerAPI?.getEvents?.(), [["update", onPlayerUpdate], ["action", onPlayerAction], ["queue_update", () => { if (!destroyed && engine.getMode() === "true" && runtimeActive && activeDeckCtx) void syncRollingQueue(); }]]);
    if (!shuffleBound && apiReady) shuffleBound = sub(sp?.Platform?.ShuffleAPI?.getEvents?.(), [["update", onShuffleEvent], ["update_complete", onShuffleEvent]]);
    if (playerBound) onPlayerUpdate();
    return Boolean(center) && playerBound && apiReady;
  };

  ensureStyle();
  if (!attach()) {
    let tries = 0;
    readinessTimer = setInterval(() => { if (destroyed) { stopTimer(); return; } ensureStyle(); if (attach() || ++tries > 120) stopTimer(); }, 500);
    (readinessTimer as unknown as { unref?: () => void })?.unref?.();
  }
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true; resetPending(); stopTimer(); observer?.disconnect(); observer = null; observedNode = null;
      clickBox?.removeEventListener?.("click", onClickCapture, true); clickBox = null; cleanupBoundBtn();
      for (const u of unsubs) try { u(); } catch {}
      unsubs.length = 0; try { styleEl?.remove?.(); } catch {} styleEl = null;
      if (activeSingleton?.handle === this) activeSingleton = null;
    },
    getMode: () => engine.getMode(),
    async refresh() {
      if (destroyed) return;
      ensureStyle(); attach();
      const state = getPlayerApi()?.getState?.(); syncButtonUi(state);
      if (engine.getMode() === "true" && state?.hasContext && state?.context?.uri) await activateContext(state.context.uri, state);
    },
  };
}

export function initTrueShuffle(deps?: TrueShuffleControllerDeps): TrueShuffleHandle {
  const [win, doc] = winDoc(deps);
  if (!win || !doc) return NOOP_HANDLE;
  if (activeSingleton && activeSingleton.doc === doc) return activeSingleton.handle;
  if (activeSingleton) { activeSingleton.handle.destroy(); activeSingleton = null; }
  const handle = createTrueShuffleController({ ...deps, win, doc });
  activeSingleton = { doc, handle };
  return handle;
}
