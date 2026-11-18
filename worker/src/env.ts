import type { Limits } from "./limits";

/** Bindings, vars and secrets. Every var is optional: the code has defaults. */
export interface Env {
  LIMITS: DurableObjectNamespace<Limits>;
  /** Workers AI binding (wrangler.jsonc "ai"); optional so the proxy works without it. */
  AI?: { run(model: string, input: unknown): Promise<unknown> };

  // Secrets (set with `wrangler secret put`, or `.dev.vars` locally).
  GEMINI_API_KEY?: string;
  /** Optional: switches the OpenRouter fallback on. */
  OPENROUTER_API_KEY?: string;
  ADMIN_TOKEN?: string;
  IP_SALT?: string;

  // Plain vars (wrangler.jsonc).
  MODEL?: string;
  /** Comma-separated; empty string switches the fallback off. */
  FALLBACK_MODELS?: string;
  RETRY_DELAY_MS?: string;
  OPENROUTER_MODELS?: string;
  WORKERS_AI_MODELS?: string;
  UPSTREAM_TIMEOUT_MS?: string;
  MAX_OUTPUT_TOKENS?: string;
  ALLOWED_ORIGINS?: string;
  PROMPTS_PER_HOUR?: string;
  REQUESTS_PER_PROMPT?: string;
  NEW_INSTALLS_PER_IP_PER_DAY?: string;
  REQUESTS_PER_INSTALL_PER_DAY?: string;
  REQUESTS_PER_IP_PER_DAY?: string;
  GLOBAL_REQUESTS_PER_DAY?: string;
  REQUIRE_INVITE?: string;
  KILL_SWITCH?: string;
}

export const DEFAULTS = {
  MODEL: "gemini-3.5-flash-lite",
  FALLBACK_MODELS: "gemini-3.1-flash-lite",
  RETRY_DELAY_MS: 1200,
  /** Free models with tool calling and a context window big enough for a 1,200-track playlist. */
  OPENROUTER_MODELS: "nvidia/nemotron-3-ultra-550b-a55b:free,nvidia/nemotron-3.5-lightning:free,openrouter/free",
  WORKERS_AI_MODELS: "@cf/zai-org/glm-4.7-flash",
  /** How long one model may take to answer before the next one is tried. */
  UPSTREAM_TIMEOUT_MS: 45000,
  MAX_OUTPUT_TOKENS: 16384,
  ALLOWED_ORIGINS: "https://xpui.app.spotify.com",
  PROMPTS_PER_HOUR: 5,
  REQUESTS_PER_PROMPT: 24,
  NEW_INSTALLS_PER_IP_PER_DAY: 5,
  REQUESTS_PER_INSTALL_PER_DAY: 100,
  REQUESTS_PER_IP_PER_DAY: 200,
  GLOBAL_REQUESTS_PER_DAY: 400,
} as const;

/** Parse a non-negative integer var; anything invalid falls back to the default. */
export function intVar(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export interface LimitConfig {
  promptsPerHour: number;
  requestsPerPrompt: number;
  newInstallsPerIpPerDay: number;
  /** Stops one install (or one address) from using up the whole shared daily quota. */
  requestsPerInstallPerDay: number;
  requestsPerIpPerDay: number;
  globalRequestsPerDay: number;
}

export function limitConfig(env: Env): LimitConfig {
  return {
    promptsPerHour: intVar(env.PROMPTS_PER_HOUR, DEFAULTS.PROMPTS_PER_HOUR),
    requestsPerPrompt: intVar(env.REQUESTS_PER_PROMPT, DEFAULTS.REQUESTS_PER_PROMPT),
    newInstallsPerIpPerDay: intVar(
      env.NEW_INSTALLS_PER_IP_PER_DAY,
      DEFAULTS.NEW_INSTALLS_PER_IP_PER_DAY,
    ),
    requestsPerInstallPerDay: intVar(env.REQUESTS_PER_INSTALL_PER_DAY, DEFAULTS.REQUESTS_PER_INSTALL_PER_DAY),
    requestsPerIpPerDay: intVar(env.REQUESTS_PER_IP_PER_DAY, DEFAULTS.REQUESTS_PER_IP_PER_DAY),
    globalRequestsPerDay: intVar(env.GLOBAL_REQUESTS_PER_DAY, DEFAULTS.GLOBAL_REQUESTS_PER_DAY),
  };
}
