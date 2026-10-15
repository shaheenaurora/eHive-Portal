import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import * as jose from "jose";
import { env } from "./lib/env";
import {
  signSessionToken,
  verifySessionToken,
  sign2faChallenge,
  verify2faChallenge,
} from "./lib/session";
import { createAuthToken, consumeAuthToken } from "./lib/tokens";

/* H5 — covers the two token libraries the auth paths are built on, without
 * MySQL:
 *  - api/lib/session.ts: session JWT mint/verify (roundtrip, tampered,
 *    expired, wrong secret) and the 2FA challenge token (fingerprint binding).
 *  - api/lib/tokens.ts: reset/verify token hash-at-rest, single-use, TTL and
 *    kind separation, driven through an in-memory auth_tokens store. Only
 *  ../queries/connection is mocked; the real token code runs against it. */

const TEST_SECRET = "test-secret-for-auth-session-tests-0123456789abcdef";
const ORIGINAL_APP_SECRET = env.appSecret;
const ORIGINAL_TOTP_SECRET = env.totpSecret;

beforeEach(() => {
  env.appSecret = TEST_SECRET;
  env.totpSecret = TEST_SECRET;
});
afterEach(() => {
  env.appSecret = ORIGINAL_APP_SECRET;
  env.totpSecret = ORIGINAL_TOTP_SECRET;
});

/* ---- in-memory stand-in for the drizzle connection (tokens.ts only) ---- */
type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  const rows: Row[] = [];
  let nextId = 1;

  /* Minimal evaluator for the conditions tokens.ts emits: eq(col, v),
   * isNull(col), gt(col, date) joined with and(). */
  type Tok = { col?: string; lit?: unknown; raw?: string };
  function flatten(node: unknown, out: Tok[]): void {
    if (node == null) return;
    const qc = (node as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(qc)) {
      for (const c of qc) flatten(c, out);
      return;
    }
    const val = (node as { value?: unknown }).value;
    if (Array.isArray(val)) {
      const raw = val.join("");
      if (raw) out.push({ raw });
      return;
    }
    // Bound parameters arrive as Param { value } objects (drizzle wraps values
    // interpolated next to real columns); unwrap them to the literal value.
    if (val !== undefined && "encoder" in (node as object)) {
      out.push({ lit: val });
      return;
    }
    const name = (node as { name?: unknown }).name;
    if (typeof name === "string") {
      out.push({ col: name });
      return;
    }
    out.push({ lit: node });
  }
  function evalCond(cond: unknown, row: Row): boolean {
    if (cond == null) return true;
    const tokens: Tok[] = [];
    flatten(cond, tokens);
    // split top-level on "and" (no parens in these conditions)
    const parts: Tok[][] = [[]];
    for (const t of tokens) {
      if (t.raw?.trim() === "and") parts.push([]);
      else parts[parts.length - 1].push(t);
    }
    return parts.every(part => {
      const col = part.find(t => t.col)?.col;
      if (!col) return true;
      const raw = part.find(t => t.raw && t.raw.trim() !== "")?.raw?.trim();
      const lit = part.find(t => "lit" in t && t.lit !== undefined)?.lit;
      const value = row[col];
      if (raw === "is null") return value == null;
      if (raw === "is not null") return value != null;
      if (raw === ">") {
        const a = value instanceof Date ? value.getTime() : Number(value);
        const b = lit instanceof Date ? lit.getTime() : Number(lit);
        return a > b;
      }
      // default: equality (stringified — covers hashes, kinds, ids)
      return String(value) === String(lit);
    });
  }

  const fakeDb = {
    select: () => ({
      from: () => {
        let filtered = rows;
        const chain: Record<string, unknown> = {
          where: (cond: unknown) => {
            filtered = filtered.filter(r => evalCond(cond, r));
            return chain;
          },
          limit: () => chain,
          orderBy: () => chain,
          then: (onF: (v: Row[]) => unknown, onR: (e: unknown) => unknown) =>
            Promise.resolve(filtered).then(onF, onR),
        };
        return chain;
      },
    }),
    insert: () => ({
      values: (values: Row) => {
        const row = { ...values, id: nextId++ };
        rows.push(row);
        return Promise.resolve([{ insertId: row.id }, []]);
      },
    }),
    update: () => ({
      set: (values: Row) => ({
        where: async (cond: unknown) => {
          let affected = 0;
          for (const row of rows) {
            if (evalCond(cond, row)) {
              Object.assign(row, values);
              affected++;
            }
          }
          return [{ affectedRows: affected }, []];
        },
      }),
    }),
  };

  return {
    fakeDb,
    rows,
    reset() {
      rows.length = 0;
      nextId = 1;
    },
  };
});

