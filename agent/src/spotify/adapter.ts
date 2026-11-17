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
