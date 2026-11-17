// Write probe: creates ONE throw-away playlist, exercises add / remove / move /
// rename on it and deletes it again. Never touches any other playlist.
(async () => {
  const P = Spicetify.Platform, out = { steps: [] };
  const NAME = "spotify-ai test (safe to delete)";
  const step = async (name, fn) => {
    try { out.steps.push({ name, ok: true, ...(await fn()) }); return true; }
    catch (e) { out.steps.push({ name, ok: false, error: String(e?.message ?? e).slice(0, 200) }); return false; }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const read = async (uri) => (await P.PlaylistAPI.getContents(uri, { limit: 100 })).items;
  const liked = (await P.LibraryAPI.getTracks({ limit: 3 })).items.map((t) => t.uri);
  const [A, B, C] = liked;
  let pl = null;
  try {
    await step("createPlaylist", async () => {
      const res = await P.RootlistAPI.createPlaylist(NAME, { before: "start" });
      pl = typeof res === "string" ? res : res?.uri;
      return { returns: typeof res, isPlaylistUri: /^spotify:playlist:/.test(pl ?? "") };
    });
    if (!pl) return out;
    await step("add [A, B, A] at end", async () => {
      await P.PlaylistAPI.add(pl, [A, B, A], { after: "end" });
      await sleep(800);
      const items = await read(pl);
      return { count: items.length, order: items.map((i) => (i.uri === A ? "A" : "B")).join(""), uidsUnique: new Set(items.map((i) => i.uid)).size === items.length };
    });
    let before = await read(pl);
    await step("remove only the 2nd copy of A by uid", async () => {
      const second = before.filter((i) => i.uri === A)[1];
      await P.PlaylistAPI.remove(pl, [{ uri: second.uri, uid: second.uid }]);
      await sleep(800);
      const items = await read(pl);
      return { count: items.length, order: items.map((i) => (i.uri === A ? "A" : "B")).join(""), keptFirstCopy: items[0]?.uid === before[0].uid };
    });
    await step("add C, then move C to the start", async () => {
      await P.PlaylistAPI.add(pl, [C], { after: "end" });
      await sleep(800);
      before = await read(pl);
      const c = before.find((i) => i.uri === C);
      await P.PlaylistAPI.move(pl, [{ uri: c.uri, uid: c.uid }], { before: "start" });
      await sleep(800);
      const items = await read(pl);
      const order = items.map((i) => (i.uri === A ? "A" : i.uri === B ? "B" : "C")).join("");
      const addedAtKept = items.every((i) => before.find((b) => b.uid === i.uid)?.addedAt === i.addedAt);
      return { order, uidsKept: items.every((i) => before.some((b) => b.uid === i.uid)), addedAtKept };
    });
    await step("move A after B (reorder inside)", async () => {
      const items0 = await read(pl);
      const a = items0.find((i) => i.uri === A), b = items0.find((i) => i.uri === B);
      await P.PlaylistAPI.move(pl, [{ uri: a.uri, uid: a.uid }], { after: { uri: b.uri, uid: b.uid } });
      await sleep(800);
      return { order: (await read(pl)).map((i) => (i.uri === A ? "A" : i.uri === B ? "B" : "C")).join("") };
    });
    await step("setAttributes (rename + description)", async () => {
      await P.PlaylistAPI.setAttributes(pl, { name: NAME + " 2", description: "probe" });
      await sleep(800);
      const m = await P.PlaylistAPI.getMetadata(pl);
      return { renamed: m.name === NAME + " 2", description: m.description === "probe" };
    });
  } finally {
    if (pl) {
      await step("delete the test playlist", async () => {
        await P.RootlistAPI.remove([{ uri: pl }]);
        await sleep(1000);
        return { stillThere: await P.RootlistAPI.contains([pl]).then((r) => (Array.isArray(r) ? r[0] : r)).catch(() => "unknown") };
      });
      const root = await P.RootlistAPI.getContents();
      out.leftovers = (root.items ?? []).filter((i) => i.name?.startsWith("spotify-ai test")).length;
    }
  }
  return out;
})()
