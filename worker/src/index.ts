/**
 * spotify-ai-proxy — a small proxy between the Spotify-client extension and
 * the Google Gemini API. It keeps the Gemini API key secret and enforces rate
 * limits. Prompt contents and model answers pass through and are never stored
 * or logged.
 */
import { DEFAULTS, intVar, limitConfig, type Env } from "./env";
import {
  checkOrigin,
  errorResponse,
  hashIp,
  json,
  randomCode,
  readBodyLimited,
  secretsEqual,
  withCors,
} from "./http";
import type { Limits } from "./limits";
import { cameFromFallback, type GeminiRequest, toChatRequest, toGeminiResponse } from "./translate";
import { isUuid, isUuidV4, MAX_BODY_BYTES, validateGenerateBody } from "./validate";

export { Limits } from "./limits";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** No new try is started once this much time has passed since the first one. */
const RETRY_BUDGET_MS = 50_000;
/**
 * Answers after which the next model is tried: out of quota, overloaded, and
 * "this key cannot use this model" (a fallback that is not available must not
 * break the service). 400 is not here: a wrong request is wrong for every model.
 */
const MOVE_ON = new Set([403, 404, 429, 500, 503]);

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) out.headers.set(name, value);
  return out;
}

/** All counters live in one Durable Object instance, so they are exact. */
function limitsStub(env: Env): DurableObjectStub<Limits> {
  return env.LIMITS.get(env.LIMITS.idFromName("limits"));
}

const modelName = (env: Env): string => env.MODEL || DEFAULTS.MODEL;
/** One place an answer can come from. id is what the app and the x-tried trail show. */
interface Target {
  id: string;
  kind: "gemini" | "openrouter" | "workers-ai";
  model: string;
}

const listVar = (value: string | undefined, fallback: string): string[] =>
  (value ?? fallback)
    .split(",")
    .map((name) => name.trim())
    .filter((name, i, all) => /^[@a-zA-Z0-9._:/-]{1,80}$/.test(name) && all.indexOf(name) === i);

/**
 * Everything this proxy may call, in the order it is tried: the main Gemini
 * model, the other Gemini models, then other providers — OpenRouter (only when
 * its key is set) and Workers AI (only when the AI binding exists). A user may
 * ask for one of this list by id, never for anything else.
 */
function targets(env: Env): Target[] {
  const main = modelName(env);
  const out: Target[] = [{ id: main, kind: "gemini", model: main }];
  for (const model of listVar(env.FALLBACK_MODELS, DEFAULTS.FALLBACK_MODELS)) {
    if (model !== main) out.push({ id: model, kind: "gemini", model });
  }
  if (env.OPENROUTER_API_KEY) {
    for (const model of listVar(env.OPENROUTER_MODELS, DEFAULTS.OPENROUTER_MODELS)) out.push({ id: `or:${model}`, kind: "openrouter", model });
  }
  if (env.AI) {
    for (const model of listVar(env.WORKERS_AI_MODELS, DEFAULTS.WORKERS_AI_MODELS)) out.push({ id: `cf:${model}`, kind: "workers-ai", model });
  }
  return out;
}
const allowedModels = (env: Env): string[] => targets(env).map((target) => target.id);

class TimeoutError extends Error {
  override name = "TimeoutError";
}

function synthetic(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}

/**
 * Asks one target. The answer always has Gemini's shape when it is ok; a
 * provider that answers with nothing usable counts as overloaded (503).
 */
