import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TRUE_SHUFFLE_STYLE_ID, createTrueShuffleController, findShuffleButton, getShuffleTooltipText, initTrueShuffle } from "../src/core/shuffle-controller";
import { SHUFFLE_STORAGE_KEY, type ShuffleStorage, type ShuffleTrack, TrueShuffleEngine } from "../src/core/shuffle-engine";
import { SHUFFLE_TEXTS } from "../src/core/shuffle-texts";

class MockEvent {
  target: El | null = null; currentTarget: El | null = null;
  defaultPrevented = false; propagationStopped = false; immediatePropagationStopped = false;
  constructor(readonly type: string, readonly bubbles = true) {}
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
  stopImmediatePropagation() { this.propagationStopped = true; this.immediatePropagationStopped = true; }
}
function matchPart(el: El, part: string): boolean {
  let rest = part.trim(); if (!rest) return false;
  const tag = /^[a-zA-Z][a-zA-Z0-9_-]*/.exec(rest);
  if (tag) { if (el.tagName !== tag[0].toUpperCase()) return false; rest = rest.slice(tag[0].length); }
  while (rest) {
    let m: RegExpExecArray | null;
    if ((m = /^#([A-Za-z0-9_-]+)/.exec(rest))) { if (el.getAttribute("id") !== m[1]) return false; rest = rest.slice(m[0].length); }
    else if ((m = /^\.([A-Za-z0-9_-]+)/.exec(rest))) { if (!el.className.split(/\s+/).includes(m[1]!)) return false; rest = rest.slice(m[0].length); }
    else if ((m = /^\[([A-Za-z0-9_-]+)(?:="([^"]*)")?\]/.exec(rest))) {
      const v = el.getAttribute(m[1]!); if (m[2] !== undefined ? v !== m[2] : v === null) return false; rest = rest.slice(m[0].length);
    } else if (rest.startsWith(":disabled")) { if (!el.disabled) return false; rest = rest.slice(9); } else return false;
  }
  return true;
}
const matchSel = (el: El, sel: string): boolean => sel.split(",").map((s) => s.trim()).filter(Boolean).some((b) => {
  const toks = b.split(/\s+/); if (!matchPart(el, toks[toks.length - 1]!)) return false;
  let cur = el.parentElement, i = toks.length - 2;
  while (i >= 0 && cur) { if (matchPart(cur, toks[i]!)) i--; cur = cur.parentElement; }
  return i < 0;
});
class El {
  readonly tagName: string; readonly children: El[] = []; readonly attrs = new Map<string, string>();
  readonly listeners = new Map<string, Array<{ fn: (e: any) => void; cap: boolean }>>();
  parentElement: El | null = null; ownerDocument: MockDoc | null = null; textContent = ""; disabled = false;
  constructor(tag: string, doc?: MockDoc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc ?? null; }
  set id(v: string) { this.setAttribute("id", v); }
  get className() { return this.attrs.get("class") ?? ""; } set className(v: string) { this.setAttribute("class", v); }
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); this.ownerDocument?.notify("attributes", this, k); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  removeAttribute(k: string) { this.attrs.delete(k); this.ownerDocument?.notify("attributes", this, k); }
  appendChild<T extends El>(c: T): T { if (c.parentElement) c.remove(); c.parentElement = this; c.ownerDocument = this.ownerDocument; this.children.push(c); this.ownerDocument?.notify("childList", this); return c; }
  remove() { const p = this.parentElement; if (!p) return; const i = p.children.indexOf(this); if (i !== -1) p.children.splice(i, 1); this.parentElement = null; this.ownerDocument?.notify("childList", p); }
  contains(n: unknown): boolean { return n === this || this.children.some((c) => c.contains(n)); }
  matches(s: string) { return matchSel(this, s); }
  closest(s: string) { for (let c: El | null = this; c; c = c.parentElement) if (matchSel(c, s)) return c; return null; }
  querySelector(s: string) { return this.querySelectorAll(s)[0] ?? null; }
  querySelectorAll(s: string): El[] { const out: El[] = []; const w = (n: El) => { for (const c of n.children) { if (matchSel(c, s)) out.push(c); w(c); } }; w(this); return out; }
  getElementById(id: string) { return this.querySelector(`#${id}`); }
  addEventListener(t: string, fn: (e: any) => void, cap = false) { const a = this.listeners.get(t) ?? []; a.push({ fn, cap: Boolean(cap) }); this.listeners.set(t, a); }
  removeEventListener(t: string, fn: (e: any) => void, cap = false) { const a = this.listeners.get(t); if (a) this.listeners.set(t, a.filter((l) => !(l.fn === fn && l.cap === Boolean(cap)))); }
  dispatchEvent(ev: MockEvent): boolean {
    ev.target = this; const anc: El[] = []; for (let c = this.parentElement; c; c = c.parentElement) anc.unshift(c);
    const run = (n: El, list: Array<{ fn: (e: any) => void; cap: boolean }>) => { ev.currentTarget = n; for (const l of list) { l.fn(ev); if (ev.immediatePropagationStopped) break; } };
    for (const a of anc) { if (ev.propagationStopped) break; run(a, (a.listeners.get(ev.type) ?? []).filter((l) => l.cap)); }
    if (!ev.propagationStopped) run(this, [...(this.listeners.get(ev.type) ?? [])]);
    if (ev.bubbles && !ev.propagationStopped) for (let i = anc.length - 1; i >= 0 && !ev.propagationStopped; i--) run(anc[i]!, (anc[i]!.listeners.get(ev.type) ?? []).filter((l) => !l.cap));
    return !ev.defaultPrevented;
  }
}
class MockDoc extends El {
  readonly head: El; readonly body: El; readonly documentElement: El; readonly observers = new Set<MockObserver>();
  constructor() {
    super("#document"); this.ownerDocument = this; this.documentElement = new El("html", this); this.head = new El("head", this); this.body = new El("body", this);
    this.documentElement.appendChild(this.head); this.documentElement.appendChild(this.body); this.appendChild(this.documentElement);
  }
  createElement(tag: string) { return new El(tag, this); }
  notify(type: string, target: El, attributeName?: string) { for (const o of this.observers) o.record({ type, target, attributeName }); }
}
class MockObserver {
  observedTarget: El | null = null; opts: any = null; disconnected = false;
  constructor(private readonly cb: (r: any[], o: MockObserver) => void) {}
  observe(t: El, opts?: any) { this.disconnected = false; this.observedTarget = t; this.opts = opts; t.ownerDocument?.observers.add(this); }
  disconnect() { this.disconnected = true; this.observedTarget?.ownerDocument?.observers.delete(this); }
  record(rec: { type: string; target: El; attributeName?: string }) {
    if (this.disconnected || !this.observedTarget?.contains(rec.target)) return;
    if (rec.type === "attributes" && Array.isArray(this.opts?.attributeFilter) && !this.opts.attributeFilter.includes(rec.attributeName)) return;
    this.cb([rec], this);
  }
}

const memStore = (init?: Record<string, string>): ShuffleStorage & { data: Map<string, string>; reads: number; writes: number } => {
  const data = new Map(Object.entries(init ?? {}));
  const s = { data, reads: 0, writes: 0, getItem: (k: string) => (s.reads++, data.get(k) ?? null), setItem: (k: string, v: string) => { s.writes++; data.set(k, v); } };
  return s;
};
const makeTracks = (n: number, pfx = "t"): ShuffleTrack[] => Array.from({ length: n }, (_, i) => ({ uri: `spotify:track:${pfx}${i}`, uid: `u_${pfx}_${i}`, isPlayable: true }));
const trkItem = (t: { uri: string; uid?: string }, extra?: Record<string, any>) => ({ type: "track", uri: t.uri, uid: t.uid, provider: "context", metadata: {}, ...extra });
function createDom(mode: "modern" | "legacy" | "podcast" | "ad" = "modern") {
  const doc = new MockDoc(), rootBar = doc.body.appendChild(doc.createElement("footer")), center = rootBar.appendChild(doc.createElement("div"));
  rootBar.className = "Root__now-playing-bar"; center.className = "main-nowPlayingBar-center";
  const controls = center.appendChild(doc.createElement("div")), left = controls.appendChild(doc.createElement("div"));
  controls.className = "player-controls__buttons"; controls.setAttribute("data-testid", mode === "ad" ? "ad-controls" : "general-controls");
  left.className = "player-controls__left";
  let shuffleBtn: El | null = null, shuffleSvg: El | null = null;
  if (mode === "modern" || mode === "legacy") {
    shuffleBtn = left.appendChild(doc.createElement("button"));
    shuffleBtn.setAttribute(mode === "modern" ? "data-encore-id" : "data-testid", mode === "modern" ? "buttonTertiary" : "control-button-shuffle");
    shuffleBtn.setAttribute("aria-label", "Enable shuffle"); shuffleBtn.setAttribute("aria-disabled", "false");
    shuffleSvg = shuffleBtn.appendChild(doc.createElement("svg"));
  } else if (mode === "podcast") {
    const sb = left.appendChild(doc.createElement("button")); sb.setAttribute("data-testid", "control-button-seek-back-15"); sb.setAttribute("data-encore-id", "buttonTertiary");
  }
  const skipBack = left.appendChild(doc.createElement("button"));
  skipBack.setAttribute("data-testid", "control-button-skip-back"); skipBack.setAttribute("data-encore-id", "buttonTertiary");
  return { doc, win: { MutationObserver: MockObserver, navigator: { language: "en-US" } } as Record<string, any>, rootBar, center, left, shuffleBtn, shuffleSvg };
}
class Emitter {
  private readonly map = new Map<string, Set<(e: any) => void>>();
  addListener(n: string, fn: (e: any) => void) { const s = this.map.get(n) ?? new Set(); s.add(fn); this.map.set(n, s); return () => s.delete(fn); }
  emit(n: string, data?: any) { for (const fn of this.map.get(n) ?? []) fn({ type: n, data }); }
  emitSync(n: string, data: any) { const ev = { type: n, data, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const fn of this.map.get(n) ?? []) fn(ev); return ev.defaultPrevented; }
}
function createMockSpicetify(opts?: Record<string, any>) {
  const playerEvents = new Emitter(), shuffleEvents = new Emitter(), setQueueCalls: any[] = [], skipToCalls: any[] = [];
  const setShuffleApiCalls: Array<{ ctx: string; mode: number }> = [], playlistFetchCalls: string[] = [], libraryFetchCalls: any[] = [];
  const graphqlCalls: any[] = [], tippyInstances: Array<{ el: any; content: string; destroyed: boolean }> = [];
  let rev = 1, nextTracks: any[] = [], failNext: Error | null = null;
  let state: any = { timestamp: 1000, positionAsOfTimestamp: 0, isPaused: false, repeat: 0, shuffle: false, smartShuffle: false, hasContext: Boolean(opts?.contextUri), context: { uri: opts?.contextUri ?? "" }, item: opts?.initialTrack ?? trkItem({ uri: "spotify:track:p0", uid: "u_p_0" }), restrictions: { canToggleShuffle: true, disallowSetQueueReasons: opts?.disallowSetQueueReasons ?? [] } };
  const setQueue = async (payload: any) => {
    if (failNext) { const e = failNext; failNext = null; throw e; }
    setQueueCalls.push(payload); nextTracks = (payload.nextTracks ?? []).map((x: any) => ({ ...x })); rev++;
    playerEvents.emit("queue_update", { current: state.item, queued: nextTracks.filter((i) => i.provider === "queue"), nextUp: nextTracks.filter((i) => i.provider !== "queue") });
  };
  const sp: any = {
    Locale: { getLocale: () => (typeof opts?.locale === "function" ? opts.locale() : opts?.locale ?? "en") },
    TippyProps: { delay: [200, 0] },
    Tippy(el: any, props: any) { const rec = { el, content: String(props?.content ?? ""), destroyed: false }; tippyInstances.push(rec); return { setContent(c: string) { rec.content = c; }, destroy() { rec.destroyed = true; } }; },
    GraphQL: {
      Definitions: { getAlbumNameAndTracks: { name: "alb" }, getArtistNameAndTracks: { name: "art" } },
      async Request(def: any, vars: any) {
        graphqlCalls.push({ def, vars });
        if (def?.name === "alb") {
          const items = opts?.albumPages?.[vars.uri] ?? [], o = vars.offset ?? 0, l = vars.limit ?? 200, slice = items.slice(o, o + l);
          return { data: { albumUnion: { tracksV2: { items: slice, pagingInfo: { nextOffset: o + slice.length < items.length ? o + slice.length : null } } } } };
        }
        return def?.name === "art" ? { data: { artistUnion: { discography: { topTracks: { items: opts?.artistPages?.[vars.uri] ?? [], pagingInfo: { nextOffset: null } } } } } } : { data: {} };
      },
    },
    Platform: {
      PlayerAPI: {
        getState: () => state, getEvents: () => playerEvents,
        async setShuffle(on: boolean) { state.shuffle = on; state.smartShuffle = false; },
        async skipTo(t: any) { if (playerEvents.emitSync("action", { action: "skipToNext" })) return; skipToCalls.push(t); state.item = trkItem(t); playerEvents.emit("update", state); },
        skipToNext() {
          if (playerEvents.emitSync("action", { action: "skipToNext" })) return true;
          if (nextTracks.length) { const n = nextTracks.shift()!, ct = n.contextTrack ?? n; state.item = trkItem(ct, { provider: n.provider ?? "context", metadata: ct.metadata ?? {} }); playerEvents.emit("update", state); }
          return false;
        },
        skipToPrevious: () => playerEvents.emitSync("action", { action: "skipToPrevious" }),
        getQueue: () => ({ current: state.item, queued: nextTracks.filter((i) => i.provider === "queue"), nextUp: nextTracks.filter((i) => i.provider !== "queue") }),
        _queue: { getInternalQueue: () => ({ track: state.item, nextTracks, prevTracks: [], queueRevision: String(rev) }), _client: opts?.setQueueAvailable === false ? {} : { setQueue } },
      },
      ShuffleAPI: { getEvents: () => shuffleEvents, async setShuffle(ctx: string, mode: number) { setShuffleApiCalls.push({ ctx, mode }); shuffleEvents.emit("update", { contextURI: ctx, shuffleMode: mode }); state.shuffle = mode !== 0; state.smartShuffle = mode === 2; shuffleEvents.emit("update_complete", { contextURI: ctx, shuffleMode: mode }); } },
      PlaylistAPI: { async getContents(uri: string) { playlistFetchCalls.push(uri); return { items: opts?.tracksByPlaylist?.[uri] ?? [] }; } },
      LibraryAPI: { async getTracks(q: any) { libraryFetchCalls.push(q); return { items: opts?.likedTracks ?? [] }; } },
      LocalFilesAPI: { async getTracks() { return opts?.localTracks ?? []; } },
    },
  };
  return { sp, playerEvents, shuffleEvents, setQueueCalls, skipToCalls, setShuffleApiCalls, playlistFetchCalls, libraryFetchCalls, graphqlCalls, tippyInstances,
    getState: () => state, setState: (p: any) => { state = { ...state, ...p }; }, setInternalNextTracks: (t: any[]) => { nextTracks = t; },
    getInternalNextTracks: () => nextTracks, setFailNextSetQueue: (e: Error) => { failNext = e; }, emitUpdate: (p?: any) => { if (p) state = { ...state, ...p }; playerEvents.emit("update", state); } };
}
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const flushMicro = () => Promise.resolve().then(() => Promise.resolve());

test("1. startup, SSR safety, singleton idempotency, zero idle overhead & static audit", async () => {
  const noop = createTrueShuffleController();
  assert.equal(noop.getMode(), "off"); await noop.refresh(); noop.destroy(); initTrueShuffle().destroy();
  const dom = createDom("modern"), storage = memStore();
  const mock = createMockSpicetify({ contextUri: "spotify:playlist:idle1", tracksByPlaylist: { "spotify:playlist:idle1": makeTracks(10) } });
  const h1 = initTrueShuffle({ win: dom.win, doc: dom.doc as unknown as Document, spicetify: mock.sp, storage });
  const h2 = initTrueShuffle({ win: dom.win, doc: dom.doc as unknown as Document, spicetify: mock.sp, storage });
  assert.equal(h1, h2); assert.equal(dom.doc.querySelectorAll(`#${TRUE_SHUFFLE_STYLE_ID}`).length, 1);
  assert.equal(storage.reads, 1); assert.equal(storage.writes, 0);
  assert.equal(mock.playlistFetchCalls.length + mock.libraryFetchCalls.length + mock.setQueueCalls.length, 0);
  // Off: nothing watches the player bar or listens to the player; only one click listener on the document.
  assert.equal(dom.doc.observers.size, 0);
  assert.equal(dom.doc.listeners.get("click")?.length, 1);
  h1.destroy();
  assert.equal(dom.doc.querySelectorAll(`#${TRUE_SHUFFLE_STYLE_ID}`).length, 0); assert.equal(dom.doc.listeners.get("click")?.length, 0);
  // Saved as True: the player bar is watched from the start.
  const dom2 = createDom("modern"), eng = new TrueShuffleEngine({ storage: memStore() }); eng.setMode("true");
  const h3 = initTrueShuffle({ win: dom2.win, doc: dom2.doc as unknown as Document, spicetify: mock.sp, storage: memStore(), engine: eng });
  const obs = Array.from(dom2.doc.observers);
  assert.equal(obs.length, 1); assert.equal(obs[0]!.observedTarget, dom2.center);
  h3.destroy(); assert.equal(obs[0]!.disconnected, true);
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "core", "shuffle-controller.ts"), "utf8");
  assert.equal(src.includes("api.spotify.com") || src.includes("../app/") || src.includes("../spotify/"), false);
});

