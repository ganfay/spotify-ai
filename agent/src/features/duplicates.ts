// Feature 1: find duplicates. Plain code, no AI.
//
// Two kinds of groups:
//  - "exact":   the very same track (same URI) is in the playlist more than once;
//  - "version": different releases of what looks like the same song
//               (album vs single, remaster, live, acoustic …).
// The user decides what to remove; we only pre-tick the safe cases.

import type { Track } from "../spotify/types";

export type GroupKind = "exact" | "version";

export interface DuplicateEntry {
  track: Track;
  /** Position in the playlist, starting at 1. */
  position: number;
  /** Words that make this release special: "live", "remaster", … Empty for a plain release. */
  tags: string[];
  /** Pre-ticked for removal. */
  suggested: boolean;
}

export interface DuplicateGroup {
  kind: GroupKind;
  entries: DuplicateEntry[];
}

// A version word only counts inside brackets or after " - ", never in the bare title
// ("Live Forever" is a song, "Song - Live" is a live version).
const VERSION_WORDS: [RegExp, string][] = [
  [/\b(live|concert|unplugged)\b/, "live"],
  [/\bre-?master(ed)?\b/, "remaster"],
  [/\b(acoustic|акустик\S*)\b/, "acoustic"],
  [/\b(remix|mix|edit|rework|bootleg|flip)\b/, "remix"],
  [/\binstrumental\b/, "instrumental"],
  [/\b(demo|rough)\b/, "demo"],
  [/\b(sped up|speed up|slowed|reverb|nightcore)\b/, "sped up / slowed"],
  [/\b(cover|karaoke|tribute)\b/, "cover"],
  [/\b(deluxe|bonus|expanded|anniversary|special edition)\b/, "edition"],
  [/\b(single|album|radio|original|explicit|clean|mono|stereo) (version|edit|mix)\b/, "edit"],
  [/\b(version|ver\.?)\b/, "version"],
];
// Tags that do not change the recording in a way the listener cares about.
const SAME_RECORDING_TAGS = new Set(["remaster", "edition", "edit"]);

/** Splits "Song (feat. X) - Live at Y" into the bare title and the decorations. */
function splitTitle(name: string): { base: string; extras: string } {
  const lower = name.toLowerCase().normalize("NFKC");
  const extras: string[] = [];
  let base = lower.replace(/[([{]([^)\]}]*)[)\]}]/g, (_, inner: string) => {
    extras.push(inner);
    return " ";
  });
  const dash = base.search(/\s[-–—]\s/);
  if (dash > 0) {
    extras.push(base.slice(dash + 3));
    base = base.slice(0, dash);
  }
  return { base, extras: extras.join(" | ") };
}

function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents
    .replace(/\b(feat|ft|featuring|with|prod)\b\.?.*$/, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function describe(track: Track): { key: string; tags: string[] } {
  const { base, extras } = splitTitle(track.name);
  const tags = VERSION_WORDS.filter(([re]) => re.test(extras)).map(([, tag]) => tag);
  const artist = normalize((track.artists[0] ?? "").toLowerCase());
  return { key: `${normalize(base)}|${artist}`, tags: [...new Set(tags)] };
}

/**
 * Finds duplicate groups. Order of the result follows the playlist.
 * Suggestions: in an "exact" group every copy after the first is pre-ticked.
 * In a "version" group nothing is pre-ticked unless the releases differ only by
 * remaster / edition / edit — then the later ones are.
 */
export function findDuplicates(tracks: Track[]): DuplicateGroup[] {
  const byKey = new Map<string, DuplicateEntry[]>();
  tracks.forEach((track, index) => {
    if (track.local || !track.name) return;
    const { key, tags } = describe(track);
    if (key.startsWith("|") || key.endsWith("|")) return; // nothing usable to compare
    const list = byKey.get(key) ?? [];
    list.push({ track, position: index + 1, tags, suggested: false });
    byKey.set(key, list);
  });

  const groups: DuplicateGroup[] = [];
  for (const entries of byKey.values()) {
    if (entries.length < 2) continue;
    const seenUris = new Set<string>();
    for (const entry of entries) {
      if (seenUris.has(entry.track.uri)) entry.suggested = true; // exact repeat of an earlier entry
      seenUris.add(entry.track.uri);
    }
    const allSameUri = seenUris.size === 1;
    if (!allSameUri) {
      const sameRecording = entries.every((e) => e.tags.every((t) => SAME_RECORDING_TAGS.has(t)));
      // Durations within 3 s back up the guess that it is the same recording.
      const durations = entries.map((e) => e.track.durationMs);
      const closeDurations = Math.max(...durations) - Math.min(...durations) <= 3000;
      if (sameRecording && closeDurations) entries.slice(1).forEach((e) => (e.suggested = true));
    }
    groups.push({ kind: allSameUri ? "exact" : "version", entries });
  }
  return groups.sort((a, b) => a.entries[0]!.position - b.entries[0]!.position);
}

export function countSuggested(groups: DuplicateGroup[]): number {
  return groups.reduce((n, g) => n + g.entries.filter((e) => e.suggested).length, 0);
}