async function ask(target: Target, body: GeminiRequest & { raw: unknown }, env: Env, timeoutMs: number): Promise<Response> {
  if (target.kind === "gemini") {
    return fetch(`${GEMINI_BASE}/${encodeURIComponent(target.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY ?? "" },
      body: JSON.stringify(body.raw),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  const chat = toChatRequest(body);
  let answer: unknown;
  if (target.kind === "openrouter") {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENROUTER_API_KEY ?? ""}`, "x-title": "spotify-ai" },
      body: JSON.stringify({ model: target.model, ...chat }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return res;
    answer = await res.json().catch(() => null);
    // OpenRouter can report a provider's failure inside a 200 answer.
    const inner = (answer as { error?: { message?: unknown; code?: unknown } } | null)?.error;
    if (inner) return synthetic(typeof inner.code === "number" && inner.code >= 400 ? inner.code : 503, String(inner.message ?? "provider error"));
  } else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      answer = await Promise.race([
        env.AI!.run(target.model, chat),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new TimeoutError("too slow")), timeoutMs); }),
      ]);
    } catch (err) {
      if (err instanceof TimeoutError) throw err;
      // Out of the free daily allocation, or the model refused the input.
      return synthetic(503, err instanceof Error ? err.message : "Workers AI failed");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  const translated = toGeminiResponse(answer, target.id);
  return translated ? Response.json(translated) : synthetic(503, "The fallback model gave an empty answer.");
}

const inviteRequired = (env: Env): boolean => env.REQUIRE_INVITE === "true";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = checkOrigin(request, env);
    let response: Response;
    try {
      response = await route(request, env, origin.kind === "denied");
    } catch (err) {
      // Log only the error type: never request data.
      console.error("internal error:", err instanceof Error ? err.name : "unknown");
      response = errorResponse(500, "internal", "Internal error.");
    }
    return withCors(response, origin);
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, originDenied: boolean): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;

  if (pathname.startsWith("/admin/")) return admin(request, env, pathname);

  // A browser on a page we do not know. Origin is not authentication (curl can
  // fake it), this only stops other websites from spending a visitor's quota.
  if (originDenied) return errorResponse(403, "forbidden", "This origin is not allowed.");

  if (method === "OPTIONS") return new Response(null, { status: 204 });

  if (pathname === "/v1/generate" || pathname === "/v1/status") {
    if (env.KILL_SWITCH === "true") {
      return errorResponse(503, "disabled", "The service is temporarily switched off.");
    }
    if (pathname === "/v1/generate" && method === "POST") return generate(request, env);
    if (pathname === "/v1/status" && method === "GET") return status(request, env);
  }
  return errorResponse(404, "not_found", "Not found.");
}

// ---- GET /v1/status ----------------------------------------------------------

async function status(request: Request, env: Env): Promise<Response> {
  const installId = request.headers.get("x-install-id");
  if (!isUuidV4(installId)) {
    return errorResponse(400, "bad_request", 'Header "x-install-id" must be a UUID v4.');
  }
  const limits = limitConfig(env);
  // Read-only: does not use quota and does not register the install.
  const left = await limitsStub(env).promptsLeft(installId.toLowerCase(), limits.promptsPerHour);
  return json({
    ok: true,
    model: modelName(env),
    models: allowedModels(env),
    promptsLeftThisHour: left,
    promptsPerHour: limits.promptsPerHour,
    inviteRequired: inviteRequired(env),
  });
}

// ---- POST /v1/generate -------------------------------------------------------