test("2. button discovery, exclusions, 4-lang tooltips, capture cycling, CSS ::before/::after & remount", async () => {
  const modern = createDom("modern"), legacy = createDom("legacy"), podcast = createDom("podcast"), ad = createDom("ad");
  assert.equal(findShuffleButton(modern.doc as unknown as Document), modern.shuffleBtn);
  assert.equal(findShuffleButton(legacy.doc as unknown as Document), legacy.shuffleBtn);
  assert.equal(findShuffleButton(podcast.doc as unknown as Document), null);
  assert.equal(findShuffleButton(ad.doc as unknown as Document), null);
  for (const type of ["episode", "ad", "podcast_chapter"]) assert.equal(findShuffleButton(modern.doc as unknown as Document, { item: { type } }), null);
  for (const lang of ["en", "uk", "ru", "de"] as const) {
    assert.equal(getShuffleTooltipText("off", { lang }), SHUFFLE_TEXTS[lang].off);
    assert.equal(getShuffleTooltipText("spotify", { lang, smartShuffle: true }), SHUFFLE_TEXTS[lang].smartShuffle);
    assert.equal(getShuffleTooltipText("true", { lang }), SHUFFLE_TEXTS[lang].trueShuffle);
    assert.equal(getShuffleTooltipText("true", { lang, unavailable: true }), SHUFFLE_TEXTS[lang].unavailable);
  }
  const mock = createMockSpicetify({ locale: () => { throw new Error("boom"); }, contextUri: "spotify:playlist:c1", tracksByPlaylist: { "spotify:playlist:c1": makeTracks(12) } });
  let reactClicks = 0, rootMouseovers = 0;
  modern.shuffleBtn!.addEventListener("click", () => reactClicks++);
  modern.rootBar.addEventListener("mouseover", () => rootMouseovers++);
  const handle = initTrueShuffle({ win: modern.win, doc: modern.doc as unknown as Document, spicetify: mock.sp, storage: memStore() });
  assert.equal(modern.shuffleBtn!.getAttribute("aria-label"), "Enable shuffle");
  const css = modern.doc.getElementById(TRUE_SHUFFLE_STYLE_ID)!.textContent;
  assert.ok(css.includes("::before") && css.includes("::after") && css.includes("data-sai-shuffle-mode"));
  const c1 = new MockEvent("click"); modern.shuffleSvg!.dispatchEvent(c1);
  assert.equal(c1.defaultPrevented, true); assert.equal(reactClicks, 0); assert.equal(handle.getMode(), "spotify");
  modern.shuffleBtn!.dispatchEvent(new MockEvent("click")); await flush();
  assert.equal(handle.getMode(), "true"); assert.equal(modern.shuffleBtn!.getAttribute("aria-label"), SHUFFLE_TEXTS.en.trueShuffle);
  assert.equal(mock.tippyInstances[0]!.content, SHUFFLE_TEXTS.en.trueShuffle);
  modern.shuffleBtn!.dispatchEvent(new MockEvent("mouseover")); assert.equal(rootMouseovers, 0);
  modern.shuffleBtn!.setAttribute("aria-label", "Enable shuffle"); assert.equal(modern.shuffleBtn!.getAttribute("aria-label"), SHUFFLE_TEXTS.en.trueShuffle);
  mock.emitUpdate({ restrictions: { canToggleShuffle: false } }); assert.equal(modern.shuffleBtn!.getAttribute("aria-label"), SHUFFLE_TEXTS.en.unavailable);
  modern.shuffleBtn!.dispatchEvent(new MockEvent("click")); assert.equal(handle.getMode(), "true");
  mock.emitUpdate({ restrictions: { canToggleShuffle: true } });
  // A button re-rendered by Spotify while True Shuffle is on gets the badge again.
  modern.shuffleBtn!.remove();
  const remount = modern.doc.createElement("button"); remount.setAttribute("data-encore-id", "buttonTertiary");
  modern.left.children.unshift(remount); remount.parentElement = modern.left; modern.doc.notify("childList", modern.left);
  assert.equal(remount.getAttribute("data-sai-shuffle-mode"), "true");
  remount.dispatchEvent(new MockEvent("click")); await flush(); assert.equal(handle.getMode(), "off");
  // Leaving True Shuffle stops watching and removes our marks.
  assert.equal(modern.doc.observers.size, 0); assert.equal(remount.getAttribute("data-sai-shuffle-mode"), null);
  assert.equal(mock.tippyInstances[0]!.destroyed, true);
  handle.destroy();
});

