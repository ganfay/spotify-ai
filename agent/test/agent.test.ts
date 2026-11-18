// The agent loop against scripted model answers, once per provider format.
// No network: fetch is replaced by a function that returns prepared responses.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent } from "../src/agent/loop";
import { applyAdditionsAsNew, applyNewPlaylist, applyRemovalAsCopy, applySplit, type RemovalProposal, type SpotifyPort } from "../src/agent/proposals";
import { Toolbox } from "../src/agent/tools";
import type { Settings } from "../src/settings";
import type { Playlist, Track } from "../src/spotify/types";

const track = (i: number, name: string, artist: string): Track => ({
  uri: `spotify:track:${i}`, uid: `uid${i}`, name, artists: [artist], album: "Album", durationMs: 180_000,
  addedAt: "2026-01-01T00:00:00Z", explicit: false, playable: true, local: false, imageUrl: "",
});
const TRACKS = [track(1, "Обійми", "Океан Ельзи"), track(2, "Кукла колдуна", "Король и Шут"), track(3, "Stay", "Rihanna"), track(4, "Плакала", "KAZKA")];
const PLAYLIST: Playlist = { uri: "spotify:playlist:a", name: "Mix", description: "", ownerName: "me", editable: true, trackCount: 4, imageUrl: "" };

function fakeSpotify() {
  const created: { name: string; uris: string[] }[] = [];
  const port: SpotifyPort = {
    listPlaylists: async () => [PLAYLIST],
    getTracks: async () => TRACKS,
    createPlaylist: async (name) => (created.push({ name, uris: [] }), `spotify:playlist:new${created.length}`),
    setPlaylistDetails: async () => {},
    addTracks: async (uri, uris) => void created[Number(uri.slice(-1)) - 1]!.uris.push(...uris),
    removeEntries: async () => {},
    getRecommendations: async () => [track(3, "Stay", "Rihanna"), track(10, "Вахтерам", "Бумбокс"), track(11, "Shum", "Go_A")],
    searchTracks: async (q) => (q.includes("ДахаБраха") ? [track(12, "Baby", "ДахаБраха")] : []),
    getTrackData: async (uris, _fields, onProgress) => {
      onProgress?.(uris.length, uris.length);
      const facts: Record<string, object> = {
        "spotify:track:1": { language: "uk", popularity: 60, energy: 0.4, valence: 0.3, danceability: 0.5, tempo: 96, acousticness: 0.6 },
        "spotify:track:2": { language: "ru", popularity: 50, energy: 0.9, valence: 0.5, danceability: 0.4, tempo: 150, acousticness: 0.01 },
        "spotify:track:3": { language: "en", popularity: 90 },
      };
      return new Map(uris.map((u) => [u, facts[u] ?? {}]));
    },
  };
  return { port, created };
}

const base: Settings = { mode: "own-key", proxyUrl: "https://proxy.example", provider: "gemini", apiKey: "KEY", baseUrl: "", installId: "11111111-1111-4111-8111-111111111111", inviteCode: "", model: "m", language: "en" };

// The same four model turns, written in each provider's wire format.
const STEPS = [
  { name: "list_playlists", args: {} },
  { name: "get_tracks", args: { playlist_id: "p1" } },
  { name: "propose_removal", args: { playlist_id: "p1", summary: "Russian tracks", items: [{ track_id: "t2", reason: "російською" }, { track_id: "t4", reason: "не впевнений", sure: false }] } },
];
const FINAL = "Підготував список, перевір нижче.";