async function generate(request: Request, env: Env): Promise<Response> {
  // 1. Validate everything first: a bad request must not use up quota.
  const installId = request.headers.get("x-install-id");
  if (!isUuidV4(installId)) {
    return errorResponse(400, "bad_request", 'Header "x-install-id" must be a UUID v4.');
  }
  const promptId = request.headers.get("x-prompt-id");
  if (!isUuid(promptId)) {
    return errorResponse(400, "bad_request", 'Header "x-prompt-id" must be a UUID.');
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return errorResponse(400, "bad_request", 'Header "content-type" must be application/json.');
  }

  // Optional: the user's pick from the proxy's own list. It goes first, the rest follow.
  const wanted = request.headers.get("x-model");
  if (wanted !== null && !allowedModels(env).includes(wanted)) {
    return errorResponse(400, "bad_request", 'Header "x-model" is not one of this proxy\'s models.');
  }

  const requireInvite = inviteRequired(env);
  const inviteCode = request.headers.get("x-invite-code")?.trim() || null;
  if (requireInvite && inviteCode === null) {
    return errorResponse(401, "invite_required", "An invite code is required.");
  }

  const bytes = await readBodyLimited(request, MAX_BODY_BYTES);
  if (bytes === null) {
    return errorResponse(413, "payload_too_large", "Request body is larger than 600 KB.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return errorResponse(400, "bad_request", "Body is not valid JSON.");
  }
  const checked = validateGenerateBody(raw);
  if (!checked.ok) return errorResponse(400, "bad_request", checked.message);
  const body = checked.body;

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return errorResponse(503, "disabled", "The service is not configured yet (no API key).");
  }

  // 2. Check and count the request against all limits, BEFORE calling Gemini.
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const verdict = await limitsStub(env).consume({
    installId: installId.toLowerCase(),
    promptId: promptId.toLowerCase(),
    ipHash: await hashIp(ip, env.IP_SALT, env.GEMINI_API_KEY),
    inviteCode,
    requireInvite,
    limits: limitConfig(env),
  });
  if (!verdict.ok) {
    if (verdict.reason === "invite_required") {
      return errorResponse(401, "invite_required", "The invite code is unknown or revoked.");
    }
    return errorResponse(429, "rate_limited", RATE_MESSAGES[verdict.scope], {
      scope: verdict.scope,
      retryAfterSeconds: verdict.retryAfterSeconds,
    });
  }

  // 3. Build the upstream request. Model and output size are fixed here.
  const upstreamBody = {
    ...(body.systemInstruction !== undefined && {
      systemInstruction: { parts: [{ text: body.systemInstruction }] },
    }),
    contents: body.contents,
    ...(body.tools !== undefined && { tools: body.tools }),
    generationConfig: {
      ...body.generationConfig,
      maxOutputTokens: intVar(env.MAX_OUTPUT_TOKENS, DEFAULTS.MAX_OUTPUT_TOKENS),
    },
  };

  // 4. Ask the targets in order. An overloaded Gemini model (500/503) is tried once
  // more after a short wait; a model that is out of quota, too slow or unavailable
  // is skipped; then the other providers get their turn. These extra tries are not
  // counted against the user.
  let chain = targets(env);
  if (wanted !== null) chain = [...chain.filter((target) => target.id === wanted), ...chain.filter((target) => target.id !== wanted)];
  // Function calls made by a fallback provider cannot go back to Gemini: stay with the others.
  if (cameFromFallback(body.contents) && chain.some((target) => target.kind !== "gemini")) {
    chain = chain.filter((target) => target.kind !== "gemini");
  }
  const question = {
    raw: upstreamBody,
    systemInstruction: body.systemInstruction,
    contents: body.contents,
    tools: body.tools,
    temperature: body.generationConfig?.temperature,
    maxOutputTokens: upstreamBody.generationConfig.maxOutputTokens,
  };
  const delayMs = intVar(env.RETRY_DELAY_MS, DEFAULTS.RETRY_DELAY_MS);
  const timeoutMs = intVar(env.UPSTREAM_TIMEOUT_MS, DEFAULTS.UPSTREAM_TIMEOUT_MS);
  const started = Date.now();
  const outOfTime = (): boolean => Date.now() - started > RETRY_BUDGET_MS;
  // Who answered what ("model=200", "model=timeout"): no user data, helps to see why an answer was slow.
  const trail: string[] = [];
  let upstream: Response | null = null;
  attempts: for (const target of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (trail.length > 0 && outOfTime()) break attempts;
      if (attempt > 0 && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        upstream = await ask(target, question, env, timeoutMs);
      } catch (err) {
        // No answer in time, or no connection: not repeated, the next one gets its chance.
        upstream = null;
        trail.push(`${target.id}=${err instanceof Error && err.name === "TimeoutError" ? "timeout" : "unreachable"}`);
        break;
      }
      trail.push(`${target.id}=${upstream.status}`);
      if (upstream.ok) break attempts;
      // Only an overloaded Gemini model is worth repeating.
      if (target.kind !== "gemini" || (upstream.status !== 500 && upstream.status !== 503)) break;
    }
    // Gemini saying "the request itself is wrong" ends the chain; everything else moves on.
    if (upstream !== null && target.kind === "gemini" && !MOVE_ON.has(upstream.status)) break;
  }
  const tried = { "x-tried": trail.join(",").slice(0, 300) };
  if (upstream === null) {
    return withHeaders(errorResponse(502, "upstream", "Could not reach the AI provider.", { status: 0 }), tried);
  }

  if (upstream.ok) {
    // Pass the provider's JSON through unchanged.
    return new Response(upstream.body, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...tried },
    });
  }

  const message = await upstreamMessage(upstream, [apiKey, env.OPENROUTER_API_KEY ?? ""]);
  if (upstream.status === 429) {
    const retryAfter = Number(upstream.headers.get("retry-after"));
    return withHeaders(errorResponse(429, "rate_limited", `The AI provider is rate limiting us: ${message}`, {
      scope: "provider",
      retryAfterSeconds: Number.isInteger(retryAfter) && retryAfter > 0 ? retryAfter : 60,
    }), tried);
  }
  return withHeaders(errorResponse(502, "upstream", message, { status: upstream.status }), tried);
}