test("2b. Smart Shuffle keeps its place: off -> shuffle -> smart -> True -> off", async () => {
  const dom = createDom("modern");
  const mock = createMockSpicetify({ contextUri: "spotify:playlist:s1", tracksByPlaylist: { "spotify:playlist:s1": makeTracks(6) } });
  mock.setState({ restrictions: { canToggleShuffle: true, canToggleSmartShuffle: true, disallowSetQueueReasons: [] } });
  const handle = initTrueShuffle({ win: dom.win, doc: dom.doc as unknown as Document, spicetify: mock.sp, storage: memStore() });
  const click = async () => { dom.shuffleBtn!.dispatchEvent(new MockEvent("click")); await flush(); };
  await click(); assert.equal(mock.getState().shuffle, true); assert.equal(mock.getState().smartShuffle, false);
  await click(); assert.equal(mock.getState().smartShuffle, true); assert.equal(mock.setShuffleApiCalls.at(-1)?.mode, 2); assert.equal(handle.getMode(), "spotify");
  await click(); assert.equal(handle.getMode(), "true"); assert.equal(mock.getState().shuffle, false);
  await click(); assert.equal(handle.getMode(), "off");
  handle.destroy();
});

test("3. 1,250-track mid-playlist progression without repeats, bounded queue <= 8 & rapid skipTo re-entrancy", async () => {
  const dom = createDom("modern"), storage = memStore(), tracks = makeTracks(1250, "m"), anchor = tracks[400]!;
  const engine = new TrueShuffleEngine({ storage, rng: () => 0.37 }); engine.setMode("spotify");
  const mock = createMockSpicetify({ contextUri: "spotify:playlist:big1250", tracksByPlaylist: { "spotify:playlist:big1250": tracks }, initialTrack: trkItem(anchor) });
  mock.setState({ shuffle: true });
  const handle = initTrueShuffle({ win: dom.win, doc: dom.doc as unknown as Document, spicetify: mock.sp, storage, engine });
  dom.shuffleBtn!.dispatchEvent(new MockEvent("click")); await flush();
  assert.equal(handle.getMode(), "true"); assert.equal(mock.setShuffleApiCalls[0]?.mode, 0);
  assert.equal(mock.getInternalNextTracks().length, 8); assert.equal(engine.getDeck("spotify:playlist:big1250")!.order[0]!.uri, anchor.uri);
  const seen = new Set([anchor.uri]);
  for (let step = 1; step < 1250; step++) {
    if (step % 2 === 1) mock.sp.Platform.PlayerAPI.skipToNext();
    else { const n = mock.getInternalNextTracks().shift()!; mock.emitUpdate({ item: trkItem(n.contextTrack) }); }
    await flushMicro();
    const cur = mock.getState().item; assert.equal(seen.has(cur.uri), false); seen.add(cur.uri);
    assert.ok(mock.getInternalNextTracks().length <= 8);
  }
  assert.equal(seen.size, 1250);
  engine.prepareDeck("spotify:playlist:big1250", tracks, anchor, { forceReshuffle: true });
  mock.setState({ item: trkItem(anchor) }); await handle.refresh(); await flush();
  const before = mock.skipToCalls.length;
  for (let i = 0; i < 5; i++) mock.sp.Platform.PlayerAPI.skipToNext();
  assert.equal(mock.skipToCalls.length - before, 5); assert.equal(engine.getDeck("spotify:playlist:big1250")!.cursor, 5);
  mock.emitUpdate({ item: trkItem(engine.getDeck("spotify:playlist:big1250")!.order[2]!) });
  assert.equal(engine.getDeck("spotify:playlist:big1250")!.cursor, 5);
  handle.destroy();
});

