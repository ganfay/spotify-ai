// What the agent may hand to the user. A proposal changes nothing by itself:
// the UI shows it, and only the user's click calls apply*() (decisions 8 and 17).

import { type Snapshot, takeSnapshot } from "../snapshots";
import type { FactField, TrackFacts } from "../spotify/facts";
import type { EntryRef, Playlist, Track } from "../spotify/types";

/** The part of the Spotify adapter the agent needs. Lets tests use a fake. */
export interface SpotifyPort {
  listPlaylists(): Promise<Playlist[]>;
  getTracks(playlistUri: string): Promise<Track[]>;
  createPlaylist(name: string): Promise<string>;
  setPlaylistDetails(playlistUri: string, details: { name?: string; description?: string }): Promise<void>;
  addTracks(playlistUri: string, trackUris: string[]): Promise<void>;
  removeEntries(playlistUri: string, entries: EntryRef[]): Promise<void>;
  getRecommendations(playlistUri: string): Promise<Track[]>;
  searchTracks(query: string): Promise<Track[]>;
  getTrackData(uris: string[], fields: FactField[], onProgress?: (done: number, total: number) => void): Promise<Map<string, TrackFacts>>;
}

export interface ProposedTrack {
  track: Track;
  /** Why the agent picked it (shown next to the track). */
  reason: string;
  /** Pre-ticked. Unsure cases come unticked so the user decides. */
  selected: boolean;
}

interface Base {
  id: string;
  summary: string;
}
/** Make one new playlist. `tracks` = candidates; ticked ones go in. */
export interface NewPlaylistProposal extends Base {
  kind: "new_playlist";
  name: string;
  description: string;
  tracks: ProposedTrack[];
}
/** Take tracks out of a playlist. Ticked ones are removed. */
export interface RemovalProposal extends Base {
  kind: "removal";
  playlist: Playlist;
  /** Everything currently in the playlist, to build a cleaned copy. */
  allTracks: Track[];
  tracks: ProposedTrack[];
}
/** Split one playlist into several new ones. */
export interface SplitProposal extends Base {
  kind: "split";
  source: Playlist;
  groups: { name: string; tracks: Track[] }[];
  /** Tracks of the source that are in no group. */
  leftOut: number;
}
/** Add new tracks (found by recommendation or search) to a playlist. Ticked ones are added. */
export interface AdditionsProposal extends Base {
  kind: "additions";
  playlist: Playlist;
  tracks: ProposedTrack[];
}
export type Proposal = NewPlaylistProposal | RemovalProposal | SplitProposal | AdditionsProposal;

export type Applied =
  | { kind: "created"; playlists: { uri: string; name: string; tracks: number }[] }
  | { kind: "removed"; removed: number; snapshot: Snapshot }
  | { kind: "added"; added: number; playlistName: string; snapshot: Snapshot };

const playable = (t: Track) => !t.local;

export async function applyNewPlaylist(spotify: SpotifyPort, p: NewPlaylistProposal): Promise<Applied> {
  const uris = p.tracks.filter((t) => t.selected && playable(t.track)).map((t) => t.track.uri);
  const uri = await spotify.createPlaylist(p.name);
  if (p.description) await spotify.setPlaylistDetails(uri, { description: p.description });
  await spotify.addTracks(uri, uris);
  return { kind: "created", playlists: [{ uri, name: p.name, tracks: uris.length }] };
}

/** The safe default for a removal proposal: a copy without the ticked tracks. */
export async function applyRemovalAsCopy(spotify: SpotifyPort, p: RemovalProposal): Promise<Applied> {
  const drop = new Set(p.tracks.filter((t) => t.selected).map((t) => t.track.uid));
  const uris = p.allTracks.filter((t) => !drop.has(t.uid) && playable(t)).map((t) => t.uri);
  const name = `${p.playlist.name} (cleaned)`;
  const uri = await spotify.createPlaylist(name);
  await spotify.addTracks(uri, uris);
  return { kind: "created", playlists: [{ uri, name, tracks: uris.length }] };
}

/** Removes from the playlist itself. A snapshot is saved first so it can be undone. */
export async function applyRemovalInPlace(spotify: SpotifyPort, p: RemovalProposal): Promise<Applied> {
  const entries = p.tracks.filter((t) => t.selected).map(({ track }) => ({ uri: track.uri, uid: track.uid }));
  const snapshot = await takeSnapshot(p.playlist.uri, p.playlist.name, p.summary);
  await spotify.removeEntries(p.playlist.uri, entries);
  return { kind: "removed", removed: entries.length, snapshot };
}

export async function applySplit(spotify: SpotifyPort, p: SplitProposal): Promise<Applied> {
  const playlists = [];
  // Created in reverse so they end up in the library in the proposed order.
  for (const group of [...p.groups].reverse()) {
    const uris = group.tracks.filter(playable).map((t) => t.uri);
    const uri = await spotify.createPlaylist(group.name);
    await spotify.addTracks(uri, uris);
    playlists.unshift({ uri, name: group.name, tracks: uris.length });
  }
  return { kind: "created", playlists };
}

/** The safe default for recommendations: a separate playlist with the picks. */
export async function applyAdditionsAsNew(spotify: SpotifyPort, p: AdditionsProposal): Promise<Applied> {
  const uris = p.tracks.filter((t) => t.selected).map((t) => t.track.uri);
  const name = `${p.playlist.name} — recommendations`;
  const uri = await spotify.createPlaylist(name);
  await spotify.addTracks(uri, uris);
  return { kind: "created", playlists: [{ uri, name, tracks: uris.length }] };
}

/** Adds to the playlist itself, at the end. A snapshot is saved first so it can be undone. */
export async function applyAdditionsInPlace(spotify: SpotifyPort, p: AdditionsProposal): Promise<Applied> {
  const uris = p.tracks.filter((t) => t.selected).map((t) => t.track.uri);
  const snapshot = await takeSnapshot(p.playlist.uri, p.playlist.name, p.summary);
  await spotify.addTracks(p.playlist.uri, uris);
  return { kind: "added", added: uris.length, playlistName: p.playlist.name, snapshot };
}
