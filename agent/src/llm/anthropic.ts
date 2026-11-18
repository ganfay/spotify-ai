// Anthropic (Claude) Messages API with the user's own key, over plain HTTP.
// Plain fetch instead of the SDK keeps the lazily loaded bundle small and all
// three provider adapters alike.

import type { Settings } from "../settings";
import { type ChatSession, defaultFetch, type FetchFn, keyError, LlmError, type ModelTurn, postJson, type SessionOptions, type TurnInput } from "./types";

type Block = { type: string; [key: string]: unknown };
interface Message {
  role: "user" | "assistant";
  content: string | Block[];
}

const API_VERSION = "2026-10-21";
const MAX_TOKENS = 16000;

export function anthropic(settings: Settings, options: SessionOptions, fetchFn: FetchFn = defaultFetch): ChatSession {
  const messages: Message[] = [];
  const tools = options.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

  return {
    async send(input: TurnInput): Promise<ModelTurn> {
      const before = messages.length;
      try {
        return await exchange(input);
      } catch (e) {
        messages.length = before;
        throw e;
      }
    },
  };

  async function exchange(input: TurnInput): Promise<ModelTurn> {
      messages.push(
        "text" in input
          ? { role: "user", content: input.text }
          // All results of one turn go back in ONE user message.
          : { role: "user", content: input.toolResults.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: JSON.stringify(r.result), ...(r.result.error ? { is_error: true } : {}) })) },
      );
      const { res, json } = await postJson(fetchFn, "https://api.anthropic.com/v1/messages", {
        "x-api-key": settings.apiKey.trim(),
        "anthropic-version": API_VERSION,
        // Required by Anthropic for calls made from a browser-like client.
        "anthropic-dangerous-direct-browser-access": "true",
      }, { model: settings.model, max_tokens: MAX_TOKENS, system: options.system, ...(tools.length ? { tools } : {}), messages }, "Anthropic");
      if (!res.ok) throw keyError(res.status, json?.error?.message ?? `HTTP ${res.status}`, "Anthropic", settings.model);

      const content: Block[] = Array.isArray(json.content) ? json.content : [];
      if (json.stop_reason === "refusal") {
        throw new LlmError("The model declined this request. Try to rephrase it.", "refusal");
      }
      if (json.stop_reason === "max_tokens") {
        throw new LlmError("The answer was too long and got cut off. Try a smaller task (for example a smaller playlist).", "max_tokens");
      }
      if (content.length === 0) throw new LlmError("The model gave no answer. Try to rephrase the request.", "empty");
      // The whole assistant turn (thinking blocks included) goes back unchanged.
      messages.push({ role: "assistant", content });
      return {
        text: content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("").trim(),
        toolCalls: content.filter((b) => b.type === "tool_use").map((b) => ({ id: String(b.id), name: String(b.name), args: (b.input as Record<string, unknown>) ?? {} })),
      };
  }
}