type Call = { url: string; headers: Record<string, string>; body: any };
function scripted(format: (step: (typeof STEPS)[number] | null, i: number) => unknown) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const i = calls.length;
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    return new Response(JSON.stringify(format(STEPS[i] ?? null, i)), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

async function runWith(settings: Settings, format: Parameters<typeof scripted>[0]) {
  const { fetchFn, calls } = scripted(format);
  const { port } = fakeSpotify();
  const events: string[] = [];
  const result = await new Agent(settings, port, fetchFn).run("прибери російське з Mix", (e) => events.push(e.type === "tool" ? e.name : e.type));
  assert.equal(result.text, FINAL);
  assert.equal(result.proposals.length, 1);
  const proposal = result.proposals[0] as RemovalProposal;
  assert.equal(proposal.kind, "removal");
  assert.deepEqual(proposal.tracks.map((t) => [t.track.name, t.selected]), [["Кукла колдуна", true], ["Плакала", false]]);
  assert.deepEqual(events.filter((e) => e !== "thinking"), ["list_playlists", "get_tracks", "propose_removal", "proposal"]);
  assert.equal(calls.length, 4);
  return calls;
}

const gemini = (step: (typeof STEPS)[number] | null) => ({
  candidates: [{ content: { role: "model", parts: step ? [{ functionCall: { name: step.name, args: step.args }, thoughtSignature: "sig" }] : [{ text: FINAL }] } }],
});

test("Gemini direct: key header, model in URL, tool results and signatures go back", async () => {
  const calls = await runWith({ ...base, provider: "gemini", model: "gemini-x" }, gemini);
  assert.match(calls[0]!.url, /models\/gemini-x:generateContent$/);
  assert.equal(calls[0]!.headers["x-goog-api-key"], "KEY");
  assert.equal(calls[0]!.body.systemInstruction.parts[0].text.length > 100, true);
  assert.equal(calls[0]!.body.tools[0].functionDeclarations.find((d: any) => d.name === "list_playlists").parameters, undefined);
  const second = calls[1]!.body.contents;
  assert.equal(second[1].parts[0].thoughtSignature, "sig"); // model turn returned unchanged
  assert.equal(second[2].parts[0].functionResponse.name, "list_playlists");
  assert.equal(second[2].parts[0].functionResponse.response.playlists[0].id, "p1");
});

test("Proxy: install id + one prompt id for the whole run, no key and no model sent", async () => {
  const calls = await runWith({ ...base, mode: "proxy" }, gemini);
  assert.equal(calls[0]!.url, "https://proxy.example/v1/generate");
  assert.equal(calls[0]!.headers["x-install-id"], base.installId);
  assert.equal(new Set(calls.map((c) => c.headers["x-prompt-id"])).size, 1);
  assert.equal(JSON.stringify(calls).includes("KEY"), false);
  assert.deepEqual(Object.keys(calls[0]!.body).sort(), ["contents", "generationConfig", "systemInstruction", "tools"]);
  assert.equal(typeof calls[0]!.body.systemInstruction, "string");
});

test("OpenAI-compatible (OpenAI, Grok, OpenRouter, custom): bearer key, tool messages", async () => {
  const calls = await runWith({ ...base, provider: "xai", model: "grok-x" }, (step, i) => ({
    choices: [{ message: step
      ? { role: "assistant", content: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] }
      : { role: "assistant", content: FINAL } }],
  }));
  assert.equal(calls[0]!.url, "https://api.x.ai/v1/chat/completions");
  assert.equal(calls[0]!.headers.authorization, "Bearer KEY");
  assert.equal(calls[0]!.body.model, "grok-x");
  assert.equal(calls[0]!.body.messages[0].role, "system");
  assert.equal(calls[0]!.body.tools[0].type, "function");
  const last = calls[1]!.body.messages.at(-1);
  assert.deepEqual([last.role, last.tool_call_id], ["tool", "c0"]);
  assert.equal(JSON.parse(last.content).playlists[0].name, "Mix");
});

test("Custom address without a key (local model)", async () => {
  const calls = await runWith({ ...base, provider: "custom", apiKey: "", baseUrl: "http://localhost:11434/v1/", model: "local" }, (step, i) => ({
    choices: [{ message: step ? { role: "assistant", tool_calls: [{ id: `c${i}`, type: "function", function: { name: step.name, arguments: JSON.stringify(step.args) } }] } : { role: "assistant", content: FINAL } }],
  }));
  assert.equal(calls[0]!.url, "http://localhost:11434/v1/chat/completions");
  assert.equal(calls[0]!.headers.authorization, undefined);
});

