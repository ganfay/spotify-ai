import { env as testEnv } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";
import { normalizeIp } from "../src/http";

// A fake key: the tests check that this string never shows up in a response.
const FAKE_KEY = "test-key-NOT-REAL-123456";
const ADMIN = "test-admin-token";
const ORIGIN = "https://xpui.app.spotify.com";
const BASE = "https://proxy.test";
const GEMINI_OK = { candidates: [{ content: { role: "model", parts: [{ text: "hi" }] } }] };

type UpstreamCall = { url: string; headers: Headers; body: Record<string, unknown> };
let upstreamCalls: UpstreamCall[];
let upstreamReply: () => Response;

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...(testEnv as unknown as Env),
    GEMINI_API_KEY: FAKE_KEY,
    ADMIN_TOKEN: ADMIN,
    RETRY_DELAY_MS: "0",
    ...overrides,
  };
}

const uuid = (): string => crypto.randomUUID();

interface GenOpts {
  env?: Env;
  install?: string;
  prompt?: string;
  ip?: string;
  invite?: string;
  origin?: string | null;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

async function generate(o: GenOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-install-id": o.install ?? uuid(),
    "x-prompt-id": o.prompt ?? uuid(),
    "cf-connecting-ip": o.ip ?? "203.0.113.7",
    ...o.headers,
  };
  if (o.origin !== null) headers["origin"] = o.origin ?? ORIGIN;
  if (o.invite !== undefined) headers["x-invite-code"] = o.invite;
  const body =
    o.rawBody ?? JSON.stringify(o.body ?? { contents: [{ role: "user", parts: [{ text: "x" }] }] });
  return worker.fetch(new Request(`${BASE}/v1/generate`, { method: "POST", headers, body }), o.env ?? makeEnv());
}

async function status(install: string, env: Env = makeEnv()): Promise<Response> {
  return worker.fetch(
    new Request(`${BASE}/v1/status`, { headers: { "x-install-id": install, origin: ORIGIN } }),
    env,
  );
}