vi.mock("./queries/connection", () => ({ getDb: () => h.fakeDb }));

describe("session JWTs (api/lib/session.ts)", () => {
  it("roundtrips a freshly minted session token", async () => {
    const token = await signSessionToken("user-abc", 42, 3);
    const claim = await verifySessionToken(token);
    expect(claim).toEqual({ uid: "user-abc", sid: 42, tv: 3 });
  });

  it("rejects a tampered token", async () => {
    const token = await signSessionToken("user-abc", 42, 3);
    // Flip characters in the signature segment.
    const last = token.slice(-1);
    const tamperedSig = token.slice(0, -1) + (last === "a" ? "b" : "a");
    expect(await verifySessionToken(tamperedSig)).toBeNull();
    // Swap the payload for a different one without re-signing — the stored
    // signature no longer matches.
    const [header, , sig] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ uid: "user-abc", sid: 1, tv: 1 })
    ).toString("base64url");
    expect(await verifySessionToken(`${header}.${forgedPayload}.${sig}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSessionToken("user-abc", 42, 3);
    env.appSecret = "a-different-secret-entirely-0123456789abcdef";
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const secret = new TextEncoder().encode(env.appSecret);
    const expired = await new jose.SignJWT({
      uid: "user-abc",
      sid: 42,
      tv: 3,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(secret);
    expect(await verifySessionToken(expired)).toBeNull();
  });

  it("rejects empty and malformed tokens", async () => {
    expect(await verifySessionToken("")).toBeNull();
    expect(await verifySessionToken("not.a.jwt")).toBeNull();
  });

  it("2FA challenge: roundtrips and is bound to the client fingerprint", async () => {
    const headers = new Headers({
      "user-agent": "vitest-agent",
      "x-forwarded-for": "203.0.113.7",
    });
    const token = await sign2faChallenge(77, headers);
    expect(await verify2faChallenge(token, headers)).toBe(77);
    // A different UA → different fingerprint → rejected.
    const otherHeaders = new Headers({
      "user-agent": "evil-agent",
      "x-forwarded-for": "203.0.113.7",
    });
    expect(await verify2faChallenge(token, otherHeaders)).toBeNull();
  });

  it("2FA challenge: rejects an expired challenge", async () => {
    // No x-forwarded-for here, so the fingerprint is built from `|ua` only —
    // mirror that exactly so expiry (not the fingerprint) is what fails.
    const headers = new Headers({ "user-agent": "vitest-agent" });
    const fp = createHash("sha256")
      .update("|vitest-agent")
      .digest("base64url")
      .slice(0, 32);
    const secret = new TextEncoder().encode(env.totpSecret);
    const expired = await new jose.SignJWT({ twofa: 77, fp })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(secret);
    expect(await verify2faChallenge(expired, headers)).toBeNull();
  });
});

describe("auth tokens (api/lib/tokens.ts)", () => {
  beforeEach(() => h.reset());

  it("persists only the SHA-256 hash of the raw token", async () => {
    const raw = await createAuthToken(5, "reset", 3600_000);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(h.rows).toHaveLength(1);
    const stored = h.rows[0];
    expect(stored.tokenHash).not.toBe(raw);
    expect(stored.tokenHash).toBe(
      createHash("sha256").update(raw).digest("hex")
    );
    expect(stored.userId).toBe(5);
    expect(stored.kind).toBe("reset");
    // Column omitted at insert (DB default NULL) — never the raw token.
    expect(stored.usedAt).toBeUndefined();
    // TTL honoured: expiresAt ≈ now + ttl.
    const ttl = (stored.expiresAt as Date).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(3500_000);
    expect(ttl).toBeLessThanOrEqual(3600_000);
  });

  it("consumes a valid token exactly once (single-use)", async () => {
    const raw = await createAuthToken(5, "reset", 3600_000);
    expect(await consumeAuthToken(raw, "reset")).toBe(5);
    expect(await consumeAuthToken(raw, "reset")).toBeNull();
    expect(h.rows[0].usedAt).toBeInstanceOf(Date);
  });

  it("a token of one kind can't be consumed as the other", async () => {
    const raw = await createAuthToken(5, "verify", 3600_000);
    expect(await consumeAuthToken(raw, "reset")).toBeNull();
    expect(await consumeAuthToken(raw, "verify")).toBe(5);
  });

  it("rejects an expired token (TTL enforced)", async () => {
    const raw = await createAuthToken(5, "reset", -1000); // already expired
    expect(await consumeAuthToken(raw, "reset")).toBeNull();
    expect(h.rows[0].usedAt).toBeUndefined(); // never marked used
  });

  it("rejects an unknown raw token", async () => {
    expect(await consumeAuthToken("no-such-token", "reset")).toBeNull();
  });
});
