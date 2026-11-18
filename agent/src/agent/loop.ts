// The agent loop: prompt -> model -> tool calls -> results -> … -> final answer.

import { type ChatSession, createSession, type FetchFn, type ToolResult } from "../llm";
import type { Settings } from "../settings";
import type { Proposal, SpotifyPort } from "./proposals";
import { TOOL_DECLARATIONS, Toolbox } from "./tools";

const MAX_STEPS = 16;

export const SYSTEM_PROMPT = `You are an assistant inside the Spotify desktop app. You help the user organise their own playlists.

How you work:
- You can only READ the library and PROPOSE changes with the propose_* tools. You cannot change anything yourself. Never say that something was created, removed or changed — say that you prepared a proposal and the user can approve it below.
- Start with list_playlists unless you already know the playlist id. Read the tracks before judging them. Big playlists come in pages: when a result says has_more, keep calling with the next offset until you have read every track.
- Prefer creating a NEW playlist over changing an existing one, unless the user clearly asks to remove tracks.
- Use find_duplicates for duplicates; do not compare titles yourself.
- For every track you propose to remove, give a short, concrete reason.
- If you are not sure about a track, do not guess: mark it unsure (propose_new_playlist "unsure", or "sure": false in propose_removal) with the reason, so the user decides.
- Use only track ids and playlist ids that the tools gave you.
- If the request is unclear (which playlist? what rule?), ask one short question instead of guessing.
- Your tools are your only abilities. If the user asks for something no tool can do (for example playing music, editing cover art, anything outside playlists), say so in one sentence and say what you can do instead. Do not keep calling tools hoping it will work.
- Do not call the same tool with the same arguments twice; you already have that result.

Languages:
- To filter by language, first call get_track_data with fields ["language"]. Spotify's code is your main evidence: uk = Ukrainian, ru = Russian, zxx = no words (instrumental), ? = unknown.
- Ukrainian and Russian both use Cyrillic and are different languages; never decide by alphabet alone. Letters і ї є ґ point to Ukrainian; ы э ъ ё point to Russian.
- A track "has language X" if it is performed in X, or its title or artist name is written in X.
- When the code is ? or clearly contradicts the title or what you know about the artist, mark the track unsure with the reason instead of guessing.

Mood, energy, genre:
- To split or filter by mood or energy, first call get_track_data with fields ["mood"] and use the numbers together with what you know about the artists. Do not judge mood from titles alone.
- Give groups short, natural names. Aim for groups of comparable size unless the music clearly is not balanced.
- For "tracks that do not fit": work out what most of the playlist has in common (language, mood numbers, genre, era), then propose only clear outliers, each with a concrete reason.

Recommendations (new songs for a playlist):
- Read the playlist first so you know its character. Then call recommend_tracks for Spotify's candidates. You may add your own ideas, but each one must be found with search_tracks ("Artist Title") — never propose a song without a cN id.
- Be picky: choose roughly 10-20 tracks that truly fit, not the whole candidate list. Prefer variety of artists; skip other versions of songs the playlist already has.
- Give every pick a specific reason tied to this playlist (similar artist, same mood or tempo, same scene or era) — not a generic one.
- Then call propose_additions.

Style: answer in the language the user wrote in. Be brief: one or two sentences plus the proposal. No lists of tracks in the text — the proposal shows them.`;

export type AgentEvent =
  | { type: "thinking" }
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "progress"; done: number; total: number }
  | { type: "proposal"; proposal: Proposal };

export interface AgentResult {
  text: string;
  proposals: Proposal[];
  steps: number;
  /** True when the run was cut short (too many steps or the model went in circles). */
  incomplete?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  list_playlists: "Looking at your playlists",
  get_tracks: "Reading tracks",
  get_track_data: "Reading track data",
  find_duplicates: "Searching for duplicates",
  recommend_tracks: "Looking for new tracks",
  search_tracks: "Searching Spotify",
  propose_additions: "Preparing recommendations",
  propose_new_playlist: "Preparing a new playlist",
  propose_removal: "Preparing a list of tracks to remove",
  propose_split: "Preparing a split",
};
export const toolLabel = (name: string): string => TOOL_LABELS[name] ?? name;

/**
 * One conversation with the agent. Keeps the model session and the toolbox, so
 * a follow-up message ("yes, the second playlist") continues where it stopped.
 */
export class Agent {
  private readonly toolbox: Toolbox;
  private readonly session: ChatSession;
  private promptId = "";
  private cancelled = false;

  /** Stops the current run at the next step. */
  cancel(): void {
    this.cancelled = true;
  }

  /** onlyPlaylistUri ties the whole conversation to one playlist (see Toolbox). */
  constructor(settings: Settings, spotify: SpotifyPort, fetchFn?: FetchFn, onlyPlaylistUri?: string) {
    this.toolbox = new Toolbox(spotify, onlyPlaylistUri);
    this.session = createSession(settings, { system: SYSTEM_PROMPT, tools: TOOL_DECLARATIONS }, () => this.promptId, fetchFn);
  }

  async run(prompt: string, onEvent: (event: AgentEvent) => void = () => {}): Promise<AgentResult> {
    this.promptId = crypto.randomUUID();
    this.toolbox.notify = (done, total) => onEvent({ type: "progress", done, total });
    this.cancelled = false;
    const first = this.toolbox.proposals.length;
    onEvent({ type: "thinking" });
    let turn = await this.session.send({ text: prompt });
    const seen = new Map<string, number>();
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (turn.toolCalls.length === 0 || this.cancelled) {
        return { text: turn.text, proposals: this.toolbox.proposals.slice(first), steps: step, ...(this.cancelled ? { incomplete: true } : {}) };
      }
      const results: ToolResult[] = [];
      let stuck = false;
      for (const call of turn.toolCalls) {
        const key = `${call.name} ${JSON.stringify(call.args)}`;
        const times = (seen.get(key) ?? 0) + 1;
        seen.set(key, times);
        if (times > 2) stuck = true; // the model is going in circles
        onEvent({ type: "tool", name: call.name, args: call.args });
        const before = this.toolbox.proposals.length;
        const result = times > 1
          ? { error: "You already called this tool with these arguments. Use the earlier result, or answer the user." }
          : await this.toolbox.call(call.name, call.args);
        for (const proposal of this.toolbox.proposals.slice(before)) onEvent({ type: "proposal", proposal });
        results.push({ id: call.id, name: call.name, result });
      }
      if (stuck || step === MAX_STEPS || this.cancelled) break;
      onEvent({ type: "thinking" });
      turn = await this.session.send({ toolResults: results });
    }
    // Out of steps or going in circles: end politely and keep whatever was prepared.
    const proposals = this.toolbox.proposals.slice(first);
    return {
      text: proposals.length
        ? "I could not finish everything, but here is what I prepared so far."
        : "I could not complete this request. I can find duplicates, build a new playlist from an existing one by a rule (language, mood …), propose tracks to remove with reasons, split a playlist, or recommend new tracks for it. Try rephrasing it as one of those.",
      proposals,
      steps: MAX_STEPS,
      incomplete: true,
    };
  }
}
