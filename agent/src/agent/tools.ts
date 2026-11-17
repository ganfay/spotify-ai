// The tools the model can call. All of them only READ or PROPOSE (decision 17):
// there is no tool that changes the user's library.
//
// The model never sees Spotify URIs. Playlists are "p1", "p2", …; tracks of a
// playlist are "t1", "t2", … (their position). Short ids save tokens and an
// invented id is caught here instead of reaching Spotify.

import { findDuplicates } from "../features/duplicates";
import type { Playlist, Track } from "../spotify/types";
import type { Proposal, ProposedTrack, SpotifyPort } from "./proposals";

const PAGE = 1000;

import type { ToolSpec } from "../llm/types";

export const TOOL_DECLARATIONS: ToolSpec[] = [
  {
    name: "list_playlists",
    description: "List the user's playlists with their ids, names and sizes. Call this first to find the playlist the user means.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_tracks",
    description:
      "Read tracks of a playlist. Returns lines: 'tN | title | artists | album | m:ss | date added'. " +
      `At most ${PAGE} tracks per call; use offset for more.`,
    parameters: {
      type: "object",
      properties: {
        playlist_id: { type: "string", description: "Id from list_playlists, e.g. p3" },
        offset: { type: "integer", description: "0-based index of the first track to return. Default 0." },
      },
      required: ["playlist_id"],
    },
  },
  {
    name: "get_track_data",
    description:
      "Facts from Spotify about the tracks of a playlist. fields: 'language' = language of performance as an ISO code " +
      "(uk Ukrainian, ru Russian, en English …; zxx = no words; ? = unknown) plus popularity 0-100; " +
      "'mood' = energy (0 calm … 1 intense), valence (0 sad/dark … 1 happy/bright), danceability, tempo (BPM), acousticness. " +
      "Returns lines 'tN | …'. Use it before filtering by language or splitting by mood/energy — do not guess from titles. " +
      `At most ${PAGE} tracks per call; use offset for more. Can take up to a minute for a big playlist.`,
    parameters: {
      type: "object",
      properties: {
        playlist_id: { type: "string" },
        fields: { type: "array", items: { type: "string", enum: ["language", "mood"] } },
        offset: { type: "integer" },
      },
      required: ["playlist_id", "fields"],
    },
  },
  {
    name: "find_duplicates",
    description:
      "Find duplicate tracks in a playlist with exact rules (same track twice, or different releases of one song). " +
      "Use this instead of comparing titles yourself.",
    parameters: {
      type: "object",
      properties: { playlist_id: { type: "string" } },
      required: ["playlist_id"],
    },
  },
  {
    name: "recommend_tracks",
    description:
      "Spotify's own suggestions of NEW tracks for a playlist (not yet in it). Returns candidates as lines 'cN | title | artists | album'. " +
      "These are raw candidates: choose the ones that really fit.",
    parameters: { type: "object", properties: { playlist_id: { type: "string" } }, required: ["playlist_id"] },
  },
  {
    name: "search_tracks",
    description:
      "Search Spotify's catalogue for a track, e.g. 'Artist Title'. Returns up to 5 matches as 'cN | title | artists | album'. " +
      "Use it to check that a song you have in mind exists and to get its id.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "propose_additions",
    description:
      "Propose NEW tracks for a playlist, each with a reason. Only 'cN' ids from recommend_tracks or search_tracks are accepted. " +
      "Nothing is added until the user approves.",
    parameters: {
      type: "object",
      properties: {
        playlist_id: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { track_id: { type: "string", description: "cN id" }, reason: { type: "string", description: "Why it fits this playlist, in the user's language" } },
            required: ["track_id", "reason"],
          },
        },
        summary: { type: "string" },
      },
      required: ["playlist_id", "items", "summary"],
    },
  },
  {
    name: "propose_new_playlist",
    description:
      "Propose a NEW playlist built from tracks of an existing one. Nothing is created until the user approves. " +
      "Give either track_ids (tracks to include) or exclude_track_ids (take everything except these) — whichever list is shorter. " +
      "Put tracks you are not sure about into 'unsure' with a reason; the user decides about them.",
    parameters: {
      type: "object",
      properties: {
        source_playlist_id: { type: "string" },
        name: { type: "string", description: "Name of the new playlist" },
        description: { type: "string" },
        track_ids: { type: "array", items: { type: "string" } },
        exclude_track_ids: { type: "array", items: { type: "string" } },
        unsure: {
          type: "array",
          items: {
            type: "object",
            properties: { track_id: { type: "string" }, reason: { type: "string" } },
            required: ["track_id", "reason"],
          },
        },
        summary: { type: "string", description: "One sentence for the user: what this playlist is and why." },
      },
      required: ["source_playlist_id", "name", "summary"],
    },
  },
  {
    name: "propose_removal",
    description:
      "Propose removing tracks from a playlist, each with a short reason. Nothing is removed until the user approves; " +
      "the user can untick tracks. Use for duplicates and for tracks that do not fit.",
    parameters: {
      type: "object",
      properties: {
        playlist_id: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              track_id: { type: "string" },
              reason: { type: "string", description: "Short reason, in the user's language" },
              sure: { type: "boolean", description: "false = shown unticked, the user decides" },
            },
            required: ["track_id", "reason"],
          },
        },
        summary: { type: "string" },
      },
      required: ["playlist_id", "items", "summary"],
    },
  },
  {
    name: "propose_split",
    description:
      "Propose splitting a playlist into several NEW playlists (by mood, genre, energy, language …). " +
      "Every track should be in exactly one group. Nothing is created until the user approves.",
    parameters: {
      type: "object",
      properties: {
        source_playlist_id: { type: "string" },
        groups: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, track_ids: { type: "array", items: { type: "string" } } },
            required: ["name", "track_ids"],
          },
        },
        summary: { type: "string" },
      },
      required: ["source_playlist_id", "groups", "summary"],
    },
  },
];

