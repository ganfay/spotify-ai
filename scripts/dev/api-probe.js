// Read-only probe of the internal Spotify client APIs the agent wants to use.
// Runs inside the client (see cdp-eval.mjs). It never creates, changes or
// deletes anything, and it reports only shapes and counts — no names.
(async () => {
  const S = window.Spicetify;
  const out = { spicetify: !!S, checks: [] };
  if (!S) return out;
  const P = S.Platform ?? {};
  out.spotifyVersion = P.version ?? S.Platform?.PlatformData?.client_version_triple ?? null;
  out.platformApis = Object.keys(P).filter((k) => /API$/.test(k)).sort();

  const shape = (v, depth = 0) => {
    if (v === null) return "null";
    if (Array.isArray(v)) return v.length ? [`${v.length}×`, shape(v[0], depth + 1)] : "[]";
    if (typeof v === "object") {
      if (depth >= 2) return "{…}";
      return Object.fromEntries(Object.keys(v).slice(0, 25).map((k) => [k, shape(v[k], depth + 1)]));
    }
    return typeof v;
  };

  const check = async (name, fn) => {
    const t0 = performance.now();
    try {
      const info = await fn();
      out.checks.push({ name, ok: true, ms: Math.round(performance.now() - t0), ...info });
      return info;
    } catch (e) {
      out.checks.push({ name, ok: false, ms: Math.round(performance.now() - t0), error: String(e?.message ?? e).slice(0, 200) });
      return null;
    }
  };
  const methods = (api) => (api ? Object.getOwnPropertyNames(Object.getPrototypeOf(api)).filter((m) => m !== "constructor").sort() : null);
  const cosmos = async (url) => {
    const res = await S.CosmosAsync.get(url);
    if (res && typeof res === "object" && "code" in res && "error" in res) throw new Error(`HTTP ${res.code}: ${res.error}`);
    return res;
  };

  out.methods = {
    RootlistAPI: methods(P.RootlistAPI),
    PlaylistAPI: methods(P.PlaylistAPI),
    LibraryAPI: methods(P.LibraryAPI),
  };

  // --- playlists and folders
  let playlistUri = null;
  let trackUri = null;
  await check("RootlistAPI.getContents", async () => {
    const root = await P.RootlistAPI.getContents();
    const flat = [];
    const walk = (items) => items.forEach((i) => (i.type === "folder" ? walk(i.items ?? []) : flat.push(i)));
    walk(root.items ?? []);
    const owned = flat.filter((p) => p.type === "playlist" && p.isOwnedBySelf !== false);
    playlistUri = (owned.sort((a, b) => (b.totalLength ?? 0) - (a.totalLength ?? 0))[0] ?? flat[0])?.uri ?? null;
    return { playlists: flat.length, folders: (root.items ?? []).filter((i) => i.type === "folder").length, itemShape: shape(flat[0]) };
  });

  // --- tracks of the biggest own playlist
  await check("PlaylistAPI.getContents", async () => {
    const res = await P.PlaylistAPI.getContents(playlistUri, { limit: 9999999 });
    trackUri = res.items?.find((t) => t.uri?.startsWith("spotify:track:"))?.uri ?? null;
    return { tracks: res.items?.length, totalLength: res.totalLength, topKeys: Object.keys(res), itemShape: shape(res.items?.[0]) };
  });
  await check("PlaylistAPI.getMetadata", async () => ({ shape: shape(await P.PlaylistAPI.getMetadata(playlistUri)) }));

  // --- liked songs
  await check("LibraryAPI.getTracks", async () => {
    const res = await P.LibraryAPI.getTracks({ limit: 9999999 });
    return { tracks: res.items?.length, itemShape: shape(res.items?.[0]) };
  });

  // --- per-track data through the session
  const id = trackUri?.split(":")[2];
  const hex = id ? S.URI.idToHex?.(id) ?? null : null;
  out.hasIdToHex = !!hex;
  await check("spclient metadata/4/track (ISRC, popularity)", async () => {
    const m = await cosmos(`https://spclient.wg.spotify.com/metadata/4/track/${hex}?market=from_token&alt=json`);
    return { hasIsrc: !!m.external_id?.some((x) => x.type === "isrc"), popularity: typeof m.popularity, keys: Object.keys(m) };
  });
  await check("spclient audio-features", async () => {
    const f = await cosmos(`https://spclient.wg.spotify.com/audio-attributes/v1/audio-features/${id}?format=json`);
    return { shape: shape(f) };
  });
  await check("spclient color-lyrics (lyrics of any track)", async () => {
    const l = await cosmos(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`);
    return { syncType: l.lyrics?.syncType, lines: l.lyrics?.lines?.length, language: l.lyrics?.language };
  });

  // --- similar tracks
  await check("PlaylistAPI.getRecommendedTracks", async () => {
    const r = await P.PlaylistAPI.getRecommendedTracks(playlistUri, 0, 20);
    return { shape: shape(r) };
  });
  await check("spclient inspiredby-mix (radio for a track)", async () => {
    const r = await cosmos(`https://spclient.wg.spotify.com/inspiredby-mix/v2/seed_to_playlist/${trackUri}?response-format=json`);
    return { hasPlaylist: !!r.mediaItems?.[0]?.uri, shape: shape(r) };
  });

  // --- search and GraphQL
  out.graphqlDefinitions = Object.keys(S.GraphQL?.Definitions ?? {}).filter((k) => /search|radio|related|getTrack|queryArtist|fetchPlaylist|getAlbum/i.test(k)).sort();
  await check("GraphQL searchTracks", async () => {
    const def = S.GraphQL.Definitions.searchTracks ?? S.GraphQL.Definitions.searchDesktop;
    const r = await S.GraphQL.Request(def, { searchTerm: "Океан Ельзи", offset: 0, limit: 5, numberOfTopResults: 5, includePreReleases: false, includeAudiobooks: false });
    if (r.errors) throw new Error(JSON.stringify(r.errors).slice(0, 150));
    const items = r.data?.searchV2?.tracksV2?.items ?? r.data?.searchV2?.tracks?.items ?? [];
    return { hits: items.length, topKeys: Object.keys(r.data?.searchV2 ?? {}), itemShape: shape(items[0]) };
  });

  // --- public Web API with the client token (expected to be throttled)
  await check("api.spotify.com/v1/me (expected 429)", async () => ({ shape: shape(await cosmos("https://api.spotify.com/v1/me")) }));

  // --- UI surfaces
  out.ui = {
    TopbarButton: typeof S.Topbar?.Button,
    PlaybarButton: typeof S.Playbar?.Button,
    PopupModal: typeof S.PopupModal?.display,
    Panel: typeof S.Panel?.registerPanel,
    ContextMenu: typeof S.ContextMenu?.Item,
    History: typeof P.History?.push,
    React: typeof S.React?.createElement,
  };
  return out;
})()
