// The agent loop: prompt -> model -> tool calls -> results -> … -> final answer.

import { type ChatSession, createSession, type FetchFn, LlmError, type ToolResult } from "../llm";
import type { Settings } from "../settings";
import type { Proposal, SpotifyPort } from "./proposals";
import { TOOL_DECLARATIONS, Toolbox } from "./tools";

const MAX_STEPS = 12;

export const SYSTEM_PROMPT = `You are an assistant inside the Spotify desktop app. You help the user organise their own playlists.

How you work:
- You can only READ the library and PROPOSE changes with the propose_* tools. You cannot change anything yourself. Never say that something was created, removed or changed — say that you prepared a proposal and the user can approve it below.
- Start with list_playlists unless you already know the playlist id. Read the tracks before judging them.
- Prefer creating a NEW playlist over changing an existing one, unless the user clearly asks to remove tracks.
- Use find_duplicates for duplicates; do not compare titles yourself.
- For every track you propose to remove, give a short, concrete reason.
- If you are not sure about a track, do not guess: mark it unsure (propose_new_playlist "unsure", or "sure": false in propose_removal) with the reason, so the user decides.
- Use only track ids and playlist ids that the tools gave you.
- If the request is unclear (which playlist? what rule?), ask one short question instead of guessing.

Languages:
- Ukrainian and Russian both use Cyrillic and are different languages. Do not decide by alphabet alone. Letters і ї є ґ point to Ukrainian; ы э ъ ё point to Russian; many short titles have neither. Use what you know about the artist and the song. When title and artist do not settle it, mark the track unsure.
- A track "has language X" if its title, its artist's usual language, or its lyrics are in X.

Style: answer in the language the user wrote in. Be brief: one or two sentences plus the proposal. No lists of tracks in the text — the proposal shows them.`;

export type AgentEvent =
  | { type: "thinking" }
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "proposal"; proposal: Proposal };

export interface AgentResult {
  text: string;
  proposals: Proposal[];
  steps: number;
}

const TOOL_LABELS: Record<string, string> = {
  list_playlists: "Looking at your playlists",
  get_tracks: "Reading tracks",
  find_duplicates: "Searching for duplicates",
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

  constructor(settings: Settings, spotify: SpotifyPort, fetchFn?: FetchFn) {
    this.toolbox = new Toolbox(spotify);
    this.session = createSession(settings, { system: SYSTEM_PROMPT, tools: TOOL_DECLARATIONS }, () => this.promptId, fetchFn);
  }

  async run(prompt: string, onEvent: (event: AgentEvent) => void = () => {}): Promise<AgentResult> {
    this.promptId = crypto.randomUUID();
    const first = this.toolbox.proposals.length;
    onEvent({ type: "thinking" });
    let turn = await this.session.send({ text: prompt });
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (turn.toolCalls.length === 0) {
        return { text: turn.text, proposals: this.toolbox.proposals.slice(first), steps: step };
      }
      const results: ToolResult[] = [];
      for (const call of turn.toolCalls) {
        onEvent({ type: "tool", name: call.name, args: call.args });
        const before = this.toolbox.proposals.length;
        const result = await this.toolbox.call(call.name, call.args);
        for (const proposal of this.toolbox.proposals.slice(before)) onEvent({ type: "proposal", proposal });
        results.push({ id: call.id, name: call.name, result });
      }
      onEvent({ type: "thinking" });
      turn = await this.session.send({ toolResults: results });
    }
    throw new LlmError("The task needed too many steps. Try a smaller or more specific request.", "too_many_steps");
  }
}
