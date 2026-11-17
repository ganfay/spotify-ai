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
import { isUuid, isUuidV4, MAX_BODY_BYTES, validateGenerateBody } from "./validate";

export { Limits } from "./limits";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const UPSTREAM_TIMEOUT_MS = 60_000;

/** All counters live in one Durable Object instance, so they are exact. */
function limitsStub(env: Env): DurableObjectStub<Limits> {
  return env.LIMITS.get(env.LIMITS.idFromName("limits"));
}

const modelName = (env: Env): string => env.MODEL || DEFAULTS.MODEL;
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
    ipHash: await hashIp(ip, env.IP_SALT),
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

  let upstream: Response;
  try {
    upstream = await fetch(
      `${GEMINI_BASE}/${encodeURIComponent(modelName(env))}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(upstreamBody),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
  } catch {
    return errorResponse(502, "upstream", "Could not reach the AI provider.", { status: 0 });
  }

  if (upstream.ok) {
    // Pass the provider's JSON through unchanged.
    return new Response(upstream.body, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const message = await upstreamMessage(upstream, apiKey);
  if (upstream.status === 429) {
    const retryAfter = Number(upstream.headers.get("retry-after"));
    return errorResponse(429, "rate_limited", `The AI provider is rate limiting us: ${message}`, {
      scope: "provider",
      retryAfterSeconds: Number.isInteger(retryAfter) && retryAfter > 0 ? retryAfter : 60,
    });
  }
  return errorResponse(502, "upstream", message, { status: upstream.status });
}

const RATE_MESSAGES = {
  install: "You used all your prompts for this hour. Try again later.",
  prompt: "This prompt made too many requests. Start a new prompt.",
  ip: "Too many new installs from your network today.",
  global: "The shared daily limit is used up. Try again tomorrow.",
} as const;

/** Short provider error text. The API key is cut out, should it ever be echoed. */
async function upstreamMessage(upstream: Response, apiKey: string): Promise<string> {
  let message = `The AI provider returned HTTP ${upstream.status}.`;
  try {
    const parsed: unknown = JSON.parse(await upstream.text());
    const inner = (parsed as { error?: { message?: unknown } } | null)?.error?.message;
    if (typeof inner === "string" && inner !== "") message = inner;
  } catch {
    // Not JSON: keep the generic message.
  }
  return message.replaceAll(apiKey, "[redacted]").slice(0, 300);
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
