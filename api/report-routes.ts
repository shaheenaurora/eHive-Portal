import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import {
  REPORT_PRICE_AED,
  REPORT_PRICE_FILS,
  REPORT_TOOLS,
  REPORT_TOKEN_TTL_MS,
  REPORT_TOOL_LABEL,
  type ReportTool,
} from "@contracts/constants";
import { env } from "./lib/env";
import { logger } from "./lib/log";
import { rateLimit } from "./lib/rate-limit";
import { paymentsEnabled } from "./lib/payments";
import { signReportToken, verifyReportToken } from "./lib/report-token";
import { normalizeReportDims, recomputeReportTotal } from "./lib/report-total";
import {
  findReportById,
  findReportByToolEmail,
  insertReport,
  markReportRequested,
  reportContactName,
  setReportStripeSession,
  setReportToken,
  updateReportData,
} from "./queries/assessment-reports";
import { sendReportInvoiceRequested, reportToolPage } from "./lib/report-mail";
import {
  AiComposeError,
  buildComposeFacts,
  composeNarrativeCached,
} from "./lib/report-ai";

/* Paid assessment-report API — the server core behind the Brand Check and
   Clarity Scorecard full-report unlock. Mounted in api/boot.ts at
   /api/report. The saved report is owner-only data: every read/mutation after
   save is gated by the signed report token (api/lib/report-token.ts), the
   same id.exp.hmac construction as the booking-manage links.

   - POST /save             persist answers, get a token back
   - GET  /:tool/:token     fetch the saved report (token-gated)
   - GET  /config           price + payment availability + launchOffer flag
   - POST /request-invoice  "bill me instead" — flags the row, emails the owner
                            (403 launch_offer while the launch offer runs)
   - POST /checkout         Stripe checkout for the report (when payments on;
                            403 launch_offer while the launch offer runs)
   - POST /compose          AI narrative for the report (Kimi; upgrades the
                            template client-side; any failure keeps template)

   Same abuse posture as /api/lead: JSON bodies, honeypot field, per-IP
   20/10min on every POST, plus per-token limits on the invoice/checkout
   actions. */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Per-JSON-field cap on stored blobs (contact/answers/dims). */
const REPORT_JSON_CAP = 100_000;

/** Best-effort client IP — identical construction to clientIp() in boot.ts
 *  (rightmost X-Forwarded-For entry, the one our own proxy appended). */
function clientIp(c: {
  req: { header: (n: string) => string | undefined };
}): string {
  const forwarded = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return forwarded.at(-1) ?? c.req.header("x-real-ip") ?? "unknown";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function jsonCapOk(v: unknown): boolean {
  try {
    return JSON.stringify(v ?? null).length <= REPORT_JSON_CAP;
  } catch {
    return false;
  }
}

function isReportTool(v: unknown): v is ReportTool {
  return (
    typeof v === "string" && (REPORT_TOOLS as readonly string[]).includes(v)
  );
}

type VerifiedReport =
  | { row: import("./queries/assessment-reports").AssessmentReportRow }
  | { status: 403 | 404 };

/** Shared gate for token-carrying endpoints: shape → existence (404) →
 *  signature/expiry (403). Same status split as the booking-manage links. */
async function verifiedReport(
  tool: string,
  token: string
): Promise<VerifiedReport> {
  if (!isReportTool(tool)) return { status: 404 };
  const id = Number(String(token).split(".")[0]);
  if (!Number.isInteger(id) || id <= 0) return { status: 403 };
  const row = await findReportById(id);
  if (!row || row.tool !== tool) return { status: 404 };
  if (!verifyReportToken(token, id)) return { status: 403 };
  return { row };
}

export const reportApp = new Hono();

/** Public pricing/availability config for the report paywall on the tool
 *  pages. No DB, no secrets — safe to call on every page load. `launchOffer`
 *  tells the engine the launch-offer phase is running: the full report is
 *  free for everyone and no checkout/invoice UI may be offered. */
reportApp.get("/config", c => {
  return c.json({
    priceAed: REPORT_PRICE_AED,
    priceFils: REPORT_PRICE_FILS,
    paymentsEnabled: paymentsEnabled(),
    launchOffer: env.reportLaunchOffer,
    tools: Object.fromEntries(
      REPORT_TOOLS.map(t => [t, { label: REPORT_TOOL_LABEL[t] }])
    ),
  });
});

/** Save (or re-save) an assessment and get the access token for it. Upserts
 *  the row per (tool, email): a retake updates the answers but keeps the
 *  original token (emailed links keep working) and any paid status. The
 *  overall total is recomputed server-side from dims — the client-sent total
 *  is ignored entirely. */
reportApp.post("/save", async c => {
  if (!(await rateLimit(`report:save:${clientIp(c)}`, 20, 10 * 60 * 1000))) {
    return c.json(
      { ok: false, error: "Too many submissions. Please try again shortly." },
      429
    );
  }
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }
  // Honeypot: same quiet-drop contract as /api/lead — bots get a success
  // response, nothing is persisted.
  const hp = body.company_website ?? body._hp ?? body.website2;
  if (typeof hp === "string" && hp.trim() !== "") {
    return c.json({ ok: true });
  }
  if (!isReportTool(body.tool)) {
    return c.json({ ok: false, error: "unknown tool" }, 400);
  }
  const tool = body.tool;
  const email = typeof body.email === "string" ? body.email.slice(0, 320) : "";
  if (!EMAIL_REGEX.test(email.trim())) {
    return c.json({ ok: false, error: "valid email required" }, 400);
  }
  const contact = isRecord(body.contact) ? body.contact : {};
  if (!isRecord(body.answers)) {
    return c.json({ ok: false, error: "answers required" }, 400);
  }
  if (!jsonCapOk(contact) || !jsonCapOk(body.answers)) {
    return c.json({ ok: false, error: "payload too large" }, 400);
  }
  const dims = normalizeReportDims(body.dims);
  if (!dims || !jsonCapOk(dims)) {
    return c.json({ ok: false, error: "invalid dims" }, 400);
  }
  const total = recomputeReportTotal(dims);
  const band =
    typeof body.band === "string" && body.band.trim()
      ? body.band.trim().slice(0, 32)
      : null;

  try {
    const existing = await findReportByToolEmail(tool, email);
    if (existing) {
      await updateReportData(existing.id, {
        contact,
        answers: body.answers,
        dims,
        total,
        band,
      });
      return c.json({
        ok: true,
        token: existing.token,
        total,
        band,
        paid: existing.paid,
      });
    }
    const id = await insertReport({
      tool,
      // Provisionally unique; replaced by the signed token once we have the id.
      token: randomUUID().replace(/-/g, "").slice(0, 32),
      email,
      contact,
      answers: body.answers,
      dims,
      total,
      band,
    });
    const token = signReportToken(id, Date.now() + REPORT_TOKEN_TTL_MS);
    await setReportToken(id, token);
    return c.json({ ok: true, token, total, band, paid: "free" });
  } catch (err) {
    logger.error("report save failed", { error: err, tool });
    return c.json({ ok: false, error: "storage failed" }, 500);
  }
});

