// Live test, run inside the Spotify client (see build.mjs --test). READ-ONLY:
// the agent reads the library and prepares proposals; nothing is applied.
// Runs the same request through the shared proxy and with the saved own key.

import { Agent } from "../src/agent/loop";
import type { SpotifyPort } from "../src/agent/proposals";
import { loadSettings, type Settings } from "../src/settings";
import * as spotify from "../src/spotify/adapter";
import { getTrackData } from "../src/spotify/facts";

const port: SpotifyPort = { ...spotify, getTrackData, getRecommendations: (uri) => spotify.getRecommendations(uri), searchTracks: (q) => spotify.searchTracks(q) };

async function once(label: string, settings: Settings, prompt: string): Promise<Record<string, unknown>> {
  const tools: string[] = [];
  const started = Date.now();
  try {
    const result = await new Agent(settings, port).run(prompt, (e) => { if (e.type === "tool") tools.push(e.name); });
    return {
      label, ok: !result.incomplete, seconds: Math.round((Date.now() - started) / 1000), steps: result.steps, tools,
      text: result.text.slice(0, 200),
      proposals: result.proposals.map((p) => ({ kind: p.kind, summary: String((p as { summary?: string }).summary ?? "").slice(0, 80) })),
    };
  } catch (e) {
    return { label, ok: false, seconds: Math.round((Date.now() - started) / 1000), tools, error: String((e as Error).message).slice(0, 200), code: (e as { code?: string }).code };
  }
}

export async function run(): Promise<unknown> {
  const saved = loadSettings();
  const playlists = (await spotify.listPlaylists()).filter((p) => p.editable && p.trackCount >= 20 && p.trackCount <= 150);
  const target = playlists[0];
  if (!target) return { error: "no playlist of 20-150 tracks to test on" };
  const prompts = [
    `Find duplicate tracks in the playlist "${target.name}".`,
    `Take the playlist "${target.name}" and prepare a new playlist with only the tracks that are NOT in Russian.`,
  ];
  const out: unknown[] = [{ playlist: target.name, tracks: target.trackCount, savedMode: saved.mode, provider: saved.provider, model: saved.model }];
  for (const prompt of prompts) {
    out.push(await once(`proxy: ${prompt.slice(0, 40)}`, { ...saved, mode: "proxy" }, prompt));
    if (saved.apiKey) out.push(await once(`own key: ${prompt.slice(0, 40)}`, { ...saved, mode: "own-key" }, prompt));
  }
  return out;
}
