// Live test, run inside the Spotify client (see build.mjs --test). READ-ONLY.
// The real agent on a real playlist, with the shared proxy told to use one
// fallback provider at a time. Each run costs one of the hourly prompts.

import { Agent } from "../src/agent/loop";
import type { SpotifyPort } from "../src/agent/proposals";
import { loadSettings } from "../src/settings";
import * as spotify from "../src/spotify/adapter";
import { getTrackData } from "../src/spotify/facts";

const port: SpotifyPort = { ...spotify, getTrackData, getRecommendations: (uri) => spotify.getRecommendations(uri), searchTracks: (q) => spotify.searchTracks(q) };
const MODELS = ["or:nvidia/nemotron-3.5-lightning:free", "cf:@cf/zai-org/glm-4.7-flash"];

export async function run(): Promise<unknown> {
  const saved = loadSettings();
  const target = (await spotify.listPlaylists()).find((p) => p.editable && p.trackCount >= 20 && p.trackCount <= 150);
  if (!target) return { error: "no playlist of 20-150 tracks to test on" };
  const prompt = `Take the playlist "${target.name}" and prepare a new playlist with only the tracks that are NOT in Russian.`;
  const out: unknown[] = [{ playlist: target.name, tracks: target.trackCount }];
  for (const proxyModel of MODELS) {
    const tools: string[] = [];
    const started = Date.now();
    try {
      const result = await new Agent({ ...saved, mode: "proxy", proxyModel }, port).run(prompt, (e) => { if (e.type === "tool") tools.push(e.name); });
      const proposal = result.proposals[0] as { kind: string; tracks?: { selected: boolean; unsure?: boolean }[] } | undefined;
      out.push({
        proxyModel, ok: !result.incomplete, seconds: Math.round((Date.now() - started) / 1000), steps: result.steps, tools, text: result.text.slice(0, 220),
        proposal: proposal ? { kind: proposal.kind, tracks: proposal.tracks?.length, selected: proposal.tracks?.filter((t) => t.selected).length } : null,
      });
    } catch (e) {
      out.push({ proxyModel, ok: false, seconds: Math.round((Date.now() - started) / 1000), tools, error: String((e as Error).message).slice(0, 220), code: (e as { code?: string }).code });
    }
  }
  return out;
}
