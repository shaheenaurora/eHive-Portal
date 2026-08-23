/**
 * Read-only integration API — `/api/integrations/v1/*`. A stable, versioned,
 * API-key-authenticated REST surface for an external ERP / accounting system to
 * pull payments, expenses and members. Disabled (503) until INTEGRATION_API_KEYS
 * is set, so it exposes nothing by default.
 *
 * Conventions:
 *  - Auth: `Authorization: Bearer <key>` or `X-API-Key: <key>`.
 *  - Scoping: keys can be restricted to `payments`, `expenses`, `members` or `*`
 *    (full). Plain keys are backward-compatible and grant full access.
 *  - Rotation: configure multiple scoped keys during a cutover; remove the old
 *    key once the external system is switched over.
 *  - Pagination: `?limit=` (default 100, max 500) + `?cursor=<id>` (keyset by
 *    ascending id). The response's `nextCursor` is null when the last page is
 *    reached.
 *  - Incremental sync: `?updatedSince=<ISO8601>` returns only records changed at
 *    or after that instant (payments/members use updatedAt, expenses createdAt).
 *  - Money: major units (AED), with an explicit `currency`.
 */
import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  integrationEnabled,
  authorizeIntegration,
  hasScope,
  clampLimit,
  toPaymentDto,
  toExpenseDto,
  toMemberDto,
} from "./lib/integration";
import { rateLimit } from "./lib/rate-limit";
import { audit } from "./lib/audit";
import type { IntegrationApiKey } from "./lib/env";
import {
  fetchPayments,
  fetchExpenses,
  fetchMembers,
  type PageOpts,
} from "./queries/integrations";

const INTEGRATION_KEY = "integrationKey";

function keyHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function parseOpts(c: Context): PageOpts {
  const cursorRaw = Number(c.req.query("cursor"));
  const sinceRaw = c.req.query("updatedSince");
  const since = sinceRaw ? new Date(sinceRaw) : undefined;
  return {
    limit: clampLimit(c.req.query("limit")),
    cursor:
      Number.isFinite(cursorRaw) && cursorRaw > 0
        ? Math.floor(cursorRaw)
        : undefined,
    updatedSince: since && !isNaN(since.getTime()) ? since : undefined,
  };
}

function list(
  c: Context,
  rows: { id: number }[],
  data: unknown[],
  limit: number
) {
  const last = rows[rows.length - 1];
  const nextCursor = rows.length === limit && last ? last.id : null;
  return c.json({ object: "list", data, nextCursor, count: data.length });
}

type Variables = {
  integrationKey: IntegrationApiKey;
};

export const integrationApp = new Hono<{ Variables: Variables }>();

// Gate: enabled + authenticated + rate-limited (per IP; keys are never logged).
integrationApp.use("*", async (c, next) => {
  if (!integrationEnabled())
    return c.json({ error: "Integration API is not enabled." }, 503);
  const key = authorizeIntegration(c.req.raw.headers);
  if (!key) return c.json({ error: "Invalid or missing API key." }, 401);
  c.set(INTEGRATION_KEY, key);
  const ip =
    (c.req.header("x-forwarded-for") ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .at(-1) ??
    c.req.header("x-real-ip") ??
    "unknown";
  // Per-IP bucket + per-key bucket so a compromised key can't exhaust the IP
  // window and a shared IP can't exhaust a key's budget.
  const [ipOk, keyOk] = await Promise.all([
    rateLimit(`integration:ip:${ip}`, 600, 60 * 1000),
    rateLimit(`integration:key:${keyHash(key.value)}`, 2000, 60 * 1000),
  ]);
  if (!ipOk || !keyOk)
    return c.json({ error: "Too many requests. Please slow down." }, 429);
  await next();
});

function requireScope(
  c: Context,
  resource: string
): IntegrationApiKey | Response {
  const key = c.get(INTEGRATION_KEY) as IntegrationApiKey | undefined;
  if (!key || !hasScope(key.scopes, resource)) {
    return c.json(
      { error: `This key does not have access to ${resource}.` },
      403
    );
  }
  return key;
}

async function auditIntegration(c: Context, resource: string, count: number) {
  const key = c.get(INTEGRATION_KEY) as IntegrationApiKey | undefined;
  if (!key) return;
  await audit(
    { id: 0, email: `integration:${key.name}` },
    `integration.${resource}`,
    { type: resource, detail: `${count} rows` }
  );
}

integrationApp.get("/", c =>
  c.json({
    object: "index",
    version: "v1",
    resources: ["payments", "expenses", "members"],
    docs: "See docs/INTEGRATIONS.md",
  })
);

integrationApp.get("/payments", async c => {
  const denied = requireScope(c, "payments");
  if (denied instanceof Response) return denied;
  const opts = parseOpts(c);
  const rows = await fetchPayments(opts);
  const data = rows.map(toPaymentDto);
  await auditIntegration(c, "payments", data.length);
  return list(c, rows, data, opts.limit);
});

integrationApp.get("/expenses", async c => {
  const denied = requireScope(c, "expenses");
  if (denied instanceof Response) return denied;
  const opts = parseOpts(c);
  const rows = await fetchExpenses(opts);
  const data = rows.map(toExpenseDto);
  await auditIntegration(c, "expenses", data.length);
  return list(c, rows, data, opts.limit);
});

integrationApp.get("/members", async c => {
  const denied = requireScope(c, "members");
  if (denied instanceof Response) return denied;
  const opts = parseOpts(c);
  const rows = await fetchMembers(opts);
  const data = rows.map(toMemberDto);
  await auditIntegration(c, "members", data.length);
  return list(c, rows, data, opts.limit);
});
