// Extra facts about tracks that Spotify's client can provide: the language of
// performance and the audio "mood" numbers. One request per track, so results
// are fetched a few at a time and remembered on this computer.

import { getAudioFeatures, getTrackInfo } from "./adapter";

export type FactField = "language" | "mood";

export interface TrackFacts {
  /** ISO code from Spotify ("uk", "ru", "en" …); "zxx" = no words; "" = unknown. */
  language?: string;
  /** 0–100. */
  popularity?: number;
  /** 0 calm … 1 intense. */
  energy?: number;
  /** 0 sad/dark … 1 happy/bright. */
  valence?: number;
  danceability?: number;
  tempo?: number;
  acousticness?: number;
}

const KEY = "spotify-ai:facts:v1";
const MAX_CACHED = 6000;
const PARALLEL = 6;

let cache: Record<string, TrackFacts> | null = null;

function load(): Record<string, TrackFacts> {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, TrackFacts>;
  } catch {
    cache = {};
  }
  return cache;
}

function save(): void {
  const all = load();
  const keys = Object.keys(all);
  // Oldest entries (inserted first) are dropped when the cache grows too big.
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_CACHED))) delete all[key];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage full: the facts still work for this session
  }
}

const has = (facts: TrackFacts | undefined, field: FactField): boolean =>
  !!facts && (field === "language" ? facts.language !== undefined : facts.energy !== undefined);

/**
 * Facts for many tracks. Missing ones are fetched, PARALLEL at a time.
 * A track whose data cannot be fetched simply has that field missing.
 */
export async function getTrackData(
  uris: string[],
  fields: FactField[],
  onProgress: (done: number, total: number) => void = () => {},
): Promise<Map<string, TrackFacts>> {
  const all = load();
  const jobs: { uri: string; field: FactField }[] = [];
  for (const uri of new Set(uris)) {
    if (!uri.startsWith("spotify:track:")) continue;
    for (const field of fields) if (!has(all[uri], field)) jobs.push({ uri, field });
  }
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const { uri, field } = jobs[next++]!;
      try {
        const part = field === "language" ? await getTrackInfo(uri) : await getAudioFeatures(uri);
        all[uri] = { ...all[uri], ...part };
      } catch {
        // leave the field missing
      }
      if (++done % 10 === 0 || done === jobs.length) onProgress(done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, worker));
  if (jobs.length) save();
  return new Map(uris.map((uri) => [uri, all[uri] ?? {}]));
}