test("Anthropic: headers, tool_use / tool_result blocks, assistant turn returned unchanged", async () => {
  const calls = await runWith({ ...base, provider: "anthropic", model: "claude-opus-5-5" }, (step, i) => ({
    stop_reason: step ? "tool_use" : "end_turn",
    content: step
      ? [{ type: "thinking", thinking: "", signature: "s" }, { type: "tool_use", id: `toolu_${i}`, name: step.name, input: step.args }]
      : [{ type: "text", text: FINAL }],
  }));
  const first = calls[0]!;
  assert.equal(first.url, "https://api.anthropic.com/v1/messages");
  assert.equal(first.headers["x-api-key"], "KEY");
  assert.equal(first.headers["anthropic-version"], "2026-10-21");
  assert.equal(first.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(first.body.model, "claude-opus-5-5");
  assert.equal(first.body.tools[0].input_schema.type, "object");
  assert.equal("temperature" in first.body, false);
  const messages = calls[1]!.body.messages;
  assert.equal(messages[1].content[0].type, "thinking"); // kept as received
  assert.deepEqual([messages[2].content[0].type, messages[2].content[0].tool_use_id], ["tool_result", "toolu_0"]);
});

test("Anthropic refusal and provider errors become clear messages", async () => {
  const { port } = fakeSpotify();
  const refuse = (async () => new Response(JSON.stringify({ stop_reason: "refusal", content: [] }), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(new Agent({ ...base, provider: "anthropic" }, port, refuse).run("x"), /declined/);
  const badKey = (async () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(new Agent({ ...base, provider: "openai" }, port, badKey).run("x"), /rejected the API key/);
  const limited = (async () => new Response(JSON.stringify({ error: "rate_limited", scope: "install", retryAfterSeconds: 600 }), { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(new Agent({ ...base, mode: "proxy" }, port, limited).run("x"), /this hour.*10 min.*own API key/s);
});

test("Toolbox: invented ids are rejected, exclude-list and unsure tracks work", async () => {
  const { port } = fakeSpotify();
  const box = new Toolbox(port);
  assert.match(String((await box.call("get_tracks", { playlist_id: "p9" })).error), /No playlist/);
  assert.match(String((await box.call("propose_removal", { playlist_id: "p1", summary: "", items: [{ track_id: "t99", reason: "" }] })).error), /Unknown track ids: t99/);
  const lines = String((await box.call("get_tracks", { playlist_id: "p1" })).tracks).split("\n");
  assert.equal(lines[1], "t2 | Кукла колдуна | Король и Шут | Album | 3:00 | 2026-01-01");

  const res = await box.call("propose_new_playlist", {
    source_playlist_id: "p1", name: "Без російського", summary: "s", exclude_track_ids: ["t2"], unsure: [{ track_id: "t4", reason: "мова неясна" }],
  });
  assert.equal(res.ok, true);
  const proposal = box.proposals[0]!;
  assert.equal(proposal.kind, "new_playlist");
  if (proposal.kind !== "new_playlist") return;
  assert.deepEqual(proposal.tracks.map((t) => [t.track.name, t.selected]), [["Плакала", false], ["Обійми", true], ["Stay", true]]);

  const { port: p2, created } = fakeSpotify();
  await applyNewPlaylist(p2, proposal);
  assert.deepEqual(created, [{ name: "Без російського", uris: ["spotify:track:1", "spotify:track:3"] }]);
});

test("Split: every track once, leftovers reported; apply creates the playlists", async () => {
  const { port, created } = fakeSpotify();
  const box = new Toolbox(port);
  await box.call("get_tracks", { playlist_id: "p1" });
  const res = await box.call("propose_split", {
    source_playlist_id: "p1", summary: "by language",
    groups: [{ name: "UA", track_ids: ["t1", "t4"] }, { name: "Other", track_ids: ["t3", "t1"] }],
  });
  assert.equal(res.tracks_in_no_group, 1);
  assert.equal(res.tracks_listed_twice_kept_in_first_group, 1);
  const proposal = box.proposals[0]!;
  if (proposal.kind !== "split") throw new Error("expected split");
  await applySplit(port, proposal);
  assert.deepEqual(created.map((c) => [c.name, c.uris.length]), [["Other", 1], ["UA", 2]]);
});

test("Removal as a cleaned copy leaves the original alone", async () => {
  const { port, created } = fakeSpotify();
  const box = new Toolbox(port);
  await box.call("propose_removal", { playlist_id: "p1", summary: "s", items: [{ track_id: "t2", reason: "r" }] });
  await applyRemovalAsCopy(port, box.proposals[0] as RemovalProposal);
  assert.deepEqual(created, [{ name: "Mix (cleaned)", uris: ["spotify:track:1", "spotify:track:3", "spotify:track:4"] }]);
});

test("A model going in circles ends politely instead of failing", async () => {
  const { port } = fakeSpotify();
  let n = 0;
  const loop = (async () => new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", tool_calls: [{ id: `c${n++}`, type: "function", function: { name: "list_playlists", arguments: "{}" } }] } }],
  }), { status: 200 })) as unknown as typeof fetch;
  const result = await new Agent({ ...base, provider: "openai" }, port, loop).run("порадь нові треки");
  assert.equal(result.incomplete, true);
  assert.match(result.text, /could not complete/);
  assert.equal(n, 3); // stopped at the third identical call, not after 16 steps
});

test("get_track_data: language codes and mood numbers, unknown shown as ?", async () => {
  const { port } = fakeSpotify();
  const box = new Toolbox(port);
  const progress: string[] = [];
  box.notify = (done, total) => progress.push(`${done}/${total}`);
  const res = await box.call("get_track_data", { playlist_id: "p1", fields: ["language", "mood"] });
  const lines = String(res.tracks).split("\n");
  assert.equal(lines[0], "t1 | Обійми | Океан Ельзи | lang=uk | pop=60 | energy=0.40 valence=0.30 dance=0.50 tempo=96 acoustic=0.60");
  assert.match(lines[1]!, /lang=ru/);
  assert.equal(lines[3], "t4 | Плакала | KAZKA | lang=? | pop=? | energy=? valence=? dance=? tempo=? acoustic=?");
  assert.deepEqual(progress, ["4/4"]);
  assert.match(String((await box.call("get_track_data", { playlist_id: "p1", fields: ["lyrics"] })).error), /fields must contain/);
});

test("Recommendations: candidates exclude what is in the playlist; only cN ids can be proposed", async () => {
  const { port, created } = fakeSpotify();
  const box = new Toolbox(port);
  const rec = await box.call("recommend_tracks", { playlist_id: "p1" });
  assert.equal(rec.candidates, 2); // "Stay" is already in the playlist
  assert.equal(String(rec.tracks).split("\n")[0], "c1 | Вахтерам | Бумбокс | Album");
  assert.equal((await box.call("search_tracks", { query: "nothing" })).matches, 0);
  assert.equal(String((await box.call("search_tracks", { query: "ДахаБраха Baby" })).tracks), "c3 | Baby | ДахаБраха | Album");
  assert.match(String((await box.call("propose_additions", { playlist_id: "p1", summary: "s", items: [{ track_id: "t1", reason: "" }] })).error), /Only cN ids/);
  assert.match(String((await box.call("propose_additions", { playlist_id: "p1", summary: "s", items: [{ track_id: "c9", reason: "" }] })).error), /Unknown ids: c9/);
  const ok = await box.call("propose_additions", { playlist_id: "p1", summary: "Схожий настрій", items: [{ track_id: "c1", reason: "той самий жанр" }, { track_id: "c3", reason: "та сама сцена" }, { track_id: "c1", reason: "двічі" }] });
  assert.equal(ok.tracks, 2);
  const proposal = box.proposals[0]!;
  if (proposal.kind !== "additions") throw new Error("expected additions");
  await applyAdditionsAsNew(port, proposal);
  assert.deepEqual(created, [{ name: "Mix — recommendations", uris: ["spotify:track:10", "spotify:track:12"] }]);
});

test("An exclude-list or a split is refused until every track of a big playlist was read", async () => {
  const many = Array.from({ length: 1200 }, (_, i) => track(i + 1, `Song ${i + 1}`, "A"));
  const { port } = fakeSpotify();
  const big: SpotifyPort = { ...port, getTracks: async () => many };
  const box = new Toolbox(big);
  const progress: string[] = [];
  box.notify = (done, total) => progress.push(`${done}/${total}`);
  const first = await box.call("get_track_data", { playlist_id: "p1", fields: ["language"] });
  assert.equal(first.has_more, true);
  assert.match(String(first.next), /offset 1000 — 200 tracks are not read yet/);
  assert.equal(progress.at(-1), "1000/1200");
  const early = await box.call("propose_new_playlist", { source_playlist_id: "p1", name: "x", summary: "s", exclude_track_ids: ["t2"] });
  assert.match(String(early.error), /only read tracks t1-t1000 of 1200.*offset 1000/s);
  assert.match(String((await box.call("propose_split", { source_playlist_id: "p1", summary: "s", groups: [{ name: "a", track_ids: ["t1"] }, { name: "b", track_ids: ["t2"] }] })).error), /only read/);
  await box.call("get_track_data", { playlist_id: "p1", fields: ["language"], offset: 1000 });
  assert.equal(progress.at(-1), "1200/1200");
  const ok = await box.call("propose_new_playlist", { source_playlist_id: "p1", name: "x", summary: "s", exclude_track_ids: ["t2"] });
  assert.equal(ok.tracks_in_playlist, 1199);
});

test("list_playlists does not send owner names; a locked agent sees only the picked playlist", async () => {
  const { port } = fakeSpotify();
  const other: Playlist = { ...PLAYLIST, uri: "spotify:playlist:b", name: "Private diary", ownerName: "Real Name" };
  const two: SpotifyPort = { ...port, listPlaylists: async () => [other, PLAYLIST] };
  const open = await new Toolbox(two).call("list_playlists", {});
  assert.equal(JSON.stringify(open).includes("Real Name"), false);
  assert.equal((open.playlists as unknown[]).length, 2);
  const locked = new Toolbox(two, PLAYLIST.uri);
  const seen = await locked.call("list_playlists", {});
  assert.deepEqual(seen.playlists, [{ id: "p1", name: "Mix", tracks: 4, can_edit: true }]);
  assert.match(String((await locked.call("get_tracks", { playlist_id: "p2" })).error), /No playlist/);
  await locked.call("get_tracks", { playlist_id: "p1" });
  await locked.call("propose_new_playlist", { source_playlist_id: "p1", name: "n", summary: "s", exclude_track_ids: [] });
  const proposal = locked.proposals[0]!;
  assert.equal(proposal.kind === "new_playlist" && proposal.source.uri, PLAYLIST.uri);
});