test("4. user-queued preservation, skipTo fallback, previous 3s rule, repeat=0/1 & jumpToTrack", async () => {
  const dom = createDom("modern"), tracks = makeTracks(10, "q"), engine = new TrueShuffleEngine({ storage: memStore(), rng: () => 0.25 });
  engine.setMode("true"); const fakeNow = 10_000;
  const mock = createMockSpicetify({ contextUri: "spotify:playlist:q4", tracksByPlaylist: { "spotify:playlist:q4": tracks }, initialTrack: trkItem(tracks[0]!) });
  mock.setInternalNextTracks([{ contextTrack: { uri: tracks[4]!.uri, metadata: { is_queued: "true" } }, provider: "queue" }]);
  const handle = initTrueShuffle({ win: dom.win, doc: dom.doc as unknown as Document, spicetify: mock.sp, storage: memStore(), engine, now: () => fakeNow });
  await flush();
  assert.equal(mock.getInternalNextTracks()[0].provider, "queue"); assert.equal(mock.getInternalNextTracks().length, 9);
  const callsAfterInit = mock.setQueueCalls.length;
  mock.playerEvents.emit("queue_update", {}); await flush(); assert.equal(mock.setQueueCalls.length, callsAfterInit);
  assert.equal(mock.sp.Platform.PlayerAPI.skipToNext(), false); await flush();
  assert.equal(mock.getState().item.uri, tracks[4]!.uri); assert.equal(engine.getDeck("spotify:playlist:q4")!.cursor, 0);
  mock.emitUpdate({ isPaused: true, positionAsOfTimestamp: 1500 });
  mock.emitUpdate({ repeat: 2, item: trkItem(tracks[3]!, { metadata: { is_transition_preview: "true" } }) });
  assert.equal(engine.getDeck("spotify:playlist:q4")!.cursor, 0);
  mock.emitUpdate({ repeat: 0 }); mock.sp.Platform.PlayerAPI.skipToNext(); mock.sp.Platform.PlayerAPI.skipToNext(); await flush();
  assert.equal(engine.getDeck("spotify:playlist:q4")!.cursor, 2);
  mock.setState({ isPaused: true, positionAsOfTimestamp: 4500, timestamp: fakeNow }); assert.equal(mock.sp.Platform.PlayerAPI.skipToPrevious(), false);
  mock.setState({ isPaused: false, positionAsOfTimestamp: 1000, timestamp: fakeNow - 200 });
  assert.equal(mock.sp.Platform.PlayerAPI.skipToPrevious(), true); assert.equal(engine.getDeck("spotify:playlist:q4")!.cursor, 1);
  assert.equal(mock.sp.Platform.PlayerAPI.skipToPrevious(), true); assert.equal(mock.sp.Platform.PlayerAPI.skipToPrevious(), false);
  const jumped = engine.getDeck("spotify:playlist:q4")!.order[5]!;
  mock.emitUpdate({ item: trkItem(jumped) }); await flush(); assert.equal(engine.current("spotify:playlist:q4")!.uri, jumped.uri);
  for (let i = 0; i < 8; i++) mock.sp.Platform.PlayerAPI.skipToNext();
  await flush(); assert.equal(mock.sp.Platform.PlayerAPI.skipToNext(), false);
  const lastUri = engine.current("spotify:playlist:q4")!.uri;
  mock.setState({ repeat: 1 }); assert.equal(mock.sp.Platform.PlayerAPI.skipToNext(), true); await flush();
  assert.notEqual(engine.current("spotify:playlist:q4")!.uri, lastUri); assert.equal(engine.getDeck("spotify:playlist:q4")!.cursor, 0);
  handle.destroy();
  const dom2 = createDom("modern"), eng2 = new TrueShuffleEngine({ storage: memStore(), rng: () => 0.15 }); eng2.setMode("true");
  const fb = createMockSpicetify({ contextUri: "spotify:playlist:fb", tracksByPlaylist: { "spotify:playlist:fb": tracks }, initialTrack: trkItem(tracks[0]!), setQueueAvailable: false });
  const h2 = initTrueShuffle({ win: dom2.win, doc: dom2.doc as unknown as Document, spicetify: fb.sp, storage: memStore(), engine: eng2 });
  await flush(); const exp = eng2.peekNext("spotify:playlist:fb", 1)[0]!;
  fb.emitUpdate({ item: { type: "track", uri: "spotify:track:uq", provider: "queue", metadata: { is_queued: "true" } } });
  fb.emitUpdate({ item: trkItem({ uri: "spotify:track:bad", uid: "u_bad" }) }); assert.equal(fb.skipToCalls.at(-1)?.uri, exp.uri);
  h2.destroy();
});

