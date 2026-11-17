// Picks the right provider adapter from the settings.

import type { Settings } from "../settings";
import { anthropic } from "./anthropic";
import { geminiDirect, geminiViaProxy } from "./gemini";
import { openAiCompatible } from "./openai";
import type { ChatSession, FetchFn, SessionOptions } from "./types";

export interface Provider {
  id: Settings["provider"];
  label: string;
  /** Empty = the user must type a model name. */
  defaultModel: string;
  /** For OpenAI-compatible providers. */
  baseUrl?: string;
  keyHint: string;
}

export const PROVIDERS: Provider[] = [
  { id: "gemini", label: "Google Gemini", defaultModel: "gemini-3.5-flash-lite", keyHint: "aistudio.google.com → Get API key" },
  { id: "anthropic", label: "Anthropic (Claude)", defaultModel: "claude-opus-5-5", keyHint: "platform.claude.com → API keys. Cheaper model: claude-haiku-5-5" },
  { id: "openai", label: "OpenAI", defaultModel: "", baseUrl: "https://api.openai.com/v1", keyHint: "platform.openai.com → API keys" },
  { id: "xai", label: "xAI (Grok)", defaultModel: "", baseUrl: "https://api.x.ai/v1", keyHint: "console.x.ai → API keys" },
  { id: "openrouter", label: "OpenRouter", defaultModel: "", baseUrl: "https://openrouter.ai/api/v1", keyHint: "openrouter.ai → Keys" },
  { id: "custom", label: "Other (OpenAI-compatible)", defaultModel: "", baseUrl: "", keyHint: "Any service or local model with an OpenAI-compatible address, e.g. http://localhost:11434/v1" },
];

export const providerOf = (settings: Settings): Provider => PROVIDERS.find((p) => p.id === settings.provider) ?? PROVIDERS[0]!;

/** promptId: called for every request; returns the id of the current user prompt (proxy limits). */
export function createSession(settings: Settings, options: SessionOptions, promptId: () => string, fetchFn?: FetchFn): ChatSession {
  if (settings.mode === "proxy") return geminiViaProxy(settings, options, promptId, fetchFn);
  const provider = providerOf(settings);
  switch (provider.id) {
    case "gemini": return geminiDirect(settings, options, fetchFn);
    case "anthropic": return anthropic(settings, options, fetchFn);
    default: return openAiCompatible({ ...settings, baseUrl: settings.baseUrl || provider.baseUrl || "" }, options, provider.label, fetchFn);
  }
}

export * from "./types";
