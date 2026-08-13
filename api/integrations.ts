/**
 * Read-only integration API — `/api/integrations/v1/*`. A stable, versioned,
 * API-key-authenticated REST surface for an external ERP / accounting system to
 * pull payments, expenses and members. Disabled (503) until INTEGRATION_API_KEYS
 * is set, so it exposes nothing by default.
 *
 * Conventions:
 *  - Auth: `Authorization: Bearer <key>` or `X-API-Key: <key>`.
 *  - Pagination: `?limit=` (default 100, max 500) + `?cursor=<id>` (keyset by
 *    ascending id). The response's `nextCursor` is null when the last page is
 *    reached.
 *  - Incremental sync: `?updatedSince=<ISO8601>` returns only records changed at
 *    or after that instant (payments/members use updatedAt, expenses createdAt).
 *  - Money: major units (AED), with an explicit `currency`.
 */
import { Hono } from "hono";
import {
  integrationEnabled,
  authorizeIntegration,
  clampLimit,
  toPaymentDto,
  toExpenseDto,
  toMemberDto,
} from "./lib/integration";
import { rateLimit } from "./lib/rate-limit";
import {
  fetchPayments,
  fetchExpenses,
  fetchMembers,
  type PageOpts,
} from "./queries/integrations";

type Ctx = {
  req: {
    header: (n: string) => string | undefined;
    query: (n: string) => string | undefined;
    raw: { headers: Headers };
  };
  json: (body: unknown, status?: number) => Response;
};

function parseOpts(c: Ctx): PageOpts {
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

function list(c: Ctx, rows: { id: number }[], data: unknown[], limit: number) {
  const last = rows[rows.length - 1];
  const nextCursor = rows.length === limit && last ? last.id : null;
  return c.json({ object: "list", data, nextCursor, count: data.length });
}

export const integrationApp = new Hono();

// Gate: enabled + authenticated + rate-limited (per IP; keys are never logged).
integrationApp.use("*", async (c, next) => {
  if (!integrationEnabled())
    return c.json({ error: "Integration API is not enabled." }, 503);
  if (!authorizeIntegration(c.req.raw.headers))
    return c.json({ error: "Invalid or missing API key." }, 401);
  const ip =
    (c.req.header("x-forwarded-for") ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .at(-1) ??
    c.req.header("x-real-ip") ??
    "unknown";
  if (!rateLimit(`integration:${ip}`, 600, 60 * 1000))
    return c.json({ error: "Too many requests. Please slow down." }, 429);
  await next();
});

integrationApp.get("/", c =>
  c.json({
    object: "index",
    version: "v1",
    resources: ["payments", "expenses", "members"],
    docs: "See docs/INTEGRATIONS.md",
  })
);

integrationApp.get("/payments", async c => {
  const opts = parseOpts(c);
  const rows = await fetchPayments(opts);
  return list(c, rows, rows.map(toPaymentDto), opts.limit);
});

integrationApp.get("/expenses", async c => {
  const opts = parseOpts(c);
  const rows = await fetchExpenses(opts);
  return list(c, rows, rows.map(toExpenseDto), opts.limit);
});

integrationApp.get("/members", async c => {
  const opts = parseOpts(c);
  const rows = await fetchMembers(opts);
  return list(c, rows, rows.map(toMemberDto), opts.limit);
});