type Args = Record<string, unknown>;
type Result = Record<string, unknown>;

const time = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const clean = (s: string) => s.replace(/[|\n\r]+/g, " ").trim();

/** One conversation's tools: remembers what was read and collects proposals. */
export class Toolbox {
  readonly proposals: Proposal[] = [];
  private playlists: Playlist[] | null = null;
  private readonly tracks = new Map<string, Track[]>();
  /** Tracks found outside the user's playlists: "c1", "c2", … */
  private readonly catalogue: Track[] = [];

  /** Set by the agent: receives short progress texts of long-running tools. */
  notify: (text: string) => void = () => {};

  constructor(private readonly spotify: SpotifyPort) {}

  /** Runs a tool. Problems come back as { error } so the model can correct itself. */
  async call(name: string, args: Args): Promise<Result> {
    try {
      switch (name) {
        case "list_playlists": return await this.listPlaylists();
        case "get_tracks": return await this.getTracks(args);
        case "get_track_data": return await this.getTrackData(args);
        case "find_duplicates": return await this.findDuplicates(args);
        case "recommend_tracks": return await this.recommendTracks(args);
        case "search_tracks": return await this.searchTracks(args);
        case "propose_additions": return await this.proposeAdditions(args);
        case "propose_new_playlist": return await this.proposeNewPlaylist(args);
        case "propose_removal": return await this.proposeRemoval(args);
        case "propose_split": return await this.proposeSplit(args);
        default: return { error: `Unknown tool "${name}".` };
      }
    } catch (error) {
      return { error: String((error as Error)?.message ?? error) };
    }
  }

  private async listPlaylists(): Promise<Result> {
    this.playlists = await this.spotify.listPlaylists();
    return {
      playlists: this.playlists.map((p, i) => ({
        id: `p${i + 1}`, name: p.name, tracks: p.trackCount, owner: p.ownerName, can_edit: p.editable,
      })),
    };
  }

