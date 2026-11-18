import { DurableObject } from "cloudflare:workers";
import type { Env, LimitConfig } from "./env";

/**
 * Limits — the single Durable Object (idFromName("limits")) that owns every
 * counter and the invite codes.
 *
 * Why one object: a Durable Object processes one event at a time and its
 * SQLite calls are synchronous, so "check the limits, then count the request"
 * cannot interleave with another request. Counters are exact.
 *
 * What is stored (and nothing else — never prompt text or model output):
 *   installs  install id, invite code used, first/last seen time
 *   prompts   install id, prompt id, first-seen time, request count
 *   daily     per-UTC-day counters: "global", "ip:<hashed ip>" (new installs),
 *             "ipreq:<hashed ip>" and "inst:<install id>" (requests)
 *   invites   code, label, created time, revoked flag
 */

export type RateScope = "install" | "prompt" | "ip" | "global";

export interface ConsumeInput {
  installId: string;
  promptId: string;
  /** SHA-256 hash of the client IP; the raw IP never reaches this object. */
  ipHash: string;
  inviteCode: string | null;
  requireInvite: boolean;
  limits: LimitConfig;
}

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: "invite_required" }
  | { ok: false; reason: "rate_limited"; scope: RateScope; retryAfterSeconds: number };

export interface InviteInfo {
  code: string;
  label: string;
  createdAt: string;
  revoked: boolean;
}