/** Fetch the saved report. Owner-only data — the token IS the credential.
 *  404 when the report doesn't exist, 403 when the token is bad or expired. */
reportApp.get("/:tool/:token", async c => {
  const result = await verifiedReport(
    c.req.param("tool"),
    c.req.param("token")
  );
  if ("status" in result) {
    return c.json(
      {
        ok: false,
        error:
          result.status === 404
            ? "report not found"
            : "invalid or expired link",
      },
      result.status
    );
  }
  const { row } = result;
  return c.json({
    ok: true,
    report: {
      id: row.id,
      tool: row.tool,
      email: row.email,
      contact: row.contact,
      answers: row.answers,
      dims: row.dims,
      total: row.total,
      band: row.band,
      paid: row.paid,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  });
});

/** AI narrative for a saved report (Kimi / Moonshot AI). The client renders
 *  the deterministic template report instantly and upgrades the narrative
 *  sections in place when this returns; on ANY failure (no key configured,
 *  timeout, upstream error, malformed output) it returns a coded 503/502 the
 *  client treats as "keep the template" — never an error surface for the
 *  reader. Contact fields never leave our servers (see api/lib/report-ai.ts);
 *  only dimension scores and the founder's own answer text are sent. */
reportApp.post("/compose", async c => {
  if (!(await rateLimit(`report:compose:${clientIp(c)}`, 20, 10 * 60 * 1000))) {
    return c.json(
      { ok: false, error: "Too many requests. Please try again shortly." },
      429
    );
  }
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }
  const tool = String(body.tool ?? "");
  const token = String(body.token ?? "");
  if (
    !(await rateLimit(`report:compose:tok:${tool}:${token}`, 10, 10 * 60 * 1000))
  ) {
    return c.json(
      { ok: false, error: "Too many requests. Please try again shortly." },
      429
    );
  }
  const result = await verifiedReport(tool, token);
  if ("status" in result) {
    return c.json(
      {
        ok: false,
        error:
          result.status === 404
            ? "report not found"
            : "invalid or expired link",
      },
      result.status
    );
  }
  const { row } = result;
  try {
    const narrative = await composeNarrativeCached(
      token,
      buildComposeFacts(row)
    );
    return c.json({ ok: true, narrative });
  } catch (err) {
    if (err instanceof AiComposeError) {
      /* Client contract: any non-ok = keep the template narrative. */
      const status = err.code === "ai_upstream_error" || err.code === "ai_bad_response" ? 502 : 503;
      logger.warn("report compose failed", { code: err.code, tool });
      return c.json({ ok: false, error: err.code }, status);
    }
    logger.error("report compose failed", { error: err, tool });
    return c.json({ ok: false, error: "compose failed" }, 500);
  }
});