  private async playlist(id: unknown): Promise<{ playlist: Playlist; tracks: Track[] }> {
    if (!this.playlists) this.playlists = await this.spotify.listPlaylists();
    const index = typeof id === "string" && /^p\d+$/.test(id) ? Number(id.slice(1)) - 1 : -1;
    const playlist = this.playlists[index];
    if (!playlist) throw new Error(`No playlist with id "${String(id)}". Call list_playlists and use an id from it.`);
    let tracks = this.tracks.get(playlist.uri);
    if (!tracks) {
      tracks = await this.spotify.getTracks(playlist.uri);
      this.tracks.set(playlist.uri, tracks);
    }
    return { playlist, tracks };
  }

  /** Turns "t12" into the track; unknown ids are collected, not guessed. */
  private pick(tracks: Track[], ids: unknown, bad: string[]): Track[] {
    const out: Track[] = [];
    const seen = new Set<number>();
    for (const id of Array.isArray(ids) ? ids : []) {
      const index = typeof id === "string" && /^t\d+$/.test(id) ? Number(id.slice(1)) - 1 : -1;
      const track = tracks[index];
      if (!track) bad.push(String(id));
      else if (!seen.has(index)) {
        seen.add(index);
        out.push(track);
      }
    }
    return out;
  }

  private async getTracks(args: Args): Promise<Result> {
    const { playlist, tracks } = await this.playlist(args.playlist_id);
    const offset = Math.max(0, Number(args.offset ?? 0) || 0);
    const page = tracks.slice(offset, offset + PAGE);
    return {
      playlist: playlist.name,
      total: tracks.length,
      offset,
      returned: page.length,
      has_more: offset + page.length < tracks.length,
      tracks: page
        .map((t, i) => [`t${offset + i + 1}`, clean(t.name), clean(t.artists.join(", ")), clean(t.album), time(t.durationMs), t.addedAt.slice(0, 10)].join(" | "))
        .join("\n"),
    };
  }

  private async getTrackData(args: Args): Promise<Result> {
    const { playlist, tracks } = await this.playlist(args.playlist_id);
    const fields = (Array.isArray(args.fields) ? args.fields : []).filter((f): f is "language" | "mood" => f === "language" || f === "mood");
    if (fields.length === 0) return { error: "fields must contain 'language' and/or 'mood'." };
    const offset = Math.max(0, Number(args.offset ?? 0) || 0);
    const page = tracks.slice(offset, offset + PAGE);
    const facts = await this.spotify.getTrackData(page.map((t) => t.uri), fields, (done, total) => this.notify(`Reading track data ${done}/${total}`));
    const num = (v: number | undefined, digits = 2) => (v === undefined ? "?" : v.toFixed(digits));
    const lines = page.map((t, i) => {
      const f = facts.get(t.uri) ?? {};
      const parts = [`t${offset + i + 1}`, clean(t.name), clean(t.artists.join(", "))];
      if (fields.includes("language")) parts.push(`lang=${f.language || "?"}`, `pop=${f.popularity ?? "?"}`);
      if (fields.includes("mood")) parts.push(`energy=${num(f.energy)} valence=${num(f.valence)} dance=${num(f.danceability)} tempo=${num(f.tempo, 0)} acoustic=${num(f.acousticness)}`);
      return parts.join(" | ");
    });
    return { playlist: playlist.name, total: tracks.length, offset, returned: page.length, has_more: offset + page.length < tracks.length, tracks: lines.join("\n") };
  }

  private async findDuplicates(args: Args): Promise<Result> {
    const { playlist, tracks } = await this.playlist(args.playlist_id);
    const position = new Map(tracks.map((t, i) => [t.uid, i + 1]));
    const groups = findDuplicates(tracks);
    return {
      playlist: playlist.name,
      total_tracks: tracks.length,
      groups: groups.map((g) => ({
        kind: g.kind === "exact" ? "same track twice" : "different releases of one song",
        tracks: g.entries.map((e) => ({
          id: `t${position.get(e.track.uid)}`, title: e.track.name, artists: e.track.artists.join(", "),
          album: e.track.album, length: time(e.track.durationMs), version: e.tags.join(", ") || "plain",
          suggested_to_remove: e.suggested,
        })),
      })),
    };
  }

