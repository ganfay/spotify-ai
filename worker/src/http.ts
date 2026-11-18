import { DEFAULTS, type Env } from "./env";

export type ErrorCode =
  | "bad_request"
  | "invite_required"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "payload_too_large"
  | "rate_limited"
  | "internal"
  | "upstream"
  | "disabled";

export interface ErrorExtra {
  scope?: "install" | "prompt" | "ip" | "global" | "provider";
  retryAfterSeconds?: number;
  /** Upstream HTTP status, only for `upstream` errors. */
  status?: number;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/** The one error shape used everywhere: { error, message, scope?, retryAfterSeconds? }. */
export function errorResponse(
  status: number,
  error: ErrorCode,
  message: string,
  extra: ErrorExtra = {},
): Response {
  const headers: Record<string, string> = {};
  if (extra.retryAfterSeconds !== undefined) {
    headers["retry-after"] = String(extra.retryAfterSeconds);
  }
  return json({ error, ...extra, message }, status, headers);
}

// ---- CORS ------------------------------------------------------------------

export function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? DEFAULTS.ALLOWED_ORIGINS)
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "");
}

export type OriginCheck =
  | { kind: "none" } // no Origin header (curl, server-side): allowed, no CORS headers
  | { kind: "allowed"; origin: string }
  | { kind: "denied" };

export function checkOrigin(request: Request, env: Env): OriginCheck {
  const origin = request.headers.get("origin");
  if (origin === null) return { kind: "none" };
  return allowedOrigins(env).includes(origin) ? { kind: "allowed", origin } : { kind: "denied" };
}

/** Add CORS headers to any response. `Vary: Origin` is always set (cache safety). */
export function withCors(response: Response, check: OriginCheck): Response {
  const out = new Response(response.body, response);
  out.headers.append("vary", "Origin");
  if (check.kind === "allowed") {
    out.headers.set("access-control-allow-origin", check.origin);
    out.headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    out.headers.set(
      "access-control-allow-headers",
      "content-type, x-install-id, x-prompt-id, x-invite-code",
    );
    out.headers.set("access-control-max-age", "86400");
  }
  return out;
}

// ---- body / crypto helpers ---------------------------------------------------

/**
 * Read the request body but stop as soon as it grows past `maxBytes`.
 * Returns null when the body is too large (the caller answers 413).
 */
export async function readBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (request.body === null) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export async function sha256Hex(text: string): Promise<string> {
  return [...(await sha256(text))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare two secrets without leaking, through timing, how much of them matched. */
export async function secretsEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= (ha[i] ?? 0) ^ (hb[i] ?? 0);
  return diff === 0;
}

/**
 * Keyed hash (HMAC-SHA-256) of the client IP. Only this hash is stored.
 * The key must be secret: with a public key every IPv4 address could be tried
 * in seconds. IP_SALT is used when set; otherwise the key is derived from the
 * Gemini API key, which is always present and never leaves the Worker.
 * IPv6 addresses are cut to their /64 prefix first: one home connection owns a
 * whole /64, so hashing the full address would make the per-IP limit useless.
 */
export async function hashIp(ip: string, salt: string | undefined, fallbackSecret: string | undefined): Promise<string> {
  const secret = salt || (fallbackSecret ? `ip-salt|${fallbackSecret}` : "");
  // No secret at all can only happen without an API key, where no request is served anyway.
  const keyBytes = new TextEncoder().encode(secret || crypto.randomUUID());
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(normalizeIp(ip)));
  return [...new Uint8Array(mac)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function normalizeIp(ip: string): string {
  const addr = ip.trim().toLowerCase();
  if (!addr.includes(":")) return addr; // IPv4 or "unknown"
  const [head = "", tail] = addr.split("::");
  const headParts = head === "" ? [] : head.split(":");
  if (tail === undefined) return headParts.slice(0, 4).join(":");
  // "::" stands for a run of zero groups; only the first 4 groups matter here.
  const tailParts = tail === "" ? [] : tail.split(":");
  const zeros = Math.max(0, 8 - headParts.length - tailParts.length);
  return [...headParts, ...Array<string>(zeros).fill("0"), ...tailParts]
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":");
}

/** 16 random bytes as URL-safe base64 (22 characters). */
export function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