export interface Stats {
  day: string;
  requestsToday: number;
  installsSeen: number;
  topInstalls: { install: string; prompts: number; requests: number }[];
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Prompt rows and daily counters (incl. hashed IPs) are deleted after this. */
const RETENTION_MS = 2 * DAY_MS;
/**
 * Install rows live longer: deleting one after 2 days would make a returning
 * friend look like a "new install" and wrongly count against the per-IP limit.
 * They hold no IP data, only the id, the invite code and two timestamps.
 */
const INSTALL_RETENTION_MS = 90 * DAY_MS;

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay(now: number): number {
  const nextMidnight = (Math.floor(now / DAY_MS) + 1) * DAY_MS;
  return Math.max(1, Math.ceil((nextMidnight - now) / 1000));
}

export class Limits extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private lastPrune = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS installs (
        install_id  TEXT PRIMARY KEY,
        invite_code TEXT,
        first_seen  INTEGER NOT NULL,
        last_seen   INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS prompts (
        install_id TEXT NOT NULL,
        prompt_id  TEXT NOT NULL,
        first_at   INTEGER NOT NULL,
        requests   INTEGER NOT NULL,
        PRIMARY KEY (install_id, prompt_id)
      );
      CREATE INDEX IF NOT EXISTS prompts_by_time ON prompts (first_at);
      CREATE TABLE IF NOT EXISTS daily (
        day   TEXT NOT NULL,
        key   TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (day, key)
      );
      CREATE TABLE IF NOT EXISTS invites (
        code       TEXT PRIMARY KEY,
        label      TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        revoked    INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  // ---- small SQL helpers -------------------------------------------------

  private count(query: string, ...bindings: (string | number)[]): number {
    const row = this.sql.exec<{ n: number | null }>(query, ...bindings).toArray()[0];
    return row?.n ?? 0;
  }

  private dailyCount(day: string, key: string): number {
    return this.count("SELECT count AS n FROM daily WHERE day = ? AND key = ?", day, key);
  }

  private bumpDaily(day: string, key: string): void {
    this.sql.exec(
      `INSERT INTO daily (day, key, count) VALUES (?, ?, 1)
       ON CONFLICT (day, key) DO UPDATE SET count = count + 1`,
      day,
      key,
    );
  }

  private promptsInWindow(installId: string, now: number): number {
    return this.count(
      "SELECT COUNT(*) AS n FROM prompts WHERE install_id = ? AND first_at > ?",
      installId,
      now - HOUR_MS,
    );
  }

  /** Delete old rows, at most once an hour. Cheap; runs inside a request. */
  private prune(now: number): void {
    if (now - this.lastPrune < HOUR_MS) return;
    this.lastPrune = now;
    this.sql.exec("DELETE FROM prompts WHERE first_at < ?", now - RETENTION_MS);
    this.sql.exec("DELETE FROM daily WHERE day < ?", utcDay(now - RETENTION_MS));
    this.sql.exec("DELETE FROM installs WHERE last_seen < ?", now - INSTALL_RETENTION_MS);
  }

  // ---- public RPC methods ------------------------------------------------

  /**
   * Check every limit and, only if all of them pass, count the request.
   * A rejected request changes nothing. There is no `await` in here, so the
   * whole method is one atomic step; the transaction additionally guarantees
   * that a crash half-way cannot leave half-written counters.
   */
  consume(input: ConsumeInput): ConsumeResult {
    const now = Date.now();
    this.prune(now);
    return this.ctx.storage.transactionSync(() => this.consumeInTx(input, now));
  }

  private consumeInTx(input: ConsumeInput, now: number): ConsumeResult {
    const { installId, promptId, ipHash, limits } = input;
    const day = utcDay(now);

    // 1. Invite code: the door key. Limits below stay per install id.
    if (input.requireInvite) {
      const valid =
        input.inviteCode !== null &&
        this.count(
          "SELECT COUNT(*) AS n FROM invites WHERE code = ? AND revoked = 0",
          input.inviteCode,
        ) > 0;
      if (!valid) return { ok: false, reason: "invite_required" };
    }

    // 2. Global daily cap.
    if (this.dailyCount(day, "global") >= limits.globalRequestsPerDay) {
      return this.limited("global", secondsUntilNextUtcDay(now));
    }

    // 2b. Daily caps per install and per address, so that one caller cannot
    //     use up the quota that everybody shares.
    const installKey = `inst:${installId}`;
    const ipRequestsKey = `ipreq:${ipHash}`;
    if (this.dailyCount(day, installKey) >= limits.requestsPerInstallPerDay) {
      return this.limited("install", secondsUntilNextUtcDay(now));
    }
    if (this.dailyCount(day, ipRequestsKey) >= limits.requestsPerIpPerDay) {
      return this.limited("ip", secondsUntilNextUtcDay(now));
    }

    // 3. New installs per IP per day. Known installs skip this check.
    const known =
      this.count("SELECT COUNT(*) AS n FROM installs WHERE install_id = ?", installId) > 0;
    const ipKey = `ip:${ipHash}`;
    if (!known && this.dailyCount(day, ipKey) >= limits.newInstallsPerIpPerDay) {
      return this.limited("ip", secondsUntilNextUtcDay(now));
    }

    // 4. Per-prompt and per-install limits.
    const prompt = this.sql
      .exec<{ requests: number }>(
        "SELECT requests FROM prompts WHERE install_id = ? AND prompt_id = ?",
        installId,
        promptId,
      )
      .toArray()[0];

    if (prompt) {
      // Already counted prompt: allowed even when the hourly quota is used up,
      // but one prompt cannot make unlimited requests. Retrying will not help,
      // so the hint is simply "about a minute" (start a new prompt instead).
      if (prompt.requests >= limits.requestsPerPrompt) return this.limited("prompt", 60);
    } else if (this.promptsInWindow(installId, now) >= limits.promptsPerHour) {
      const oldest = this.count(
        "SELECT MIN(first_at) AS n FROM prompts WHERE install_id = ? AND first_at > ?",
        installId,
        now - HOUR_MS,
      );
      // No prompt in the window means the limit itself is 0: retry in an hour.
      const freeAt = (oldest === 0 ? now : oldest) + HOUR_MS;
      return this.limited("install", Math.max(1, Math.ceil((freeAt - now) / 1000)));
    }

    // 5. Everything passed: count it.
    if (known) {
      this.sql.exec(
        "UPDATE installs SET last_seen = ?, invite_code = COALESCE(?, invite_code) WHERE install_id = ?",
        now,
        input.requireInvite ? input.inviteCode : null,
        installId,
      );
    } else {
      this.sql.exec(
        "INSERT INTO installs (install_id, invite_code, first_seen, last_seen) VALUES (?, ?, ?, ?)",
        installId,
        input.requireInvite ? input.inviteCode : null,
        now,
        now,
      );
      this.bumpDaily(day, ipKey);
    }
    this.sql.exec(
      `INSERT INTO prompts (install_id, prompt_id, first_at, requests) VALUES (?, ?, ?, 1)
       ON CONFLICT (install_id, prompt_id) DO UPDATE SET requests = requests + 1`,
      installId,
      promptId,
      now,
    );
    this.bumpDaily(day, "global");
    this.bumpDaily(day, installKey);
    this.bumpDaily(day, ipRequestsKey);
    return { ok: true };
  }

  private limited(scope: RateScope, retryAfterSeconds: number): ConsumeResult {
    return { ok: false, reason: "rate_limited", scope, retryAfterSeconds };
  }

  /** Read-only: how many new prompts this install may still start this hour. */
  promptsLeft(installId: string, promptsPerHour: number): number {
    return Math.max(0, promptsPerHour - this.promptsInWindow(installId, Date.now()));
  }

  createInvite(code: string, label: string): InviteInfo {
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO invites (code, label, created_at, revoked) VALUES (?, ?, ?, 0)",
      code,
      label,
      now,
    );
    return { code, label, createdAt: new Date(now).toISOString(), revoked: false };
  }

  listInvites(): InviteInfo[] {
    return this.sql
      .exec<{ code: string; label: string; created_at: number; revoked: number }>(
        "SELECT code, label, created_at, revoked FROM invites ORDER BY created_at, code",
      )
      .toArray()
      .map((r) => ({
        code: r.code,
        label: r.label,
        createdAt: new Date(r.created_at).toISOString(),
        revoked: r.revoked !== 0,
      }));
  }

  /** Returns false when the code does not exist. */
  revokeInvite(code: string): boolean {
    return this.sql.exec("UPDATE invites SET revoked = 1 WHERE code = ?", code).rowsWritten > 0;
  }

  stats(): Stats {
    const now = Date.now();
    const day = utcDay(now);
    const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
    const top = this.sql
      .exec<{ install_id: string; prompts: number; requests: number }>(
        `SELECT install_id, COUNT(*) AS prompts, SUM(requests) AS requests
           FROM prompts WHERE first_at >= ?
          GROUP BY install_id ORDER BY prompts DESC, requests DESC LIMIT 10`,
        dayStart,
      )
      .toArray();
    return {
      day,
      requestsToday: this.dailyCount(day, "global"),
      installsSeen: this.count("SELECT COUNT(*) AS n FROM installs"),
      // Install ids are cut to 8 characters: enough to tell friends apart.
      topInstalls: top.map((r) => ({
        install: r.install_id.slice(0, 8),
        prompts: r.prompts,
        requests: r.requests,
      })),
    };
  }
}