  /** Registers found tracks and returns their 'cN | …' lines. */
  private candidates(found: Track[]): string {
    return found.map((track) => {
      let index = this.catalogue.findIndex((t) => t.uri === track.uri);
      if (index === -1) index = this.catalogue.push(track) - 1;
      return [`c${index + 1}`, clean(track.name), clean(track.artists.join(", ")), clean(track.album)].join(" | ");
    }).join("\n");
  }

  private async recommendTracks(args: Args): Promise<Result> {
    const { playlist, tracks } = await this.playlist(args.playlist_id);
    const present = new Set(tracks.map((t) => t.uri));
    const found = (await this.spotify.getRecommendations(playlist.uri)).filter((t) => !present.has(t.uri));
    return { playlist: playlist.name, candidates: found.length, tracks: this.candidates(found) };
  }

  private async searchTracks(args: Args): Promise<Result> {
    const query = String(args.query ?? "").trim();
    if (!query) return { error: "query is empty." };
    const found = await this.spotify.searchTracks(query);
    return found.length ? { matches: found.length, tracks: this.candidates(found) } : { matches: 0, note: "Nothing found. Try a simpler query or another song." };
  }

  private async proposeAdditions(args: Args): Promise<Result> {
    const { playlist, tracks } = await this.playlist(args.playlist_id);
    const items = Array.isArray(args.items) ? (args.items as { track_id?: unknown; reason?: unknown }[]) : [];
    const present = new Set(tracks.map((t) => t.uri));
    const bad: string[] = [];
    const list: ProposedTrack[] = [];
    let already = 0;
    for (const item of items) {
      const index = typeof item.track_id === "string" && /^c\d+$/.test(item.track_id) ? Number(item.track_id.slice(1)) - 1 : -1;
      const track = this.catalogue[index];
      if (!track) bad.push(String(item.track_id));
      else if (present.has(track.uri)) already++;
      else if (!list.some((t) => t.track.uri === track.uri)) list.push({ track: { ...track, uid: `new-${index}` }, reason: String(item.reason ?? ""), selected: true });
    }
    if (bad.length) return { error: `Unknown ids: ${bad.slice(0, 10).join(", ")}. Only cN ids from recommend_tracks or search_tracks can be proposed.` };
    if (list.length === 0) return { error: "No new tracks to propose (all are already in the playlist or the list is empty)." };
    const id = this.newId();
    this.proposals.push({ id, kind: "additions", playlist, tracks: list, summary: String(args.summary ?? "") });
    return { ok: true, proposal_id: id, tracks: list.length, skipped_already_in_playlist: already, note: "Shown to the user for approval. Nothing has been added." };
  }

  private newId(): string {
    return `proposal-${this.proposals.length + 1}`;
  }

