// User settings, kept in the Spotify client's local storage on this computer.
// The API key (own-key mode) never leaves this machine except to Google.

const KEY = "spotify-ai:settings";

export interface Settings {
  /** "proxy" = our Cloudflare Worker holds a shared key (limited); "own-key" = the user's own key, direct calls, no limits from us. */
  mode: "proxy" | "own-key";
  proxyUrl: string;
  /** Own-key mode: which service the key belongs to. */
  provider: "gemini" | "anthropic" | "openai" | "xai" | "openrouter" | "custom";
  apiKey: string;
  /** Own-key mode, OpenAI-compatible providers: overrides the provider's address ("custom" needs it). */
  baseUrl: string;
  /** Random id of this installation; lets the proxy count "prompts per hour" without accounts. */
  installId: string;
  inviteCode: string;
  model: string;
}

// Filled in by the build when the owner has deployed the proxy (see agent/build.mjs).
declare const __DEFAULT_PROXY_URL__: string;

const DEFAULTS: Settings = {
  mode: "proxy",
  proxyUrl: typeof __DEFAULT_PROXY_URL__ === "string" ? __DEFAULT_PROXY_URL__ : "",
  provider: "gemini",
  apiKey: "",
  baseUrl: "",
  installId: "",
  inviteCode: "",
  model: "gemini-3.5-flash-lite",
};

export function loadSettings(): Settings {
  let saved: Partial<Settings> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
  } catch {
    // broken JSON -> defaults
  }
  const settings = { ...DEFAULTS, ...saved };
  if (!settings.installId) {
    settings.installId = crypto.randomUUID();
    saveSettings(settings);
  }
  return settings;
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

/** True when the agent has a way to reach the model. */
export function isConfigured(settings: Settings): boolean {
  if (settings.mode === "proxy") return settings.proxyUrl.trim().length > 0;
  if (!settings.model.trim()) return false;
  // A local model ("custom" address) may need no key.
  return settings.provider === "custom" ? settings.baseUrl.trim().length > 0 : settings.apiKey.trim().length > 0;
}