const RATE_MESSAGES = {
  install: "You used all your prompts for this hour. Try again later.",
  prompt: "This prompt made too many requests. Start a new prompt.",
  ip: "Too many new installs from your network today.",
  global: "The shared daily limit is used up. Try again tomorrow.",
} as const;

/** Short provider error text. API keys are cut out, should they ever be echoed. */
async function upstreamMessage(upstream: Response, secrets: string[]): Promise<string> {
  let message = `The AI provider returned HTTP ${upstream.status}.`;
  try {
    const parsed: unknown = JSON.parse(await upstream.text());
    const inner = (parsed as { error?: { message?: unknown } } | null)?.error?.message;
    if (typeof inner === "string" && inner !== "") message = inner;
  } catch {
    // Not JSON: keep the generic message.
  }
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, "[redacted]");
  return message.slice(0, 300);
}

// ---- /admin/* (owner only) ---------------------------------------------------

async function admin(request: Request, env: Env, pathname: string): Promise<Response> {
  const notFound = errorResponse(404, "not_found", "Not found.");
  // No ADMIN_TOKEN configured: the admin API does not exist at all.
  if (!env.ADMIN_TOKEN) return notFound;

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token === "" || !(await secretsEqual(token, env.ADMIN_TOKEN))) {
    return errorResponse(401, "unauthorized", "Missing or wrong admin token.");
  }

  const limits = limitsStub(env);
  const method = request.method;

  if (pathname === "/admin/invites" && method === "POST") {
    const bytes = await readBodyLimited(request, 4096);
    let label: unknown;
    try {
      label = (JSON.parse(new TextDecoder().decode(bytes ?? new Uint8Array())) as { label?: unknown })
        ?.label;
    } catch {
      label = undefined;
    }
    if (typeof label !== "string" || label.trim() === "" || label.length > 100) {
      return errorResponse(400, "bad_request", 'Body must be {"label": "<1-100 characters>"}.');
    }
    const invite = await limits.createInvite(randomCode(), label.trim());
    return json({ code: invite.code, label: invite.label });
  }

  if (pathname === "/admin/invites" && method === "GET") {
    return json(await limits.listInvites());
  }

  const prefix = "/admin/invites/";
  if (pathname.startsWith(prefix) && method === "DELETE") {
    const code = pathname.slice(prefix.length);
    if (!(await limits.revokeInvite(code))) {
      return errorResponse(404, "not_found", "No such invite code.");
    }
    return json({ code, revoked: true });
  }

  if (pathname === "/admin/stats" && method === "GET") {
    const stats = await limits.stats();
    return json({ ...stats, globalRequestsPerDay: limitConfig(env).globalRequestsPerDay });
  }

  return notFound;
}
