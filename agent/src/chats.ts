// Recent chats with the agent, kept in the Spotify client's local storage on this
// computer only. What is saved is what the screen shows (messages and proposals),
// not the model's memory: a reopened chat is continued with a short text recap.

import type { Proposal } from "./agent/proposals";

const KEY = "spotify-ai:chats:v1";
export const MAX_CHATS = 5;
/** Proposals for big playlists are large; the whole store stays under this size. */
const MAX_CHARS = 1_500_000;

export interface ChatMessage {
  from: "user" | "agent" | "error" | "note";
  text: string;
  proposals: Proposal[];
  /** An error after which the run can go on from where it stopped (never saved). */
  retry?: boolean;
  /** Ids of this message's proposals the user has applied. */
  applied?: string[];
}

export interface SavedChat {
  id: string;
  title: string;
  updatedAt: string;
  /** Set when the chat was started from a playlist card: it is offered only there. */
  playlistUri?: string;
  messages: ChatMessage[];
}

function load(): SavedChat[] {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(all) ? (all as SavedChat[]) : [];
  } catch {
    return [];
  }
}

function store(all: SavedChat[]): void {
  let chats = all.slice(0, MAX_CHATS);
  let text = JSON.stringify(chats);
  while (text.length > MAX_CHARS) {
    if (chats.length > 1) chats = chats.slice(0, -1); // the oldest goes first
    else if (chats[0]!.messages.some((m) => m.proposals.length)) chats = [{ ...chats[0]!, messages: chats[0]!.messages.map((m) => ({ ...m, proposals: [] })) }];
    else chats = [];
    text = JSON.stringify(chats);
  }
  try {
    localStorage.setItem(KEY, text);
  } catch {
    // Storage is full: history is a convenience, the chat on screen is not affected.
  }
}

/** Newest first. With a playlist: only the chats started from that playlist's card. */
export function listChats(playlistUri?: string): SavedChat[] {
  return load().filter((c) => c.playlistUri === playlistUri);
}

export function saveChat(chat: SavedChat): void {
  const messages = chat.messages.map(({ retry: _retry, ...m }) => m);
  store([{ ...chat, messages }, ...load().filter((c) => c.id !== chat.id)]);
}

export function deleteChat(id: string): void {
  store(load().filter((c) => c.id !== id));
}

/** A short text version of a chat, given to the model when the chat is continued. */
export function recap(messages: ChatMessage[]): string {
  return messages
    .filter((m) => (m.from === "user" || m.from === "agent") && (m.text || m.proposals.length))
    .slice(-8)
    .map((m) => `${m.from === "user" ? "User" : "Assistant"}: ${m.text.slice(0, 300)}${m.proposals.map((p) => ` [prepared a proposal: ${p.kind}]`).join("")}`)
    .join("\n");
}