/** Invoice path: flag the report as invoice-requested and tell the owner
 *  inbox. The customer can still pay by card afterwards (checkout allows
 *  requested → paid), so this never blocks the Stripe path. */
reportApp.post("/request-invoice", async c => {
  /* Launch-offer phase: charging must be impossible — the client never
   * calls this, but even a hand-rolled request gets a hard 403. */
  if (env.reportLaunchOffer) {
    return c.json({ ok: false, error: "launch_offer" }, 403);
  }
  if (!(await rateLimit(`report:invoice:${clientIp(c)}`, 20, 10 * 60 * 1000))) {
    return c.json(
      { ok: false, error: "Too many requests. Please try again shortly." },
      429
    );
  }
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }
  const tool = String(body.tool ?? "");
  const token = String(body.token ?? "");
  // Per-token limit on top of the per-IP one — one report can't be spam-flagged.
  if (
    !(await rateLimit(`report:invoice:tok:${tool}:${token}`, 5, 10 * 60 * 1000))
  ) {
    return c.json(
      { ok: false, error: "Too many requests. Please try again shortly." },
      429
    );
  }
  const result = await verifiedReport(tool, token);
  if ("status" in result) {
    return c.json(
      {
        ok: false,
        error:
          result.status === 404
            ? "report not found"
            : "invalid or expired link",
      },
      result.status
    );
  }
  try {
    await markReportRequested(result.row.id);
  } catch (err) {
    logger.error("report request-invoice failed", { error: err, tool });
    return c.json({ ok: false, error: "storage failed" }, 500);
  }
  void sendReportInvoiceRequested({
    tool: result.row.tool,
    email: result.row.email,
    name: reportContactName(result.row.contact),
    token: result.row.token,
  }).catch(err => {
    logger.error("report invoice-request email failed", { error: err, tool });
  });
  return c.json({ ok: true });
});

/** Card path: create a Stripe checkout session for the report. When payments
 *  aren't configured the client must show the invoice path instead — 503 is
 *  the explicit signal for that. The settled session id is how the webhook
 *  finds the row to mark paid. */
reportApp.post("/checkout", async c => {
  /* Launch-offer phase: charging must be impossible — the client never
   * calls this, but even a hand-rolled request gets a hard 403. */
  if (env.reportLaunchOffer) {
    return c.json({ ok: false, error: "launch_offer" }, 403);
  }
  if (
    !(await rateLimit(`report:checkout:${clientIp(c)}`, 20, 10 * 60 * 1000))
  ) {
    return c.json(
      { ok: false, error: "Too many requests. Please try again shortly." },
      429
    );
  }
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }
  const tool = String(body.tool ?? "");
  const token = String(body.token ?? "");
  if (
    !(await rateLimit(
      `report:checkout:tok:${tool}:${token}`,
      10,
      10 * 60 * 1000
    ))
  ) {
    return c.json(
      { ok: false, error: "Too many requests. Please try again shortly." },
      429
    );
  }
  const result = await verifiedReport(tool, token);
  if ("status" in result) {
    return c.json(
      {
        ok: false,
        error:
          result.status === 404
            ? "report not found"
            : "invalid or expired link",
      },
      result.status
    );
  }
  if (!paymentsEnabled()) {
    return c.json({ ok: false, error: "payments_disabled" }, 503);
  }
  const { row } = result;
  if (row.paid === "paid") {
    return c.json({ ok: true, alreadyPaid: true, url: null });
  }
  const label = isReportTool(row.tool) ? REPORT_TOOL_LABEL[row.tool] : row.tool;
  try {
    // Direct Stripe SDK use mirroring api/lib/payments/stripe.ts (inline
    // price_data, no pre-created products). The shared CheckoutInput is
    // membership-shaped (tier/userId), so report sessions are built here;
    // the webhook branch in boot.ts keys off the stored session id instead.
    const stripe = new Stripe(env.stripeSecretKey);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: row.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "aed",
            unit_amount: REPORT_PRICE_FILS,
            product_data: { name: `eHive Full Strategic Report (${label})` },
          },
        },
      ],
      success_url: `${env.publicUrl}/${reportToolPage(row.tool)}?report=${encodeURIComponent(row.token)}&paid=1`,
      cancel_url: `${env.publicUrl}/${reportToolPage(row.tool)}?report=${encodeURIComponent(row.token)}`,
      metadata: {
        reportToken: row.token,
        tool: row.tool,
        kind: "report",
      },
    });
    await setReportStripeSession(row.id, session.id);
    return c.json({ ok: true, url: session.url ?? "" });
  } catch (err) {
    logger.error("report checkout session failed", { error: err, tool });
    return c.json({ ok: false, error: "checkout failed" }, 500);
  }
});
