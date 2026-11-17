// The ONLY file that touches Spotify's internal client APIs (decision 16).
// They are undocumented and can change with a Spotify update, so every call
// is checked for existence first and failures become SpotifyApiError.
// Verified on Spotify 1.3.4.258 — see docs/API_PROBE.md.

import { type EntryRef, type Playlist, type Position, SpotifyApiError, type Track } from "./types";

declare const Spicetify: any;

const ALL = 9_999_999;
const CHUNK = 500;

function api(name: "RootlistAPI" | "PlaylistAPI" | "LibraryAPI", method: string): any {
  const obj = Spicetify?.Platform?.[name];
  if (typeof obj?.[method] !== "function") {
    throw new SpotifyApiError(`Spotify function ${name}.${method} is missing in this client version.`);
  }
  return obj;
}

async function call<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof SpotifyApiError) throw error;
    throw new SpotifyApiError(`${what} failed: ${String((error as Error)?.message ?? error)}`, error);
  }
}

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toTrack(item: any): Track {
  return {
    uri: item.uri,
    uid: item.uid ?? "",
    name: item.name ?? "",
    artists: (item.artists ?? []).map((a: any) => a.name ?? ""),
    album: item.album?.name ?? "",
    durationMs: item.duration?.milliseconds ?? 0,
    addedAt: typeof item.addedAt === "string" ? item.addedAt : "",
    explicit: !!item.isExplicit,
    playable: item.isPlayable !== false,
    local: !!item.isLocal,
    imageUrl: imageUrl((item.album?.images ?? []).find((i: any) => i.label === "small")?.url ?? item.album?.images?.[0]?.url),
  };
}

/** Spotify hands out internal image names; this turns them into normal web addresses. */
function imageUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "";
  if (raw.startsWith("http")) return raw;
  const [, kind, ...rest] = raw.split(":");
  if (kind === "image" && rest[0]) return `https://i.scdn.co/image/${rest[0]}`;
  if (kind === "mosaic" && rest.length) return `https://mosaic.scdn.co/300/${rest.join("")}`;
  return "";
}

function toPlaylist(item: any): Playlist {
  return {
    uri: item.uri,
    name: item.name ?? "",
    description: item.description ?? "",
    ownerName: item.owner?.displayName ?? item.owner?.username ?? "",
    editable: item.canAdd ?? item.isOwnedBySelf ?? false,
    trackCount: item.totalLength ?? 0,
    imageUrl: imageUrl(item.images?.[0]?.url),
  };
}

function location(position: Position): Record<string, unknown> {
  if (position === "start") return { before: "start" };
  if (position === "end") return { after: "end" };
  return position;
}

/** All playlists of the user, folders flattened. */
export async function listPlaylists(): Promise<Playlist[]> {
  const root: any = await call("Reading the playlist list", () => api("RootlistAPI", "getContents").getContents());
  const out: Playlist[] = [];
  const walk = (items: any[]): void => {
    for (const item of items ?? []) {
      if (item.type === "folder") walk(item.items);
      else if (item.type === "playlist") out.push(toPlaylist(item));
    }
  };
  walk(root.items);
  return out;
}

/** Every entry of a playlist, in playlist order. */
export async function getTracks(playlistUri: string): Promise<Track[]> {
  const res: any = await call("Reading playlist tracks", () =>
    api("PlaylistAPI", "getContents").getContents(playlistUri, { limit: ALL }),
  );
  return (res.items ?? []).filter((i: any) => typeof i.uri === "string").map(toTrack);
}

export async function getLikedTracks(): Promise<Track[]> {
  const res: any = await call("Reading Liked Songs", () => api("LibraryAPI", "getTracks").getTracks({ limit: ALL }));
  return (res.items ?? []).map(toTrack);
}

/** Creates an empty playlist at the top of the library and returns its URI. */
export async function createPlaylist(name: string): Promise<string> {
  const res: any = await call("Creating a playlist", () =>
    api("RootlistAPI", "createPlaylist").createPlaylist(name, { before: "start" }),
  );
  const uri = typeof res === "string" ? res : res?.uri;
  if (typeof uri !== "string" || !uri.startsWith("spotify:playlist:")) {
    throw new SpotifyApiError("Spotify did not return the new playlist.");
  }
  return uri;
}

export async function setPlaylistDetails(playlistUri: string, details: { name?: string; description?: string }): Promise<void> {
  await call("Renaming the playlist", () => api("PlaylistAPI", "setAttributes").setAttributes(playlistUri, details));
}

/** Adds tracks in the given order. Large lists go in chunks. */
export async function addTracks(playlistUri: string, trackUris: string[], position: Position = "end"): Promise<void> {
  const playlistApi = api("PlaylistAPI", "add");
  if (position === "end") {
    for (const part of chunks(trackUris)) {
      await call("Adding tracks", () => playlistApi.add(playlistUri, part, location("end")));
    }
    return;
  }
  // For any other position, chunks are added last-to-first so the order stays right.
  for (const part of chunks(trackUris).reverse()) {
    await call("Adding tracks", () => playlistApi.add(playlistUri, part, location(position)));
  }
}

/** Removes exactly the given entries; other copies of the same songs stay. */
export async function removeEntries(playlistUri: string, entries: EntryRef[]): Promise<void> {
  const playlistApi = api("PlaylistAPI", "remove");
  for (const part of chunks(entries)) {
    await call("Removing tracks", () =>
      playlistApi.remove(playlistUri, part.map(({ uri, uid }) => ({ uri, uid }))),
    );
  }
}

