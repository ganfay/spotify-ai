// Any provider that speaks the OpenAI "chat completions" format with the user's
// own key: OpenAI, xAI (Grok), OpenRouter, Groq, DeepSeek, Mistral, a local
// Ollama … Only the base URL and the model name differ.

import type { Settings } from "../settings";
import { type ChatSession, defaultFetch, type FetchFn, keyError, LlmError, type ModelTurn, postJson, type SessionOptions, type TurnInput } from "./types";

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  [other: string]: unknown;
}

export function openAiCompatible(settings: Settings, options: SessionOptions, who: string, fetchFn: FetchFn = defaultFetch): ChatSession {
  const messages: Message[] = [{ role: "system", content: options.system }];
  const tools = options.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const url = `${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;

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
      if ("text" in input) messages.push({ role: "user", content: input.text });
      else for (const r of input.toolResults) messages.push({ role: "tool", tool_call_id: r.id, content: JSON.stringify(r.result) });

      const headers: Record<string, string> = settings.apiKey.trim() ? { authorization: `Bearer ${settings.apiKey.trim()}` } : {};
      const { res, json } = await postJson(fetchFn, url, headers, { model: settings.model, messages, ...(tools.length ? { tools } : {}) }, who);
      if (!res.ok) throw keyError(res.status, json?.error?.message ?? `HTTP ${res.status}`, who, settings.model);

      const message: Message | undefined = json.choices?.[0]?.message;
      if (!message) throw new LlmError("The model gave no answer. Try to rephrase the request.", "empty");
      messages.push(message); // back unchanged
      const toolCalls = (message.tool_calls ?? []).map((call) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          // The tool will report missing arguments and the model can retry.
        }
        return { id: call.id, name: call.function.name, args };
      });
      return { text: typeof message.content === "string" ? message.content.trim() : "", toolCalls };
  }
}
