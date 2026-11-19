import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_MAX_CONTEXTS,
  MAX_SAVED_CHARS,
  fisherYatesShuffle,
  nextCycleMode,
  normalizeContextUri,
  SHUFFLE_STORAGE_KEY,
  type ShuffleStorage,
  type ShuffleTrack,
  TrueShuffleEngine,
} from "../src/core/shuffle-engine";

function createMemoryStorage(initial?: Record<string, string>): ShuffleStorage & {
  data: Map<string, string>;
  reads: number;
  writes: number;
  failOnWrite?: (key: string, value: string, writesSoFar: number) => boolean;
} {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  const store = {
    data,
    reads: 0,
    writes: 0,
    failOnWrite: undefined as ((key: string, value: string, writesSoFar: number) => boolean) | undefined,
    getItem(key: string): string | null {
      store.reads++;
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.writes++;
      if (store.failOnWrite?.(key, value, store.writes)) {
        const err = new Error("QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      }
      data.set(key, value);
    },
  };
  return store;
}

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTracks(count: number, withUid = true): ShuffleTrack[] {
  const tracks: ShuffleTrack[] = [];
  for (let i = 0; i < count; i++) {
    tracks.push(
      withUid
        ? { uri: `spotify:track:t${i}`, uid: `u${i}`, isPlayable: true }
        : { uri: `spotify:track:t${i}`, isPlayable: true },
    );
  }
  return tracks;
}

test("nextCycleMode cycles off -> spotify -> true -> off with defensive fallback", () => {
  assert.equal(nextCycleMode("off"), "spotify");
  assert.equal(nextCycleMode("spotify"), "true");
  assert.equal(nextCycleMode("true"), "off");
  assert.equal(nextCycleMode("unexpected" as unknown as "off"), "off");
});

test("fisherYatesShuffle preserves multiset, does not mutate input, and handles edge rng values", () => {
  assert.deepEqual(fisherYatesShuffle([]), []);

  let calls = 0;
  assert.deepEqual(
    fisherYatesShuffle(["only"], () => {
      calls++;
      return 0.5;
    }),
    ["only"],
  );
  assert.equal(calls, 0);

  const original = [1, 2, 2, 3, 4, 5];
  const snapshot = original.slice();
  const shuffled = fisherYatesShuffle(original, createMulberry32(42));
  assert.deepEqual(original, snapshot);
  assert.deepEqual(shuffled.slice().sort((a, b) => a - b), original);

  // Boundary / malformed rng outputs never produce out-of-bounds or undefined elements
  for (const badVal of [0, 1 - 1e-16, 1, 2, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const res = fisherYatesShuffle(["a", "b", "c", "d"], () => badVal);
    assert.equal(res.length, 4);
    assert.ok(res.every((v) => typeof v === "string"));
    assert.deepEqual(res.slice().sort(), ["a", "b", "c", "d"]);
  }
});

test("fisherYatesShuffle produces statistically uniform permutations (chi-squared check)", () => {
  const rng = createMulberry32(1337);
  const items = ["A", "B", "C", "D"];
  const counts = new Map<string, number>();
  const trials = 12_000;

  for (let i = 0; i < trials; i++) {
    const perm = fisherYatesShuffle(items, rng).join("");
    counts.set(perm, (counts.get(perm) ?? 0) + 1);
  }

  assert.equal(counts.size, 24);
  const expected = trials / 24;
  let chi2 = 0;
  for (const observed of counts.values()) {
    chi2 += ((observed - expected) ** 2) / expected;
  }
  // 23 degrees of freedom: p=0.001 critical value is 49.73
  assert.ok(chi2 < 49.73, `Expected uniform permutation distribution, got chi2=${chi2}`);
});

test("normalizeContextUri canonicalizes Liked Songs variants without corrupting case or other collections", () => {
  assert.equal(normalizeContextUri("spotify:collection:tracks"), "spotify:collection:tracks");
  assert.equal(normalizeContextUri("spotify:collection"), "spotify:collection:tracks");
  assert.equal(normalizeContextUri("spotify:user:ganfay:collection"), "spotify:collection:tracks");
  assert.equal(normalizeContextUri("spotify:user:ganfay:collection:tracks"), "spotify:collection:tracks");
  assert.equal(normalizeContextUri("  SPOTIFY:USER:User_1:Collection/  "), "spotify:collection:tracks");
  assert.equal(normalizeContextUri("SPOTIFY:COLLECTION:TRACKS///"), "spotify:collection:tracks");

  // Base62 case preserved
  assert.equal(
    normalizeContextUri("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M/"),
    "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
  );
  assert.equal(
    normalizeContextUri("spotify:album:4aawyAB9vmqN3uQ7FjRGTy"),
    "spotify:album:4aawyAB9vmqN3uQ7FjRGTy",
  );

  // Non-tracks collection categories must remain distinct
  assert.equal(normalizeContextUri("spotify:collection:your-episodes"), "spotify:collection:your-episodes");
  assert.equal(normalizeContextUri("spotify:collection:local-files"), "spotify:collection:local-files");
  assert.equal(
    normalizeContextUri("spotify:user:ganfay:collection:your-episodes"),
    "spotify:user:ganfay:collection:your-episodes",
  );
  assert.equal(
    normalizeContextUri("spotify:user:ganfay:collection:albums"),
    "spotify:user:ganfay:collection:albums",
  );
  assert.equal(normalizeContextUri("   "), "");
});

test("TrueShuffleEngine traverses 1,250 tracks across 3 full cycles with zero repeats per cycle", () => {
  const storage = createMemoryStorage();
  const engine = new TrueShuffleEngine({
    storage,
    rng: createMulberry32(99),
    now: () => 1_000,
  });

  const ctx = "spotify:playlist:large1250";
  const tracks = makeTracks(1250);
  const deck = engine.prepareDeck(ctx, tracks);
  assert.equal(deck.order.length, 1250);
  assert.equal(deck.cursor, 0);

  const cycleOrders: string[][] = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    const visited = new Set<string>();
    const order: string[] = [];

    const first = engine.current(ctx);
    assert.ok(first);
    visited.add(first.uid!);
    order.push(first.uri);

    for (let step = 1; step < 1250; step++) {
      const next = engine.advance(ctx);
      assert.ok(next);
      assert.equal(visited.has(next.uid!), false, `Repeated track ${next.uid} in cycle ${cycle}`);
      visited.add(next.uid!);
      order.push(next.uri);
    }

    assert.equal(visited.size, 1250);
    cycleOrders.push(order);

    if (cycle < 2) {
      const wrapped = engine.advance(ctx);
      assert.ok(wrapped);
      assert.notEqual(wrapped.uri, order[order.length - 1], "Boundary wraparound must not repeat last track");
    }
  }

  assert.notDeepEqual(cycleOrders[0], cycleOrders[1]);
  assert.notDeepEqual(cycleOrders[1], cycleOrders[2]);
});

test("wraparound boundary never repeats immediately previous track for N=2 and N>2", () => {
  // Adversarial rng returning 0 repeatedly (which would otherwise fail to change order on N=2)
  const storage = createMemoryStorage();
  const engine = new TrueShuffleEngine({ storage, rng: () => 0 });
  const ctx2 = "spotify:playlist:two";
  engine.prepareDeck(ctx2, makeTracks(2));

  let prevUri = engine.current(ctx2)!.uri;
  for (let i = 0; i < 20; i++) {
    const next = engine.advance(ctx2)!;
    assert.notEqual(next.uri, prevUri);
    prevUri = next.uri;
  }

  // N=3 with rng trying to force same item first
  const ctx3 = "spotify:playlist:three";
  engine.prepareDeck(ctx3, makeTracks(3));
  let prev3 = engine.current(ctx3)!.uri;
  for (let i = 0; i < 30; i++) {
    const next = engine.advance(ctx3)!;
    if ((i + 1) % 3 === 0) {
      assert.notEqual(next.uri, prev3, "Wraparound on N=3 repeated previous track");
    }
    prev3 = next.uri;
  }
});

test("handles N=0 and N=1 edge cases cleanly", () => {
  const storage = createMemoryStorage();
  const engine = new TrueShuffleEngine({ storage, rng: createMulberry32(7) });

  const emptyCtx = "spotify:playlist:empty";
  const emptyDeck = engine.prepareDeck(emptyCtx, []);
  assert.equal(emptyDeck.order.length, 0);
  assert.equal(engine.current(emptyCtx), null);
  assert.deepEqual(engine.peekNext(emptyCtx, 3, { wrap: true }), []);
  assert.equal(engine.advance(emptyCtx), null);
  assert.equal(engine.previous(emptyCtx), null);

  const singleCtx = "spotify:playlist:single";
  const singleDeck = engine.prepareDeck(singleCtx, [{ uri: "spotify:track:solo", uid: "u0" }]);
  assert.equal(singleDeck.order.length, 1);
  assert.equal(engine.current(singleCtx)?.uri, "spotify:track:solo");
  assert.deepEqual(engine.peekNext(singleCtx, 2), []);
  assert.deepEqual(
    engine.peekNext(singleCtx, 2, { wrap: true }).map((t) => t.uri),
    ["spotify:track:solo", "spotify:track:solo"],
  );
  assert.equal(engine.advance(singleCtx)?.uri, "spotify:track:solo");
  assert.equal(engine.previous(singleCtx), null);
});

test("filters unplayable tracks, preserves local tracks, duplicate UIDs, and no-UID tracks", () => {
  const storage = createMemoryStorage();
  const engine = new TrueShuffleEngine({ storage, rng: createMulberry32(11) });
  const ctx = "spotify:playlist:mixed";

  const tracks: ShuffleTrack[] = [
    { uri: "spotify:track:dup", uid: "u1", isPlayable: true },
    { uri: "spotify:track:dup", uid: "u2", isPlayable: undefined },
    { uri: "spotify:track:unplayable", uid: "u3", isPlayable: false },
    { uri: "spotify:local:artist:song:123", uid: "u4", isLocal: true },
    { uri: "   ", uid: "u5", isPlayable: true },
  ];

  // Anchor specifically on second copy (uid: u2)
  const deck = engine.prepareDeck(ctx, tracks, { uri: "spotify:track:dup", uid: "u2" });
  assert.equal(deck.order.length, 3);
  assert.equal(deck.cursor, 0);
  assert.deepEqual(deck.order[0], { uri: "spotify:track:dup", uid: "u2" });
  assert.ok(deck.order.some((t) => t.uid === "u1"));
  assert.ok(deck.order.some((t) => t.uid === "u4" && t.isLocal === true));
  assert.ok(!deck.order.some((t) => t.uri === "spotify:track:unplayable"));

  // Remove first copy u1 via syncTracks -> u2 stays, u1 disappears
  const synced = engine.syncTracks(ctx, [
    { uri: "spotify:track:dup", uid: "u2" },
    { uri: "spotify:local:artist:song:123", uid: "u4", isLocal: true },
  ]);
  assert.equal(synced.order.length, 2);
  assert.ok(synced.order.some((t) => t.uid === "u2"));
  assert.ok(!synced.order.some((t) => t.uid === "u1"));

  // No-UID duplicate URIs (Liked Songs style) preserve exact multiplicity
  const liked = "spotify:user:maks:collection";
  const noUidTracks: ShuffleTrack[] = [
    { uri: "spotify:track:a" },
    { uri: "spotify:track:a" },
    { uri: "spotify:track:b" },
  ];
  const likedDeck = engine.prepareDeck(liked, noUidTracks);
  assert.equal(likedDeck.contextUri, "spotify:collection:tracks");
  assert.equal(likedDeck.order.length, 3);
  assert.equal(likedDeck.order.filter((t) => t.uri === "spotify:track:a").length, 2);

  // Removing one occurrence of track:a leaves exactly one
  const likedSynced = engine.syncTracks("spotify:collection:tracks", [
    { uri: "spotify:track:a" },
    { uri: "spotify:track:b" },
  ]);
  assert.equal(likedSynced.order.filter((t) => t.uri === "spotify:track:a").length, 1);
  assert.equal(likedSynced.order.filter((t) => t.uri === "spotify:track:b").length, 1);
});

test("syncTracks preserves played prefix, adjusts cursor on removals, and shuffles only unplayed tail on additions", () => {
  const storage = createMemoryStorage();
  const engine = new TrueShuffleEngine({ storage, rng: createMulberry32(123) });
  const ctx = "spotify:playlist:sync";

  const initial = makeTracks(5);
  engine.prepareDeck(ctx, initial, initial[0]);
  engine.advance(ctx);
  engine.advance(ctx);
  const beforeSync = engine.getDeck(ctx)!;
  assert.equal(beforeSync.cursor, 2);

  // Remove played track at index 0 and add 2 new tracks
  const removedFirst = beforeSync.order[0]!;
  const survivingInputs = beforeSync.order.slice(1);
  const addedInputs: ShuffleTrack[] = [
    { uri: "spotify:track:new1", uid: "unew1" },
    { uri: "spotify:track:new2", uid: "unew2" },
  ];

  const afterAdd = engine.syncTracks(ctx, [...survivingInputs, ...addedInputs]);
  assert.equal(afterAdd.cursor, 1);
  // Played prefix [0..1] matches surviving [1..2] in exact order
  assert.equal(afterAdd.order[0]!.uid, beforeSync.order[1]!.uid);
  assert.equal(afterAdd.order[1]!.uid, beforeSync.order[2]!.uid);
  assert.ok(!afterAdd.order.some((t) => t.uid === removedFirst.uid));
  assert.equal(afterAdd.order.length, 6);

  // Sync with no additions does not reorder unplayed tail
  const unplayedTail = afterAdd.order.slice(2).map((t) => t.uid);
  const afterNoAdd = engine.syncTracks(ctx, afterAdd.order);
  assert.deepEqual(
    afterNoAdd.order.slice(2).map((t) => t.uid),
    unplayedTail,
  );
});

test("jumpToTrack, peekNext(wrap: true), advance, and previous maintain exact consistency", () => {
  const storage = createMemoryStorage();
  const engine = new TrueShuffleEngine({ storage, rng: createMulberry32(77) });
  const ctx = "spotify:playlist:nav";

  const tracks = makeTracks(4);
  const initial = engine.prepareDeck(ctx, tracks, tracks[0]);
  const played0 = initial.order[0]!;
  const t1 = initial.order[1]!;
  const t2 = initial.order[2]!;
  const t3 = initial.order[3]!;

  // Forward jump from 0 to 3 moves t3 to index 1, cursor=1, preserving played0 at 0
  const jumpedForward = engine.jumpToTrack(ctx, t3);
  assert.equal(jumpedForward?.uid, t3.uid);
  const afterForward = engine.getDeck(ctx)!;
  assert.equal(afterForward.cursor, 1);
  assert.deepEqual(
    afterForward.order.map((t) => t.uid),
    [played0.uid, t3.uid, t1.uid, t2.uid],
  );

  // Backward jump from 1 to 0 moves played0 to index 1, cursor=1, preserving unplayed [t1, t2]
  const jumpedBack = engine.jumpToTrack(ctx, played0);
  assert.equal(jumpedBack?.uid, played0.uid);
  const afterBack = engine.getDeck(ctx)!;
  assert.equal(afterBack.cursor, 1);
  assert.deepEqual(
    afterBack.order.map((t) => t.uid),
    [t3.uid, played0.uid, t1.uid, t2.uid],
  );

  // Unknown track returns null
  assert.equal(engine.jumpToTrack(ctx, { uri: "spotify:track:missing", uid: "ux" }), null);

  // peekNext without wrap stops at end of cycle and makes zero storage writes
  const writesBeforePeek = storage.writes;
  assert.deepEqual(
    engine.peekNext(ctx, 5).map((t) => t.uid),
    [t1.uid, t2.uid],
  );
  assert.equal(storage.writes, writesBeforePeek);

  // peekNext({ wrap: true }) across boundary matches subsequent advance() calls 1-for-1
  const peekedWrapped = engine.peekNext(ctx, 6, { wrap: true });
  assert.equal(peekedWrapped.length, 6);
  for (const expected of peekedWrapped) {
    const actual = engine.advance(ctx);
    assert.deepEqual(actual, expected);
  }

  // previous steps back cleanly and clamps at cursor=0 without writing
  const prev = engine.previous(ctx);
  assert.ok(prev);
  while (engine.previous(ctx) !== null) {
    // step back to 0
  }
  const writesAtZero = storage.writes;
  assert.equal(engine.previous(ctx), null);
  assert.equal(storage.writes, writesAtZero);
});

test("LRU eviction (including constant clock and maxContexts=0) and mode persistence work", () => {
  const storage = createMemoryStorage();
  const engine = new TrueShuffleEngine({
    storage,
    maxContexts: 2,
    rng: createMulberry32(5),
    now: () => 5_000,
  });

  assert.equal(engine.getMode(), "off");
  assert.equal(engine.cycleMode(), "spotify");
  assert.equal(engine.cycleMode(), "true");
  assert.equal(engine.cycleMode(), "off");

  const writesAfterOff = storage.writes;
  assert.equal(engine.setMode("off"), "off");
  assert.equal(storage.writes, writesAfterOff);

  assert.equal(engine.setMode("true"), "true");
  engine.prepareDeck("spotify:playlist:p1", makeTracks(3));
  engine.prepareDeck("spotify:playlist:p2", makeTracks(3));
  // Touch p1 so p2 becomes LRU even under constant clock
  engine.advance("spotify:playlist:p1");
  engine.prepareDeck("spotify:playlist:p3", makeTracks(3));

  assert.ok(engine.getDeck("spotify:playlist:p1"));
  assert.equal(engine.getDeck("spotify:playlist:p2"), null);
  assert.ok(engine.getDeck("spotify:playlist:p3"));

  // Reload from storage verifies mode & surviving decks
  const reloaded = new TrueShuffleEngine({ storage, maxContexts: 2 });
  assert.equal(reloaded.getMode(), "true");
  assert.ok(reloaded.getDeck("spotify:playlist:p1"));
  assert.equal(reloaded.getDeck("spotify:playlist:p2"), null);
  assert.ok(reloaded.getDeck("spotify:playlist:p3"));

  // Lifecycle clear/reset helpers
  assert.equal(reloaded.clearDeck("spotify:playlist:p1"), true);
  assert.equal(reloaded.clearDeck("spotify:playlist:p1"), false);
  reloaded.clearAllDecks();
  assert.equal(reloaded.getDeck("spotify:playlist:p3"), null);
  assert.equal(reloaded.getMode(), "true");
  reloaded.reset();
  assert.equal(reloaded.getMode(), "off");

  // maxContexts = 0 disables deck caching while still returning computed snapshot
  const zeroCache = new TrueShuffleEngine({ storage: createMemoryStorage(), maxContexts: 0 });
  zeroCache.setMode("true");
  const snap = zeroCache.prepareDeck("spotify:playlist:ephemeral", makeTracks(2));
  assert.equal(snap.order.length, 2);
  assert.equal(zeroCache.getDeck("spotify:playlist:ephemeral"), null);
});

test("saved decks stay under the size cap; an oversized deck lives in memory only", () => {
  const storage = createMemoryStorage();
  const engine = new TrueShuffleEngine({ storage, maxContexts: 4 });
  const big = Array.from({ length: 6000 }, (_, i) => ({ uri: `spotify:track:big${i}`, uid: `uid_big_${i}` }));
  engine.prepareDeck("spotify:playlist:huge", big);
  const saved = storage.getItem(SHUFFLE_STORAGE_KEY) ?? "";
  assert.ok(saved.length <= MAX_SAVED_CHARS);
  assert.equal(JSON.parse(saved).decks.length, 0);
  assert.equal(engine.getDeck("spotify:playlist:huge")?.order.length, 6000);
});

test("recovers from corrupt JSON, handles QuotaExceededError, and performs zero writes when idle", () => {
  // Corrupt JSON does not throw and does not write during constructor
  const corruptStore = createMemoryStorage({ [SHUFFLE_STORAGE_KEY]: "{not-valid-json" });
  const fromCorrupt = new TrueShuffleEngine({ storage: corruptStore });
  assert.equal(fromCorrupt.getMode(), "off");
  assert.equal(corruptStore.writes, 0);

  // Wrong version or malformed deck fields recover gracefully
  const badSchemaStore = createMemoryStorage({
    [SHUFFLE_STORAGE_KEY]: JSON.stringify({
      version: 1,
      mode: "bogus",
      decks: [
        { contextUri: "spotify:user:u:collection", order: [{ uri: "spotify:track:1" }], cursor: 99, updatedAt: 10 },
        { contextUri: "", order: [] },
      ],
    }),
  });
  const fromBadSchema = new TrueShuffleEngine({ storage: badSchemaStore });
  assert.equal(fromBadSchema.getMode(), "off");
  const normalizedDeck = fromBadSchema.getDeck("spotify:collection:tracks");
  assert.ok(normalizedDeck);
  assert.equal(normalizedDeck.cursor, 0);
  assert.equal(badSchemaStore.writes, 0);

  // Read-only queries when idle perform zero storage writes
  const idleStore = createMemoryStorage();
  const idleEngine = new TrueShuffleEngine({ storage: idleStore });
  assert.equal(idleEngine.getMode(), "off");
  assert.equal(idleEngine.getDeck("spotify:playlist:none"), null);
  assert.equal(idleEngine.current("spotify:playlist:none"), null);
  assert.deepEqual(idleEngine.peekNext("spotify:playlist:none", 3), []);
  assert.equal(idleStore.writes, 0);

  // QuotaExceededError resilience: drops oldest decks progressively, then swallows if still full
  const quotaStore = createMemoryStorage();
  const qEngine = new TrueShuffleEngine({
    storage: quotaStore,
    maxContexts: DEFAULT_MAX_CONTEXTS,
    rng: createMulberry32(3),
  });
  qEngine.setMode("true");
  qEngine.prepareDeck("spotify:playlist:old", makeTracks(4));
  // Fail whenever payload includes "playlist:old"
  quotaStore.failOnWrite = (_k, value) => value.includes("playlist:old");
  qEngine.prepareDeck("spotify:playlist:new", makeTracks(4));
  const persisted = JSON.parse(quotaStore.data.get(SHUFFLE_STORAGE_KEY)!);
  assert.equal(persisted.decks.length, 1);
  assert.equal(persisted.decks[0].contextUri, "spotify:playlist:new");

  // If every write throws, engine stays operational in memory
  quotaStore.failOnWrite = () => true;
  const advanced = qEngine.advance("spotify:playlist:new");
  assert.ok(advanced);
});

test("default storage lookup in Node emits no ExperimentalWarning and does not throw", () => {
  let warned = false;
  const onWarning = (w: Error) => {
    if (w.name === "ExperimentalWarning" && w.message.includes("localStorage")) {
      warned = true;
    }
  };
  process.on("warning", onWarning);
  try {
    const engine = new TrueShuffleEngine();
    assert.equal(engine.getMode(), "off");
    assert.equal(engine.cycleMode(), "spotify");
    assert.equal(warned, false);
  } finally {
    process.off("warning", onWarning);
  }
});