/**
 * Moves entries to a position. Keeps their "date added".
 * Spotify keeps the relative playlist order of entries moved together, so to
 * put entries into a new order, move them one at a time.
 */
export async function moveEntries(playlistUri: string, entries: EntryRef[], position: Position): Promise<void> {
  if (entries.length === 0) return;
  await call("Reordering tracks", () =>
    api("PlaylistAPI", "move").move(playlistUri, entries.map(({ uri, uid }) => ({ uri, uid })), location(position)),
  );
}

/** Removes the playlist from the user's library and checks that it is gone. */
export async function deletePlaylist(playlistUri: string): Promise<void> {
  const rootlist = api("RootlistAPI", "remove");
  await call("Deleting the playlist", () => rootlist.remove([{ uri: playlistUri }]));
  const all = await listPlaylists();
  if (all.some((p) => p.uri === playlistUri)) {
    throw new SpotifyApiError("Spotify did not delete the playlist.");
  }
}

// --- per-track facts through the session (verified in docs/API_PROBE.md)

async function spclient(path: string): Promise<any> {
  const cosmos = Spicetify?.CosmosAsync;
  if (typeof cosmos?.get !== "function") throw new SpotifyApiError("Spotify's request function is missing in this client version.");
  const res = await cosmos.get(`https://spclient.wg.spotify.com${path}`);
  // CosmosAsync does not throw on HTTP errors; it returns { code, error }.
  if (res && typeof res === "object" && "code" in res && "error" in res) throw new SpotifyApiError(`Spotify answered ${res.code}.`);
  return res;
}

const trackId = (uri: string): string => uri.split(":")[2] ?? "";

/** Language of performance ("uk", "ru", "en", "zxx" = no words) and popularity. */
export async function getTrackInfo(uri: string): Promise<{ language: string; popularity: number }> {
  const hex = Spicetify?.URI?.idToHex?.(trackId(uri));
  if (!hex) throw new SpotifyApiError("Cannot convert the track id in this client version.");
  const meta = await spclient(`/metadata/4/track/${hex}?market=from_token&alt=json`);
  return { language: meta?.language_of_performance?.[0] ?? "", popularity: meta?.popularity ?? 0 };
}

/** Spotify's audio numbers for a track. */
export async function getAudioFeatures(uri: string): Promise<{ energy: number; valence: number; danceability: number; tempo: number; acousticness: number }> {
  const f = await spclient(`/audio-attributes/v1/audio-features/${trackId(uri)}?format=json`);
  return { energy: f.energy, valence: f.valence, danceability: f.danceability, tempo: f.tempo, acousticness: f.acousticness };
}

// --- finding tracks outside the user's playlists

/** Spotify's own "Recommended songs" for a playlist (at most 50). */
export async function getRecommendations(playlistUri: string, limit = 50): Promise<Track[]> {
  const items: any[] = await call("Reading recommendations", () =>
    api("PlaylistAPI", "getRecommendedTracks").getRecommendedTracks(playlistUri, 0, Math.min(limit, 50)),
  );
  return (items ?? []).filter((i) => typeof i?.uri === "string").map((i) => ({
    uri: i.uri, uid: "", name: i.name ?? "", artists: (i.artists ?? []).map((x: any) => x.name ?? ""), album: i.album?.name ?? "",
    durationMs: typeof i.duration === "number" ? i.duration : 0, addedAt: "", explicit: !!i.explicit, playable: true, local: false,
    imageUrl: imageUrl(i.album?.imageUrl),
  }));
}

/** Catalogue search; returns only tracks. */
export async function searchTracks(query: string, limit = 5): Promise<Track[]> {
  const graphql = Spicetify?.GraphQL;
  const definition = graphql?.Definitions?.searchModalResults;
  if (typeof graphql?.Request !== "function" || !definition) throw new SpotifyApiError("Spotify search is missing in this client version.");
  const res: any = await call("Searching", () => graphql.Request(definition, {
    searchTerm: query, offset: 0, limit: 10, numberOfTopResults: 10,
    includeAudiobooks: false, includePreReleases: false, includeArtistHasConcertsField: false, includeAuthors: false,
  }));
  if (res?.errors?.length) throw new SpotifyApiError("Spotify search failed.");
  const items: any[] = res?.data?.searchV2?.topResultsV2?.itemsV2 ?? [];
  return items.map((i) => i?.item?.data).filter((d) => d?.__typename === "Track" && typeof d.uri === "string").slice(0, limit).map((d) => ({
    uri: d.uri, uid: "", name: d.name ?? "", artists: (d.artists?.items ?? []).map((x: any) => x?.profile?.name ?? ""), album: d.albumOfTrack?.name ?? "",
    durationMs: d.duration?.totalMilliseconds ?? 0, addedAt: "", explicit: false, playable: true, local: false,
    imageUrl: imageUrl((d.albumOfTrack?.coverArt?.sources ?? []).find((x: any) => x.width === 64)?.url ?? d.albumOfTrack?.coverArt?.sources?.[0]?.url),
  }));
}

/** Starts playing a track right away (the same as double-clicking it in Spotify). */
export async function playTrack(uri: string): Promise<void> {
  const player = Spicetify?.Player;
  if (typeof player?.playUri !== "function") throw new SpotifyApiError("Playback is not available in this client version.");
  await call("Starting playback", async () => player.playUri(uri));
}