  private async proposeNewPlaylist(args: Args): Promise<Result> {
    const { tracks } = await this.playlist(args.source_playlist_id);
    const name = String(args.name ?? "").trim();
    if (!name) return { error: "name is required." };
    const bad: string[] = [];
    const unsureList = Array.isArray(args.unsure) ? (args.unsure as { track_id?: unknown; reason?: unknown }[]) : [];
    const unsure = new Map<string, string>();
    for (const item of unsureList) {
      const [track] = this.pick(tracks, [item.track_id], bad);
      if (track) unsure.set(track.uid, String(item.reason ?? ""));
    }
    const hasInclude = Array.isArray(args.track_ids) && args.track_ids.length > 0;
    const hasExclude = Array.isArray(args.exclude_track_ids);
    if (!hasInclude && !hasExclude) return { error: "Give track_ids or exclude_track_ids." };
    let chosen: Track[];
    if (hasInclude) {
      chosen = this.pick(tracks, args.track_ids, bad);
    } else {
      const excluded = new Set(this.pick(tracks, args.exclude_track_ids, bad).map((t) => t.uid));
      chosen = tracks.filter((t) => !excluded.has(t.uid));
    }
    if (bad.length) return { error: `Unknown track ids: ${bad.slice(0, 10).join(", ")}. Use ids from get_tracks.` };
    const included = new Set(chosen.map((t) => t.uid));
    const list: ProposedTrack[] = chosen.filter((t) => !unsure.has(t.uid)).map((track) => ({ track, reason: "", selected: true }));
    // Unsure tracks are listed first and unticked: the user decides.
    const unsureTracks: ProposedTrack[] = tracks
      .filter((t) => unsure.has(t.uid))
      .map((track) => ({ track, reason: unsure.get(track.uid)!, selected: false }));
    if (list.length + unsureTracks.length === 0) return { error: "The proposal has no tracks." };
    const id = this.newId();
    this.proposals.push({
      id, kind: "new_playlist", name, description: String(args.description ?? ""), summary: String(args.summary ?? ""),
      tracks: [...unsureTracks, ...list],
    });
    return {
      ok: true, proposal_id: id, tracks_in_playlist: list.length, unsure_for_user: unsureTracks.length,
      left_out: tracks.length - included.size - unsureTracks.filter((u) => !included.has(u.track.uid)).length,
      note: "Shown to the user for approval. Nothing has been created yet.",
    };
  }

  private async proposeRemoval(args: Args): Promise<Result> {
    const { playlist, tracks } = await this.playlist(args.playlist_id);
    const items = Array.isArray(args.items) ? (args.items as { track_id?: unknown; reason?: unknown; sure?: unknown }[]) : [];
    if (items.length === 0) return { error: "items is empty." };
    const bad: string[] = [];
    const list: ProposedTrack[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const [track] = this.pick(tracks, [item.track_id], bad);
      if (!track || seen.has(track.uid)) continue;
      seen.add(track.uid);
      list.push({ track, reason: String(item.reason ?? ""), selected: item.sure !== false });
    }
    if (bad.length) return { error: `Unknown track ids: ${bad.slice(0, 10).join(", ")}. Use ids from get_tracks.` };
    const id = this.newId();
    this.proposals.push({ id, kind: "removal", playlist, allTracks: tracks, tracks: list, summary: String(args.summary ?? "") });
    return { ok: true, proposal_id: id, tracks: list.length, note: "Shown to the user for approval. Nothing has been removed." };
  }

  private async proposeSplit(args: Args): Promise<Result> {
    const { playlist, tracks } = await this.playlist(args.source_playlist_id);
    const raw = Array.isArray(args.groups) ? (args.groups as { name?: unknown; track_ids?: unknown }[]) : [];
    if (raw.length < 2) return { error: "A split needs at least 2 groups." };
    const bad: string[] = [];
    const used = new Set<string>();
    let twice = 0;
    const groups = raw.map((g) => {
      const picked = this.pick(tracks, g.track_ids, bad).filter((t) => {
        if (used.has(t.uid)) {
          twice++;
          return false; // a track stays in the first group that claimed it
        }
        used.add(t.uid);
        return true;
      });
      return { name: String(g.name ?? "").trim() || "Untitled", tracks: picked };
    }).filter((g) => g.tracks.length > 0);
    if (bad.length) return { error: `Unknown track ids: ${bad.slice(0, 10).join(", ")}. Use ids from get_tracks.` };
    if (groups.length < 2) return { error: "After checking, fewer than 2 groups have tracks." };
    const leftOut = tracks.length - used.size;
    const id = this.newId();
    this.proposals.push({ id, kind: "split", source: playlist, groups, leftOut, summary: String(args.summary ?? "") });
    return {
      ok: true, proposal_id: id, groups: groups.map((g) => ({ name: g.name, tracks: g.tracks.length })),
      tracks_in_no_group: leftOut, tracks_listed_twice_kept_in_first_group: twice,
      note: leftOut > 0 ? "Some tracks are in no group. Call propose_split again with all tracks if that was not intended." : "Shown to the user for approval.",
    };
  }
}
