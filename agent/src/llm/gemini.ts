// Google Gemini (generateContent). Used two ways: through our proxy (the proxy
// adds the key and enforces limits) or directly with the user's own key.

import type { Settings } from "../settings";
import { type ChatSession, defaultFetch, type FetchFn, isOverload, keyError, LlmError, overloaded, type ModelTurn, postJson, type SessionOptions, type TurnInput } from "./types";

interface Part {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
  [other: string]: unknown; // e.g. thought signatures, sent back unchanged
}
interface Content {
  role: "user" | "model";
  parts: Part[];
}
interface Body {
  systemInstruction?: string;
  contents: Content[];
  tools?: unknown[];
  generationConfig?: Record<string, unknown>;
}
type Transport = (body: Body) => Promise<any>;

const MAX_OUTPUT_TOKENS = 16384;

class GeminiSession implements ChatSession {
  private readonly contents: Content[] = [];
  constructor(private readonly options: SessionOptions, private readonly transport: Transport) {}

  async send(input: TurnInput): Promise<ModelTurn> {
    const before = this.contents.length;
    try {
      return await this.exchange(input);
    } catch (e) {
      this.contents.length = before;
      throw e;
    }
  }

  private async exchange(input: TurnInput): Promise<ModelTurn> {
    this.contents.push(
      "text" in input
        ? { role: "user", parts: [{ text: input.text }] }
        : { role: "user", parts: input.toolResults.map((r) => ({ functionResponse: { name: r.name, response: r.result, ...(r.id.startsWith("call-") ? {} : { id: r.id }) } })) },
    );
    const tools = this.options.tools.map(({ name, description, parameters }) =>
      // Gemini rejects an object schema with no properties, so it is left out.
      Object.keys(parameters.properties).length ? { name, description, parameters } : { name, description },
    );
    const response = await this.transport({
      systemInstruction: this.options.system,
      contents: this.contents,
      ...(tools.length ? { tools: [{ functionDeclarations: tools }] } : {}),
      generationConfig: { temperature: 0.2 },
    });
    const candidate = response.candidates?.[0];
    const parts: Part[] = candidate?.content?.parts ?? [];
    if (parts.length === 0) {
      const why = response.promptFeedback?.blockReason ?? candidate?.finishReason ?? "empty answer";
      throw new LlmError(`The model gave no answer (${why}). Try to rephrase the request.`, "empty");
    }
    this.contents.push({ role: "model", parts });
    return {
      text: parts.map((p) => p.text ?? "").join("").trim(),
      toolCalls: parts.filter((p) => p.functionCall).map((p, i) => ({
        id: p.functionCall!.id ?? `call-${this.contents.length}-${i}`,
        name: p.functionCall!.name,
        args: p.functionCall!.args ?? {},
      })),
    };
  }
}

function proxyMessage(code: string, scope: string | undefined, fallback: string, retry?: number): string {
  const wait = retry ? ` Try again in about ${Math.max(1, Math.ceil(retry / 60))} min.` : "";
  if (code === "rate_limited") {
    if (scope === "install") return `You have used your free requests for this hour.${wait} With your own API key (Settings) there is no limit.`;
    if (scope === "global" || scope === "provider") return `The shared free AI quota is used up for now.${wait} With your own API key (Settings) there is no limit.`;
    if (scope === "prompt") return "This request needed too many steps. Try a smaller task.";
    return `Too many requests.${wait}`;
  }
  if (code === "invite_required") return "This proxy needs an invite code. Add it in Settings.";
  if (code === "disabled") return "The shared AI proxy is switched off by its owner right now. You can use your own API key (Settings).";
  return fallback;
}

/** Through our Cloudflare Worker. promptId groups the requests of one user prompt. */
export function geminiViaProxy(settings: Settings, options: SessionOptions, promptId: () => string, fetchFn: FetchFn = defaultFetch): ChatSession {
  return new GeminiSession(options, async (body) => {
    const headers: Record<string, string> = { "x-install-id": settings.installId, "x-prompt-id": promptId() };
    if (settings.inviteCode) headers["x-invite-code"] = settings.inviteCode;
    const { res, json } = await postJson(fetchFn, `${settings.proxyUrl.replace(/\/+$/, "")}/v1/generate`, headers, body, "the AI proxy");
    if (!res.ok) {
      const raw = typeof json.error === "string" ? json.error : "http";
      // Google itself is overloaded or unreachable (the proxy already tried again and tried another model).
      if (raw === "upstream" && (json.status === 0 || isOverload(json.status))) throw overloaded("Google");
      if (raw === "http" && isOverload(res.status)) throw overloaded("the AI proxy");
      // A precise code per kind of limit, so the interface can explain it in the user's language.
      const scope: Record<string, string> = { install: "limit_install", global: "limit_global", provider: "limit_global", prompt: "limit_prompt" };
      const code = raw === "rate_limited" ? scope[json.scope] ?? "limit_global" : raw;
      const min = Math.max(1, Math.ceil((json.retryAfterSeconds ?? 60) / 60));
      throw new LlmError(proxyMessage(raw, json.scope, json.message ?? `The AI proxy answered ${res.status}.`, json.retryAfterSeconds), code, json.retryAfterSeconds, { min });
    }
    return json;
  });
}

/** Straight to Google with the user's own key. */
export function geminiDirect(settings: Settings, options: SessionOptions, fetchFn: FetchFn = defaultFetch): ChatSession {
  return new GeminiSession(options, async (body) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`;
    const { res, json } = await postJson(fetchFn, url, { "x-goog-api-key": settings.apiKey.trim() }, {
      systemInstruction: { parts: [{ text: body.systemInstruction }] },
      contents: body.contents,
      tools: body.tools,
      generationConfig: { ...body.generationConfig, maxOutputTokens: MAX_OUTPUT_TOKENS },
    }, "Google");
    if (!res.ok) {
      const message: string = json?.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 400 && /API key/i.test(message)) throw keyError(401, message, "Google", settings.model);
      throw keyError(res.status, message, "Google", settings.model);
    }
    return json;
  });
}
