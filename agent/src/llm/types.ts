// What the agent needs from any model provider. Each provider adapter keeps the
// conversation in its own native format (so provider-specific data such as
// thinking blocks or signatures is sent back unchanged) and exposes this.

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  result: Record<string, unknown>;
}

export interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
}

export type TurnInput = { text: string } | { toolResults: ToolResult[] };

/** One conversation with a model. */
export interface ChatSession {
  send(input: TurnInput): Promise<ModelTurn>;
}

export interface SessionOptions {
  system: string;
  tools: ToolSpec[];
}

export class LlmError extends Error {
  constructor(message: string, readonly code: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "LlmError";
  }
}

export type FetchFn = typeof fetch;
export const defaultFetch: FetchFn = (...args) => fetch(...args);

export async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/** POST JSON and turn network failures into an LlmError. */
export async function postJson(fetchFn: FetchFn, url: string, headers: Record<string, string>, body: unknown, who: string): Promise<{ res: Response; json: any }> {
  let res: Response;
  try {
    res = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  } catch {
    throw new LlmError(`Cannot reach ${who}. Check your internet connection (or the address in Settings).`, "network");
  }
  return { res, json: await readJson(res) };
}

/** Common HTTP errors of "bring your own key" providers. */
export function keyError(status: number, message: string, who: string, model: string): LlmError {
  if (status === 401 || status === 403) return new LlmError(`${who} rejected the API key. Check it in Settings.`, "bad_key");
  if (status === 404) return new LlmError(`${who} does not know the model "${model}". Change it in Settings.`, "bad_model");
  if (status === 429) return new LlmError(`Your ${who} key has hit its limit or has no credit. Try again later.`, "rate_limited");
  return new LlmError(`${who}: ${message}`.slice(0, 300), "http");
}