async function admin(
  method: string,
  path: string,
  body?: unknown,
  env: Env = makeEnv(),
  token: string | null = ADMIN,
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers["authorization"] = `Bearer ${token}`;
  return worker.fetch(
    new Request(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

type ErrBody = {
  error: string;
  message: string;
  scope?: string;
  retryAfterSeconds?: number;
  status?: number;
};
const errOf = async (res: Response): Promise<ErrBody> => (await res.json()) as ErrBody;

beforeEach(async () => {
  await reset(); // wipe the Durable Object storage between tests
  upstreamCalls = [];
  upstreamReply = () => Response.json(GEMINI_OK);
  // Gemini is mocked: nothing in these tests touches the network.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as RequestInfo, init);
      upstreamCalls.push({
        url: req.url,
        headers: req.headers,
        body: (await req.json()) as Record<string, unknown>,
      });
      return upstreamReply();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("CORS", () => {
  it("answers a preflight for an allowed origin", async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/v1/generate`, { method: "OPTIONS", headers: { origin: ORIGIN } }),
      makeEnv(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("vary")).toContain("Origin");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe(
      "content-type, x-install-id, x-prompt-id, x-invite-code",
    );
  });

  it("does not echo an origin that is not allowed", async () => {
    const pre = await worker.fetch(
      new Request(`${BASE}/v1/generate`, { method: "OPTIONS", headers: { origin: "https://evil.example" } }),
      makeEnv(),
    );
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
    const res = await generate({ origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(upstreamCalls).toHaveLength(0);
  });

  it("supports several origins from ALLOWED_ORIGINS", async () => {
    const env = makeEnv({ ALLOWED_ORIGINS: "https://a.example, https://b.example" });
    const res = await generate({ env, origin: "https://b.example" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://b.example");
  });

  it("puts CORS headers on success and on error responses", async () => {
    const ok = await generate();
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("vary")).toContain("Origin");
    const bad = await generate({ install: "nope" });
    expect(bad.status).toBe(400);
    expect(bad.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("allows requests without an Origin header (curl)", async () => {
    const res = await generate({ origin: null });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("validation", () => {
  const bad = async (o: GenOpts, text?: string): Promise<void> => {
    const res = await generate(o);
    expect(res.status).toBe(400);
    const body = await errOf(res);
    expect(body.error).toBe("bad_request");
    expect(typeof body.message).toBe("string");
    if (text) expect(body.message).toContain(text);
    expect(upstreamCalls).toHaveLength(0);
  };
  const contents = [{ role: "user", parts: [{ text: "x" }] }];

  it("rejects a missing or malformed x-install-id", async () => {
    await bad({ install: "not-a-uuid" }, "x-install-id");
    // a valid UUID, but version 1 instead of 4
    await bad({ install: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" }, "x-install-id");
  });
  it("rejects a missing or malformed x-prompt-id", () => bad({ prompt: "123" }, "x-prompt-id"));
  it("rejects a non-JSON content type", () =>
    bad({ headers: { "content-type": "text/plain" } }, "content-type"));
  it("rejects invalid JSON", () => bad({ rawBody: "{nope" }, "JSON"));
  it("rejects a non-object body", () => bad({ body: [1, 2] }));
  it("rejects missing / empty contents", async () => {
    await bad({ body: {} }, "contents");
    await bad({ body: { contents: [] } }, "contents");
  });
  it("rejects more than 200 contents items", () =>
    bad({ body: { contents: Array.from({ length: 201 }, () => contents[0]) } }, "200"));
  it("rejects a systemInstruction over 8000 chars", () =>
    bad({ body: { contents, systemInstruction: "a".repeat(8001) } }, "8000"));
  it("rejects unknown top-level keys such as model", async () => {
    await bad({ body: { contents, model: "gemini-ultra" } }, "model");
    await bad({ body: { contents, safetySettings: [] } });
  });
  it("rejects unknown generationConfig keys such as maxOutputTokens", () =>
    bad({ body: { contents, generationConfig: { maxOutputTokens: 99999 } } }, "maxOutputTokens"));
  it("rejects wrong types", async () => {
    await bad({ body: { contents, tools: {} } });
    await bad({ body: { contents, generationConfig: { temperature: "hot" } } });
    await bad({ body: { contents, generationConfig: { responseSchema: [] } } });
  });

  it("rejects a body over 600 KB with 413", async () => {
    const res = await generate({
      body: { contents: [{ role: "user", parts: [{ text: "a".repeat(601 * 1024) }] }] },
    });
    expect(res.status).toBe(413);
    expect((await errOf(res)).error).toBe("payload_too_large");
    expect(upstreamCalls).toHaveLength(0);
  });

  it("does not use quota for invalid requests", async () => {
    const install = uuid();
    await generate({ install, body: {} });
    const s = (await (await status(install)).json()) as { promptsLeftThisHour: number };
    expect(s.promptsLeftThisHour).toBe(5);
  });

  it("returns 404 not_found for unknown routes", async () => {
    const res = await worker.fetch(new Request(`${BASE}/v2/whatever`), makeEnv());
    expect(res.status).toBe(404);
    expect((await errOf(res)).error).toBe("not_found");
  });
});

describe("happy path", () => {
  it("returns the upstream JSON unchanged and fixes model + maxOutputTokens", async () => {
    const res = await generate({
      body: {
        systemInstruction: "be short",
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        tools: [{ functionDeclarations: [{ name: "list_playlists" }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(GEMINI_OK);

    expect(upstreamCalls).toHaveLength(1);
    const call = upstreamCalls[0]!;
    expect(call.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
    );
    expect(call.headers.get("x-goog-api-key")).toBe(FAKE_KEY);
    expect(call.body).toEqual({
      systemInstruction: { parts: [{ text: "be short" }] },
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      tools: [{ functionDeclarations: [{ name: "list_playlists" }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        maxOutputTokens: 16384,
      },
    });
  });

  it("takes model and output size from env, never from the client", async () => {
    const env = makeEnv({ MODEL: "gemini-other", MAX_OUTPUT_TOKENS: "123" });
    await generate({ env });
    const call = upstreamCalls[0]!;
    expect(call.url).toContain("/models/gemini-other:generateContent");
    expect(call.body).toEqual({
      contents: [{ role: "user", parts: [{ text: "x" }] }],
      generationConfig: { maxOutputTokens: 123 },
    });
    // The client headers are not forwarded either.
    expect(call.headers.get("x-install-id")).toBeNull();
    expect(call.headers.get("origin")).toBeNull();
  });

  it("answers 503 when no API key is configured", async () => {
    const res = await generate({ env: makeEnv({ GEMINI_API_KEY: undefined }) });
    expect(res.status).toBe(503);
    expect(upstreamCalls).toHaveLength(0);
  });
});

describe("upstream errors and the API key", () => {
  it("maps upstream 500 to 502 upstream", async () => {
    upstreamReply = () =>
      Response.json({ error: { code: 500, message: "backend exploded" } }, { status: 500 });
    const res = await generate();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream", status: 500, message: "backend exploded" });
  });

  it("maps upstream 429 to 429 scope provider", async () => {
    upstreamReply = () =>
      Response.json({ error: { code: 429, message: "quota" } }, { status: 429 });
    const res = await generate();
    expect(res.status).toBe(429);
    const body = await errOf(res);
    expect(body.error).toBe("rate_limited");
    expect(body.scope).toBe("provider");
  });

  it("handles a non-JSON upstream error and a network failure", async () => {
    upstreamReply = () => new Response("<html>bad gateway</html>", { status: 503 });
    const res = await generate();
    expect(res.status).toBe(502);
    expect((await errOf(res)).status).toBe(503);

    upstreamReply = () => {
      throw new TypeError("network down");
    };
    const res2 = await generate();
    expect(res2.status).toBe(502);
    expect((await errOf(res2)).error).toBe("upstream");
  });

  it("never leaks the API key, even if upstream echoes it", async () => {
    const texts: string[] = [];
    const collect = async (res: Response): Promise<void> => {
      texts.push(await res.text(), JSON.stringify([...res.headers]));
    };
    await collect(await generate());
    upstreamReply = () =>
      Response.json({ error: { message: `API key ${FAKE_KEY} is invalid` } }, { status: 400 });
    const echoed = await generate();
    expect(echoed.status).toBe(502);
    await collect(echoed);
    upstreamReply = () => Response.json({ error: { message: `${FAKE_KEY}` } }, { status: 429 });
    await collect(await generate());
    await collect(await generate({ body: {} }));
    await collect(await status(uuid()));
    await collect(await admin("GET", "/admin/stats"));
    await collect(await admin("GET", "/admin/invites"));
    for (const t of texts) expect(t).not.toContain(FAKE_KEY);
    expect(texts.join("")).toContain("[redacted]");
  });
});

describe("retries and the fallback model", () => {
  const modelOf = (call: UpstreamCall): string => /models\/([^:]+):/.exec(call.url)![1]!;
  const overloaded = (): Response =>
    Response.json({ error: { code: 503, message: "This model is currently experiencing high demand." } }, { status: 503 });

  it("repeats an overloaded model once, then succeeds", async () => {
    let n = 0;
    upstreamReply = () => (++n === 1 ? overloaded() : Response.json(GEMINI_OK));
    const res = await generate();
    expect(res.status).toBe(200);
    expect(upstreamCalls.map(modelOf)).toEqual(["gemini-3.5-flash-lite", "gemini-3.5-flash-lite"]);
  });

  it("moves to the fallback model when the main one stays overloaded", async () => {
    let n = 0;
    upstreamReply = () => (++n <= 2 ? overloaded() : Response.json(GEMINI_OK));
    const res = await generate();
    expect(res.status).toBe(200);
    expect(upstreamCalls.map(modelOf)).toEqual(["gemini-3.5-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash"]);
  });

  it("skips a model that is out of quota without repeating it", async () => {
    let n = 0;
    upstreamReply = () => (++n === 1 ? Response.json({ error: { message: "quota" } }, { status: 429 }) : Response.json(GEMINI_OK));
    const res = await generate();
    expect(res.status).toBe(200);
    expect(upstreamCalls.map(modelOf)).toEqual(["gemini-3.5-flash-lite", "gemini-3.6-flash"]);
  });

  it("gives up after two tries per model and reports the overload", async () => {
    upstreamReply = overloaded;
    const res = await generate();
    expect(res.status).toBe(502);
    expect((await errOf(res)).status).toBe(503);
    expect(upstreamCalls).toHaveLength(4);
  });

  it("does not repeat a request the provider rejects (400), and counts one request", async () => {
    upstreamReply = () => Response.json({ error: { message: "bad" } }, { status: 400 });
    const install = uuid();
    const res = await generate({ install });
    expect(res.status).toBe(502);
    expect(upstreamCalls).toHaveLength(1);
  });

  it("FALLBACK_MODELS empty switches the fallback off", async () => {
    upstreamReply = overloaded;
    await generate({ env: makeEnv({ FALLBACK_MODELS: "" }) });
    expect(upstreamCalls).toHaveLength(2);
  });
});

describe("limits", () => {
  it("prompts per hour: new prompt ids are limited, a counted one keeps working", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-10T10:00:00Z"));
    const install = uuid();
    const prompts = Array.from({ length: 5 }, uuid);
    for (const [i, prompt] of prompts.entries()) {
      vi.setSystemTime(new Date(`2026-03-10T10:0${i}:00Z`));
      expect((await generate({ install, prompt })).status).toBe(200);
    }
    vi.setSystemTime(new Date("2026-03-10T10:30:00Z"));

    const res = await generate({ install });
    expect(res.status).toBe(429);
    const body = await errOf(res);
    expect(body).toMatchObject({ error: "rate_limited", scope: "install" });
    // The oldest prompt (10:00) leaves the window at 11:00 → 30 minutes.
    expect(body.retryAfterSeconds).toBe(1800);
    expect(res.headers.get("retry-after")).toBe("1800");
    expect(upstreamCalls).toHaveLength(5);

    // The agent loop of an already counted prompt is not interrupted.
    expect((await generate({ install, prompt: prompts[4] })).status).toBe(200);
    // Another install is not affected.
    expect((await generate()).status).toBe(200);

    // Rolling window: at 11:00:01 the 10:00 prompt is out, one slot is free.
    vi.setSystemTime(new Date("2026-03-10T11:00:01Z"));
    expect((await generate({ install })).status).toBe(200);
    expect((await generate({ install })).status).toBe(429);
  });

  it("requests per prompt", async () => {
    const env = makeEnv({ REQUESTS_PER_PROMPT: "3" });
    const install = uuid();
    const prompt = uuid();
    for (let i = 0; i < 3; i++) expect((await generate({ env, install, prompt })).status).toBe(200);
    const res = await generate({ env, install, prompt });
    expect(res.status).toBe(429);
    expect(await errOf(res)).toMatchObject({ error: "rate_limited", scope: "prompt" });
    expect(upstreamCalls).toHaveLength(3);
    // A new prompt id works again.
    expect((await generate({ env, install })).status).toBe(200);
  });

  it("default requests per prompt is 24", async () => {
    const install = uuid();
    const prompt = uuid();
    for (let i = 0; i < 24; i++) expect((await generate({ install, prompt })).status).toBe(200);
    expect((await generate({ install, prompt })).status).toBe(429);
  });

  it("new installs per IP per day; known installs are never blocked", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-10T10:00:00Z"));
    const ip = "198.51.100.9";
    const first = uuid();
    expect((await generate({ ip, install: first })).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await generate({ ip })).status).toBe(200);

    const res = await generate({ ip });
    expect(res.status).toBe(429);
    const body = await errOf(res);
    expect(body).toMatchObject({ error: "rate_limited", scope: "ip" });
    expect(body.retryAfterSeconds).toBe(14 * 3600);
    expect(upstreamCalls).toHaveLength(5);

    // Known install from the same IP still works; another IP can register.
    expect((await generate({ ip, install: first })).status).toBe(200);
    expect((await generate({ ip: "198.51.100.10" })).status).toBe(200);

    // Next UTC day: the IP may register new installs again.
    vi.setSystemTime(new Date("2026-03-11T00:00:01Z"));
    expect((await generate({ ip })).status).toBe(200);
  });

  it("global daily cap", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-10T23:00:00Z"));
    const env = makeEnv({ GLOBAL_REQUESTS_PER_DAY: "3" });
    for (let i = 0; i < 3; i++) {
      expect((await generate({ env, ip: `192.0.2.${i}` })).status).toBe(200);
    }
    const res = await generate({ env, ip: "192.0.2.50" });
    expect(res.status).toBe(429);
    const body = await errOf(res);
    expect(body).toMatchObject({ error: "rate_limited", scope: "global" });
    expect(body.retryAfterSeconds).toBe(3600);
    expect(upstreamCalls).toHaveLength(3);

    vi.setSystemTime(new Date("2026-03-11T00:00:01Z"));
    expect((await generate({ env, ip: "192.0.2.51" })).status).toBe(200);
  });

  it("counts a request even when upstream fails (counted before the call)", async () => {
    const env = makeEnv({ GLOBAL_REQUESTS_PER_DAY: "1" });
    upstreamReply = () => new Response("boom", { status: 500 });
    expect((await generate({ env })).status).toBe(502);
    expect((await generate({ env })).status).toBe(429);
  });

  it("treats IPv6 addresses of one /64 as one IP", () => {
    expect(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2");
    expect(normalizeIp("2001:0db8:1:2::1")).toBe("2001:db8:1:2");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8:0:0");
    expect(normalizeIp("203.0.113.7")).toBe("203.0.113.7");
  });
});

describe("kill switch", () => {
  it("answers 503 disabled and does not call upstream", async () => {
    const env = makeEnv({ KILL_SWITCH: "true" });
    const res = await generate({ env });
    expect(res.status).toBe(503);
    expect((await errOf(res)).error).toBe("disabled");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect((await status(uuid(), env)).status).toBe(503);
    expect(upstreamCalls).toHaveLength(0);
  });
});

describe("/v1/status", () => {
  it("reports quota without consuming it or registering the install", async () => {
    const install = uuid();
    for (let i = 0; i < 3; i++) {
      const res = await status(install);
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
      expect(await res.json()).toEqual({
        ok: true,
        model: "gemini-3.5-flash-lite",
        promptsLeftThisHour: 5,
        promptsPerHour: 5,
        inviteRequired: false,
      });
    }
    const stats = (await (await admin("GET", "/admin/stats")).json()) as {
      installsSeen: number;
      requestsToday: number;
    };
    expect(stats).toMatchObject({ installsSeen: 0, requestsToday: 0 });

    const prompt = uuid();
    await generate({ install, prompt });
    await generate({ install, prompt }); // same prompt: still one prompt used
    await generate({ install });
    const after = (await (await status(install)).json()) as { promptsLeftThisHour: number };
    expect(after.promptsLeftThisHour).toBe(3);
  });

  it("requires a valid x-install-id and reflects REQUIRE_INVITE", async () => {
    expect((await status("bad")).status).toBe(400);
    const body = (await (await status(uuid(), makeEnv({ REQUIRE_INVITE: "true" }))).json()) as {
      inviteRequired: boolean;
    };
    expect(body.inviteRequired).toBe(true);
  });
});

describe("admin + invites", () => {
  it("admin routes are 404 without ADMIN_TOKEN and 401 with a wrong token", async () => {
    const off = makeEnv({ ADMIN_TOKEN: undefined });
    expect((await admin("GET", "/admin/stats", undefined, off)).status).toBe(404);
    expect((await admin("GET", "/admin/invites", undefined, off)).status).toBe(404);
    expect((await admin("GET", "/admin/stats", undefined, makeEnv(), "wrong")).status).toBe(401);
    expect((await admin("GET", "/admin/stats", undefined, makeEnv(), null)).status).toBe(401);
    expect((await admin("POST", "/admin/invites", { label: "x" }, makeEnv(), "wrong")).status).toBe(401);
  });

  it("create, list, use and revoke an invite code", async () => {
    const env = makeEnv({ REQUIRE_INVITE: "true" });

    const missing = await generate({ env });
    expect(missing.status).toBe(401);
    expect((await errOf(missing)).error).toBe("invite_required");

    const unknown = await generate({ env, invite: "does-not-exist-1234" });
    expect(unknown.status).toBe(401);
    expect((await errOf(unknown)).error).toBe("invite_required");
    expect(upstreamCalls).toHaveLength(0);

    const created = await admin("POST", "/admin/invites", { label: "Friend A" }, env);
    expect(created.status).toBe(200);
    const { code, label } = (await created.json()) as { code: string; label: string };
    expect(label).toBe("Friend A");
    expect(code).toMatch(/^[A-Za-z0-9_-]{16,}$/);

    const list = (await (await admin("GET", "/admin/invites", undefined, env)).json()) as {
      code: string;
      label: string;
      createdAt: string;
      revoked: boolean;
    }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ code, label: "Friend A", revoked: false });
    expect(Number.isNaN(Date.parse(list[0]!.createdAt))).toBe(false);

    // The code opens the door; limits stay per install id.
    const install = uuid();
    expect((await generate({ env, invite: code, install })).status).toBe(200);
    expect((await generate({ env, invite: code })).status).toBe(200);
    const s = (await (await status(install, env)).json()) as { promptsLeftThisHour: number };
    expect(s.promptsLeftThisHour).toBe(4);

    const revoked = await admin("DELETE", `/admin/invites/${code}`, undefined, env);
    expect(revoked.status).toBe(200);
    const after = await generate({ env, invite: code, install });
    expect(after.status).toBe(401);
    expect((await errOf(after)).error).toBe("invite_required");
    const list2 = (await (await admin("GET", "/admin/invites", undefined, env)).json()) as {
      revoked: boolean;
    }[];
    expect(list2[0]!.revoked).toBe(true);

    expect((await admin("DELETE", "/admin/invites/nope", undefined, env)).status).toBe(404);
    expect((await admin("POST", "/admin/invites", { label: 5 }, env)).status).toBe(400);
    expect(upstreamCalls).toHaveLength(2);
  });

  it("invite codes are ignored when REQUIRE_INVITE is false", async () => {
    expect((await generate({ invite: "whatever" })).status).toBe(200);
  });

  it("stats: request count, installs seen, top installs with short ids", async () => {
    const a = uuid();
    const b = uuid();
    const p = uuid();
    await generate({ install: a, prompt: p });
    await generate({ install: a, prompt: p });
    await generate({ install: a });
    await generate({ install: b });
    const stats = (await (await admin("GET", "/admin/stats")).json()) as {
      requestsToday: number;
      installsSeen: number;
      topInstalls: { install: string; prompts: number; requests: number }[];
    };
    expect(stats.requestsToday).toBe(4);
    expect(stats.installsSeen).toBe(2);
    expect(stats.topInstalls).toEqual([
      { install: a.slice(0, 8), prompts: 2, requests: 3 },
      { install: b.slice(0, 8), prompts: 1, requests: 1 },
    ]);
    expect(JSON.stringify(stats)).not.toContain(a);
  });
});

describe("hardening after the security review", () => {
  const user = (parts: unknown[]) => ({ contents: [{ role: "user", parts }] });

  it("refuses built-in Gemini tools and functions that are not this app's", async () => {
    for (const tools of [[{ googleSearch: {} }], [{ codeExecution: {} }], [{ urlContext: {} }], [{ functionDeclarations: [{ name: "send_email" }] }], [{ functionDeclarations: [] }]]) {
      const res = await generate({ body: { ...user([{ text: "x" }]), tools } });
      expect(res.status).toBe(400);
    }
    expect(upstreamCalls).toHaveLength(0);
    const ok = await generate({ body: { ...user([{ text: "x" }]), tools: [{ functionDeclarations: [{ name: "get_tracks" }, { name: "propose_split" }] }] } });
    expect(ok.status).toBe(200);
  });

  it("refuses files, inline media and unknown content fields; accepts function calls and results", async () => {
    for (const body of [
      user([{ inlineData: { mimeType: "image/png", data: "AAAA" } }]),
      user([{ fileData: { fileUri: "https://example.com/x" } }]),
      user([{ executableCode: { code: "1" } }]),
      { contents: [{ role: "system", parts: [{ text: "x" }] }] },
      { contents: [{ role: "user", parts: [] }] },
      { contents: [{ role: "user", parts: [{ text: "x" }], extra: 1 }] },
      { ...user([{ text: "x" }]), generationConfig: { responseMimeType: "image/png" } },
    ]) {
      expect((await generate({ body })).status).toBe(400);
    }
    const ok = await generate({
      body: {
        contents: [
          { role: "user", parts: [{ text: "x" }] },
          { role: "model", parts: [{ functionCall: { name: "list_playlists", args: {} }, thoughtSignature: "s" }] },
          { role: "user", parts: [{ functionResponse: { name: "list_playlists", response: { playlists: [] } } }] },
        ],
      },
    });
    expect(ok.status).toBe(200);
  });

  it("one install cannot use more than its daily share", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-10T10:00:00Z"));
    const env = makeEnv({ REQUESTS_PER_INSTALL_PER_DAY: "3", PROMPTS_PER_HOUR: "50" });
    const install = uuid();
    for (let i = 0; i < 3; i++) expect((await generate({ env, install })).status).toBe(200);
    const res = await generate({ env, install });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { scope: string }).scope).toBe("install");
    // another install from another address is not affected
    expect((await generate({ env, ip: "198.51.100.77" })).status).toBe(200);
    vi.setSystemTime(new Date("2026-03-11T00:00:05Z"));
    expect((await generate({ env, install })).status).toBe(200);
    vi.useRealTimers();
  });

  it("one address cannot use more than its daily share, even with several installs", async () => {
    const env = makeEnv({ REQUESTS_PER_IP_PER_DAY: "4", NEW_INSTALLS_PER_IP_PER_DAY: "50" });
    const ip = "198.51.100.200";
    for (let i = 0; i < 4; i++) expect((await generate({ env, ip })).status).toBe(200);
    const res = await generate({ env, ip });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { scope: string }).scope).toBe("ip");
    expect((await generate({ env, ip: "198.51.100.201" })).status).toBe(200);
  });
});
