/**
 * Other providers speak the OpenAI "chat completions" format; the app speaks
 * Gemini's. These two pure functions translate a request there and the answer
 * back, so the app does not need to know which provider answered.
 */

/** Put on function calls that came from a fallback provider (see cameFromFallback). */
export const FALLBACK_MARK = "spotify-ai:fallback";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export interface ChatRequest {
  messages: Json[];
  tools?: Json[];
  temperature?: number;
  max_tokens: number;
}

export interface GeminiRequest {
  systemInstruction?: string;
  contents: unknown[];
  tools?: unknown[];
  temperature?: number;
  maxOutputTokens: number;
}

export function toChatRequest(request: GeminiRequest): ChatRequest {
  const messages: Json[] = [];
  if (request.systemInstruction) messages.push({ role: "system", content: request.systemInstruction });

  // Ids of the calls of the last assistant message, for answers that carry no id.
  let open: string[] = [];
  request.contents.forEach((content, index) => {
    if (!isObject(content) || !Array.isArray(content.parts)) return;
    const parts = content.parts.filter(isObject).filter((part) => part.thought !== true);
    const text = parts.map((part) => (typeof part.text === "string" ? part.text : "")).join("");

    if (content.role === "model") {
      const calls = parts.filter((part) => isObject(part.functionCall)).map((part, i) => {
        const call = part.functionCall as Json;
        return {
          id: typeof call.id === "string" && call.id ? call.id : `call_${index}_${i}`,
          type: "function",
          function: { name: String(call.name ?? ""), arguments: JSON.stringify(isObject(call.args) ? call.args : {}) },
        };
      });
      open = calls.map((call) => call.id);
      messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      return;
    }

    const answers = parts.filter((part) => isObject(part.functionResponse));
    answers.forEach((part, i) => {
      const answer = part.functionResponse as Json;
      const id = typeof answer.id === "string" && answer.id ? answer.id : open[i] ?? `call_${index - 1}_${i}`;
      messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(answer.response ?? {}) });
    });
    if (text || answers.length === 0) messages.push({ role: "user", content: text });
  });

  const tools: Json[] = [];
  for (const tool of request.tools ?? []) {
    if (!isObject(tool) || !Array.isArray(tool.functionDeclarations)) continue;
    for (const declaration of tool.functionDeclarations.filter(isObject)) {
      tools.push({
        type: "function",
        function: {
          name: declaration.name,
          description: declaration.description ?? "",
          parameters: isObject(declaration.parameters) ? declaration.parameters : { type: "object", properties: {} },
        },
      });
    }
  }

  return {
    messages,
    ...(tools.length ? { tools } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    max_tokens: request.maxOutputTokens,
  };
}

/**
 * An OpenAI-style answer as a Gemini-style one, or null when there is nothing
 * usable in it (no text and no function call).
 */
export function toGeminiResponse(answer: unknown, modelLabel: string): Json | null {
  if (!isObject(answer)) return null;
  // Two shapes exist: { choices: [{ message }] } and the older flat { response, tool_calls }.
  const first = Array.isArray(answer.choices) ? answer.choices[0] : undefined;
  const message = isObject(first) && isObject(first.message) ? first.message : answer;
  const text = typeof message.content === "string" ? message.content : typeof message.response === "string" ? message.response : "";

  const parts: Json[] = [];
  if (text.trim()) parts.push({ text });
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls.filter(isObject) : [];
  calls.forEach((call, i) => {
    const fn = isObject(call.function) ? call.function : call;
    if (typeof fn.name !== "string" || !fn.name) return;
    let args: unknown = fn.arguments;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args || "{}");
      } catch {
        args = {};
      }
    }
    const id = typeof call.id === "string" && call.id ? call.id : `fb_${Date.now().toString(36)}_${i}`;
    parts.push({ functionCall: { name: fn.name, args: isObject(args) ? args : {}, id }, thoughtSignature: FALLBACK_MARK });
  });
  if (parts.length === 0) return null;
  return { candidates: [{ content: { role: "model", parts }, finishReason: "STOP", index: 0 }], modelVersion: modelLabel };
}

/**
 * True when the conversation already holds function calls made by a fallback
 * provider. Gemini would reject them (it wants its own signatures on its calls),
 * so such a conversation stays with the fallback providers.
 */
export function cameFromFallback(contents: unknown[]): boolean {
  return contents.some(
    (content) => isObject(content) && Array.isArray(content.parts) && content.parts.some((part) => isObject(part) && part.thoughtSignature === FALLBACK_MARK),
  );
}