test("5. Liked Songs, Album, Artist, LocalFiles, unsupported, QUEUE_REVISION_MISMATCH, fetch race & external sync", async () => {
  const dom = createDom("modern"), storage = memStore(), engine = new TrueShuffleEngine({ storage }); engine.setMode("true");
  const albumItems = Array.from({ length: 220 }, (_, i) => ({ uid: `au${i}`, track: { uri: `spotify:track:alb${i}`, playability: { playable: i !== 5 } } }));
  const artistItems = Array.from({ length: 5 }, (_, i) => ({ track: { uri: `spotify:track:art${i}`, playability: { playable: true } } }));
  let fakeNow = 5000;
  const mock = createMockSpicetify({
    contextUri: "spotify:user:maks123:collection",
    likedTracks: [{ uri: "spotify:track:l0", isPlayable: true }, { uri: "spotify:track:l1", isPlayable: false }, { uri: "spotify:track:l2", isPlayable: true }],
    albumPages: { "spotify:album:abc": albumItems }, artistPages: { "spotify:artist:xyz789": artistItems },
    localTracks: [{ uri: "spotify:local:a:b:c:1", isPlayable: true }, { uri: "spotify:local:a:b:c:2", isPlayable: true }],
    initialTrack: trkItem({ uri: "spotify:track:l0" }),
  });
  mock.setFailNextSetQueue(new Error("QUEUE_REVISION_MISMATCH"));
  const handle = initTrueShuffle({ win: dom.win, doc: dom.doc as unknown as Document, spicetify: mock.sp, storage, engine, now: () => fakeNow });
  await flush();
  const liked = engine.getDeck("spotify:collection:tracks")!;
  assert.equal(liked.order.length, 2); assert.ok(liked.order.every((t) => t.uid === undefined)); assert.equal(mock.setQueueCalls.length, 1);
  mock.emitUpdate({ context: { uri: "spotify:album:abc" }, item: trkItem({ uri: "spotify:track:alb0", uid: "au0" }) }); await flush();
  assert.equal(engine.getDeck("spotify:album:abc")?.order.length, 219); assert.equal(mock.graphqlCalls.length, 2);
  mock.emitUpdate({ context: { uri: "spotify:list:popular-release-segments-main-roles:artist_xyz789" }, item: trkItem({ uri: "spotify:track:art0" }) }); await flush();
  assert.equal(engine.getDeck("spotify:artist:xyz789")?.order.length, 5);
  mock.emitUpdate({ context: { uri: "spotify:local-files" }, item: trkItem({ uri: "spotify:local:a:b:c:1" }) }); await flush();
  assert.ok(engine.getDeck("spotify:local-files")?.order.every((t) => t.isLocal === true));
  for (const patch of [{ context: { uri: "spotify:station:1" } }, { context: { uri: "spotify:show:1" }, item: { type: "episode", uri: "spotify:episode:1" } }, { context: { uri: "spotify:playlist:r1" }, restrictions: { canToggleShuffle: true, disallowSetQueueReasons: ["restricted"] } }]) {
    mock.emitUpdate(patch); await flush(); assert.equal(handle.getMode(), "true");
  }
  let resolveA!: (v: any) => void;
  const tracksA = makeTracks(6, "a"), tracksB = makeTracks(6, "b");
  mock.sp.Platform.PlaylistAPI.getContents = (u: string) => u === "spotify:playlist:A" ? new Promise((r) => { resolveA = r; }) : Promise.resolve({ items: tracksB });
  mock.emitUpdate({ context: { uri: "spotify:playlist:A" }, item: trkItem(tracksA[0]!) });
  await flushMicro();
  mock.emitUpdate({ context: { uri: "spotify:playlist:B" }, shuffle: true, item: trkItem(tracksB[0]!) });
  await flush(); resolveA({ items: tracksA }); await flush();
  assert.equal(handle.getMode(), "true"); assert.equal(engine.getDeck("spotify:playlist:A"), null); assert.ok(engine.getDeck("spotify:playlist:B"));
  fakeNow += 500; mock.emitUpdate({ shuffle: true }); assert.equal(handle.getMode(), "true");
  fakeNow += 2000; mock.shuffleEvents.emit("update", { contextURI: "spotify:playlist:B", shuffleMode: 2 });
  // Spotify's own shuffle took over: our mark and watchers are gone.
  assert.equal(handle.getMode(), "spotify"); assert.equal(dom.shuffleBtn!.getAttribute("data-sai-shuffle-mode"), null); assert.equal(dom.doc.observers.size, 0);
  assert.equal(SHUFFLE_STORAGE_KEY, "spotify-ai:true-shuffle:v1");
  handle.destroy();
});
