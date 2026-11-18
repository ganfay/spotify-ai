// Live test, run inside the Spotify client (see build.mjs --test). READ-ONLY.
// The real agent with Liked Songs as its only source: one request, nothing applied.

import { Agent } from "../src/agent/loop";
import type { SpotifyPort } from "../src/agent/proposals";
import { loadSettings } from "../src/settings";
import * as spotify from "../src/spotify/adapter";
import { getTrackData } from "../src/spotify/facts";

const port: SpotifyPort = { ...spotify, getTrackData, getRecommendations: (uri) => spotify.getRecommendations(uri), searchTracks: (q) => spotify.searchTracks(q) };

export async function run(): Promise<unknown> {
  const tools: string[] = [];
  const started = Date.now();
  try {
    // With a saved own key that mode is used: it has no hourly limit.
    const saved = loadSettings();
    const settings = saved.apiKey ? { ...saved, mode: "own-key" as const } : saved;
    const result = await new Agent(settings, port, undefined, spotify.LIKED_URI).run(
      "Візьми мої улюблені треки і зроби новий плейлист без нічого російського",
      (e) => { if (e.type === "tool") tools.push(e.name); },
    );
    const proposal = result.proposals[0] as { kind: string; name?: string; tracks?: { selected: boolean }[]; source?: { name: string } } | undefined;
    return {
      ok: !result.incomplete, seconds: Math.round((Date.now() - started) / 1000), steps: result.steps, tools, text: result.text.slice(0, 260),
      proposal: proposal ? { kind: proposal.kind, name: proposal.name, source: proposal.source?.name, tracks: proposal.tracks?.length, selected: proposal.tracks?.filter((t) => t.selected).length } : null,
    };
  } catch (e) {
    return { ok: false, seconds: Math.round((Date.now() - started) / 1000), tools, error: String((e as Error).message).slice(0, 240), code: (e as { code?: string }).code };
  }
}
