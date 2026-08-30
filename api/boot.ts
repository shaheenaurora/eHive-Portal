import { installLogScrubber, logger } from "./lib/log";
installLogScrubber();

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { getDb } from "./queries/connection";
import { withTransaction } from "./queries/transaction";
import * as schema from "@db/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { paymentsEnabled, getPaymentProvider } from "./lib/payments";
import {
  BOOKING_SLOTS,
  productDurationMin,
  generateAvailability,
  isSlotAvailable,
  toGstTimestamp,
  formatGstDate,
  formatGstTime,
} from "./lib/booking";
import {
  sendBookingConfirmation,
  notifyLead,
  sendInvoiceReady,
} from "./lib/lead-mail";
import {
  mailProvider,
  mailEnabled,
  verifyMailTransport,
} from "./lib/mailer";
import { activateMembership } from "./queries/circle";
import {
  createInvoiceFromPayment,
  getCreditNoteById,
  getInvoiceById,
  renderInvoiceHtml,
} from "./queries/invoicing";
import { renderCreditNotePdf, renderInvoicePdf } from "./lib/pdf-invoice";
import { hasScope } from "./middleware";
import { authenticateRequest } from "./lib/session";
import { rateLimit } from "./lib/rate-limit";
import { escapeHtml } from "./lib/html";
import { integrationApp } from "./integrations";
import { recordAnalyticsEvent } from "./queries/analytics";
import { incrementRequests, incrementErrors, renderMetrics } from "./lib/metrics";
import { buildScorecardReport } from "../src/lib/scorecard";
import { getSchedulerStatus } from "./lib/scheduler";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

/** CSP hashes for the inline <script> blocks in the static marketing HTML files.
 *  Computed once at startup so we can drop 'unsafe-inline' from script-src. */
function loadInlineScriptHashes(): string[] {
  const dir = join(process.cwd(), "public");
  const hashes = new Set<string>();
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".html")) continue;
      const html = readFileSync(join(dir, file), "utf-8");
      const re = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        const content = m[1];
        if (!content.trim()) continue;
        const hash = createHash("sha256").update(content).digest("base64");
        hashes.add(`'sha256-${hash}'`);
      }
    }
  } catch (err) {
    logger.warn("[csp] could not compute inline script hashes", { error: err });
  }
  return Array.from(hashes);
}

const inlineScriptHashes = loadInlineScriptHashes();

/** Build a CSP script-src directive that allows self, the static inline hashes,
 *  and an optional per-response nonce (used for SSR insight JSON-LD). */
function scriptSrc(nonce?: string): string[] {
  const src = ["'self'", ...inlineScriptHashes];
  if (nonce) src.push(`'nonce-${nonce}'`);
  return src;
}

/** Build the full CSP header value used by the global middleware, optionally
 *  including a per-response nonce for server-rendered inline scripts. */
function buildCsp(nonce?: string): string {
  const directives: Record<string, string | undefined> = {
    "default-src": "'self'",
    "script-src": scriptSrc(nonce).join(" "),
    "style-src": "'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src": "'self' https://fonts.gstatic.com",
    "img-src": "'self' data: blob: https:",
    "connect-src": "'self'",
    "frame-ancestors": "'self'",
    "object-src": "'none'",
    "base-uri": "'self'",
    "form-action": "'self'",
  };
  if (env.isProduction) directives["upgrade-insecure-requests"] = "";
  return Object.entries(directives)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (v ? `${k} ${v}` : k))
    .join("; ");
}

/** Best-effort client IP from proxy headers (Railway sets x-forwarded-for).
 *  Uses the RIGHTMOST address in X-Forwarded-For — the one appended by our own
 *  proxy — so a client can't bypass the per-IP rate limit by prepending spoofed
 *  addresses on the left. Mirrors clientIp() in auth-router.ts. */
function clientIp(c: {
  req: { header: (n: string) => string | undefined };
}): string {
  const forwarded = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return forwarded.at(-1) ?? c.req.header("x-real-ip") ?? "unknown";
}

const app = new Hono<{ Bindings: HttpBindings }>();

/* Baseline security headers on every response. CSP uses hashes for the static
   inline scripts in public*.html and drops 'unsafe-inline' from script-src.
   Styles still allow 'unsafe-inline' because Tailwind/React inject inline
   styles at runtime. Frame options are SAMEORIGIN so the scorecard popup (a
   same-origin iframe) keeps working. */
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: scriptSrc(),
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: env.isProduction ? [] : undefined,
    },
    strictTransportSecurity: "max-age=31536000; includeSubDomains; preload",
    xFrameOptions: "SAMEORIGIN",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "strict-origin-when-cross-origin",
    crossOriginResourcePolicy: "same-origin",
    crossOriginOpenerPolicy: "same-origin-allow-popups",
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
    },
  })
);

/* CSP report-only mode: when CSP_REPORT_ONLY=true, move the enforcing header to
   Report-Only so violations are visible in the browser console / report-uri
   without breaking inline styles. This is the safe path for migrating away from
   'unsafe-inline'. */
if (env.cspReportOnly) {
  app.use("*", async (c, next) => {
    await next();
    const csp = c.res.headers.get("Content-Security-Policy");
    if (csp) {
      c.header("Content-Security-Policy-Report-Only", csp);
      c.res.headers.delete("Content-Security-Policy");
    }
  });
}

/* Restrict cross-origin requests to the canonical public URL in production;
   in development reflect the request origin so local Vite/SPA dev keeps working.
   Credentials are allowed because the portal relies on HTTP-only session cookies. */
app.use(
  cors({
    origin: origin =>
      env.isProduction ? (origin === env.publicUrl ? origin : "") : origin,
    credentials: true,
  })
);

app.use(bodyLimit({ maxSize: 5 * 1024 * 1024 }));

// Increment request counter for observability. 5xx responses are counted below
// in the global error handler.
app.use(async (c, next) => {
  incrementRequests();
  await next();
});

// Count 5xx responses and log structured errors in production.
app.onError((err, c) => {
  incrementErrors();
  if (env.isProduction) {
    logger.error("request error", {
      method: c.req.method,
      path: c.req.path,
      message: err.message,
      stack: err.stack,
    });
  }
  return c.json({ error: "Internal server error" }, 500);
});

app.use("/api/trpc/*", async c => {
  // CSRF defense for cookie-authenticated mutations. A browser always attaches
  // an Origin header to cross-site POSTs, so reject any state-changing request
  // whose Origin host doesn't match the host the browser addressed. Compared
  // against the (forwarded) Host header, not the internal request URL, so it
  // works behind Railway's proxy. GET queries carry no side effects and pass.
  if (c.req.method === "POST") {
    const origin = c.req.header("origin");
    const host = c.req.header("x-forwarded-host") || c.req.header("host");
    if (origin) {
      let ok = false;
      try {
        ok = !!host && new URL(origin).host === host;
      } catch {
        ok = false;
      }
      if (!ok) return c.json({ error: "cross-origin request blocked" }, 403);
    }
    // Coarse per-IP flood protection for authenticated mutations. Generous
    // enough for real interactive use (a tRPC batch counts as one request) but
    // blunts scripted floods. NOTE: in-process only — a distributed limiter
    // (Redis) is tracked separately for multi-replica deployments.
    if (!(await rateLimit(`trpc:${clientIp(c)}`, 600, 60 * 1000))) {
      return c.json({ error: "Too many requests. Please slow down." }, 429);
    }
  }
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

/* Read-only integration API for an external ERP / accounting system. Mounted
   before the static/marketing fallbacks; disabled (503) unless an API key is
   configured. See api/integrations.ts and docs/INTEGRATIONS.md. */
app.route("/api/integrations/v1", integrationApp);

/* Marketing-site lead capture (replaces the old Formspree placeholder).
   Accepts the JSON payloads posted by public/app.js submitLead(). */
app.post("/api/lead", async c => {
  // Public endpoint — rate-limit per IP to blunt spam/abuse (20 submissions per
  // 10 minutes is generous for a real person filling out website forms).
  if (!(await rateLimit(`lead:${clientIp(c)}`, 20, 10 * 60 * 1000))) {
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
  if (!body || typeof body.form !== "string" || !body.form) {
    return c.json({ ok: false, error: "form field required" }, 400);
  }
  // Honeypot: a hidden field real users never see. A bot that fills it gets a
  // success response but nothing is persisted — quietly dropped, no signal back.
  const hp = body.company_website ?? body._hp ?? body.website2;
  if (typeof hp === "string" && hp.trim() !== "") {
    return c.json({ ok: true });
  }
  const email =
    typeof body.email === "string" ? body.email.slice(0, 320) : null;
  const sourcePage =
    typeof body.source_page === "string"
      ? body.source_page.slice(0, 255)
      : null;
  let leadId: number | undefined;
  // Persist Clarity Scorecard results in the same transaction as the lead so
  // the two records are always consistent.
  if (body.form === "clarity-scorecard") {
    const report = buildScorecardReport(body);
    try {
      const ids = await withTransaction(async tx => {
        const leadRes = await tx.insert(schema.leads).values({
          form: String(body.form).slice(0, 64),
          email,
          payload: JSON.stringify(body).slice(0, 60000),
          sourcePage,
        });
        const leadId = Number(
          (leadRes as unknown as [{ insertId: number }])[0].insertId
        );
        if (report) {
          await tx.insert(schema.scorecardResults).values({
            email: email ?? "",
            name:
              typeof body.name === "string" ? body.name.slice(0, 255) : null,
            phone:
              typeof body.phone === "string" ? body.phone.slice(0, 64) : null,
            company:
              typeof body.company === "string"
                ? body.company.slice(0, 255)
                : null,
            location:
              typeof body.location === "string"
                ? body.location.slice(0, 255)
                : null,
            industry:
              typeof body.industry === "string"
                ? body.industry.slice(0, 128)
                : null,
            total: report.total,
            domains: report.domains as unknown as string,
            recommendationProduct: report.recommendation.product,
            recommendationWhy: report.recommendation.why,
            leadId,
          });
        }
        return { leadId };
      });
      leadId = ids.leadId;
    } catch (err) {
      logger.error("lead/scorecard transaction failed", { error: err });
      return c.json({ ok: false, error: "storage failed" }, 500);
    }
  } else {
    try {
      const leadRes = await getDb()
        .insert(schema.leads)
        .values({
          form: body.form.slice(0, 64),
          email,
          payload: JSON.stringify(body).slice(0, 60000),
          sourcePage,
        });
      leadId = Number(
        (leadRes as unknown as [{ insertId: number }])[0].insertId
      );
      // Keep a real newsletter subscriber list in sync with lead captures.
      if (body.form === "newsletter" && email) {
        const name =
          typeof body.name === "string" ? body.name.slice(0, 255) : null;
        await getDb()
          .insert(schema.newsletterSubscribers)
          .values({
            email: email.toLowerCase(),
            name,
            sourcePage,
            status: "subscribed",
          })
          .onDuplicateKeyUpdate({
            set: {
              status: "subscribed",
              unsubscribedAt: null,
              sourcePage,
            },
          });
      }
    } catch (err) {
      logger.error("lead insert failed", { error: err });
      return c.json({ ok: false, error: "storage failed" }, 500);
    }
  }

  // Analytics: record the conversion.
  void recordAnalyticsEvent("lead_submitted", {
    visitorId: body.visitor_id as string | undefined,
    properties: { form: body.form, leadId, sourcePage },
    url: sourcePage,
  });

  // Send notification + confirmation emails and surface the result to the
  // caller so the UI can warn when the confirmation could not be delivered.
  const emailResult = await notifyLead({
    form: body.form,
    email,
    payload: body,
    sourcePage,
  });

  // Update the scorecard nurture stage once we know whether the email went out.
  if (body.form === "clarity-scorecard" && leadId) {
    try {
      await getDb()
        .update(schema.scorecardResults)
        .set({
          nurtureStage: emailResult.confirmSent ? "emailed" : "new",
          emailedAt: emailResult.confirmSent ? new Date() : null,
        })
        .where(eq(schema.scorecardResults.leadId, leadId));
    } catch (err) {
      logger.error("scorecard emailedAt update failed", { error: err });
    }
  }

  return c.json({
    ok: true,
    emailSent: emailResult.confirmSent,
    emailError: emailResult.error || null,
  });
});

/* Public content JSON for the marketing site (published insights + newsletter archive). */
app.get("/api/insights", async c => {
  const rows = await getDb()
    .select({
      slug: schema.insights.slug,
      title: schema.insights.title,
      excerpt: schema.insights.excerpt,
      tag: schema.insights.tag,
      publishedAt: schema.insights.publishedAt,
    })
    .from(schema.insights)
    .where(sql`${schema.insights.publishedAt} is not null`)
    .orderBy(desc(schema.insights.publishedAt))
    .limit(30);
  return c.json({ posts: rows });
});

app.get("/api/insights/:slug", async c => {
  const rows = await getDb()
    .select()
    .from(schema.insights)
    .where(eq(schema.insights.slug, c.req.param("slug")))
    .limit(1);
  const row = rows.at(0);
  if (!row || !row.publishedAt) return c.json({ error: "Not found" }, 404);
  return c.json({ post: { ...row, body: escapeHtml(row.body) } });
});

/* Server-rendered article page — crawlable HTML with per-article <title>, meta
   description, canonical, Open Graph and JSON-LD (SEO/AEO). */
app.get("/insights/:slug", async c => {
  const slug = c.req.param("slug");
  const row = (
    await getDb()
      .select()
      .from(schema.insights)
      .where(eq(schema.insights.slug, slug))
      .limit(1)
  ).at(0);
  if (!row || !row.publishedAt) return c.notFound();
  const origin = new URL(c.req.url).origin;
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const title = esc(row.title);
  const desc = esc(row.excerpt ?? "");
  const url = `${origin}/insights/${row.slug}`;
  const published = row.publishedAt.toISOString();
  const dateLabel = row.publishedAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: row.title,
    description: row.excerpt ?? "",
    datePublished: published,
    dateModified: (row.updatedAt ?? row.publishedAt).toISOString(),
    author: { "@type": "Organization", name: "eHive" },
    publisher: { "@type": "Organization", name: "eHive" },
    mainEntityOfPage: url,
    articleSection: row.tag ?? "Insights",
  }).replace(/</g, "\\u003c");
  const nonce = randomUUID();
  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — eHive</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article"><meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}"><meta property="og:url" content="${url}"><meta property="og:site_name" content="eHive">
<meta property="og:image" content="${origin}/assets/icon-512.png">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${origin}/assets/icon-512.png">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M16 3 27 9.5v13L16 29 5 22.5v-13z' fill='none' stroke='%23DA3A22' stroke-width='2'/%3E%3Ccircle cx='16' cy='16' r='3' fill='%23DA3A22'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.min.css"><link rel="stylesheet" href="/apps.min.css">
<script type="application/ld+json" nonce="${nonce}">${jsonLd}</script>
<style>
  .art-page{background:#F3F1EA;color:#141312;min-height:100vh}
  .art-wrap{max-width:720px;margin:0 auto;padding:calc(72px + clamp(2rem,5vw,3.5rem)) 1.25rem 4.5rem}
  .art-body p{font-size:1.12rem;line-height:1.78;color:#2b2822;margin:0 0 1.3rem}
  .art-body p strong{color:#141312}
  .art-h1{font-size:clamp(1.9rem,5vw,3rem);line-height:1.12;margin:.4rem 0 .7rem;color:#141312}
  .art-meta{color:#6b675d;font-size:.95rem;margin-bottom:2rem}
  .art-page .crumbs{color:#8a857a;margin-bottom:2rem}
  .art-page .crumbs a{color:#16264C}
  .art-page .crumbs i{color:#c5c0b4}
  .art-page .p-name{color:#16264C}
  .art-page .p-name:before,.art-page .p-name:after{background:#16264C}
  .art-cta{margin-top:2.6rem;padding:1.6rem 1.7rem;background:#16264C;color:#F3F1EA;border-radius:14px}
  .art-cta b{color:#fff}
  .art-cta a{color:#fff;text-decoration:underline}
  .art-back{display:inline-block;margin-top:2.2rem;color:#16264C;font-weight:600}
</style>
</head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-nav" id="siteNav"><nav aria-label="Primary">
  <a class="brand" href="/index.html" aria-label="eHive — home"><img src="/assets/ehive-wordmark.png" alt="eHive" width="146" height="26"></a>
  <button class="nav-toggle" id="navToggle" aria-expanded="false" aria-controls="navMenu" aria-label="Menu"><span></span><span></span><span></span></button>
  <ul class="nav-links" id="navMenu">
    <li><a href="/consulting.html">Consulting</a></li>
    <li><a href="/circle.html">eHive Circle</a></li>
    <li><a href="/clarity-scorecard.html">Clarity Scorecard</a></li>
    <li><a href="/brand-check.html">Brand Check</a></li>
    <li><a href="/insights.html">Insights</a></li>
    <li><a href="/login.html">Login</a></li>
  </ul>
</nav></header>
<main id="main"><section class="light art-page"><div class="art-wrap">
  <p class="crumbs"><a href="/index.html">Home</a><i>·</i><a href="/insights.html">Insights</a><i>·</i><span>${esc(row.tag ?? "Article")}</span></p>
  <article>
    <p class="p-name">${esc(row.tag ?? "Insight")}</p>
    <h1 class="art-h1">${title}</h1>
    <p class="art-meta">eHive · ${dateLabel}</p>
    <div class="art-body">${esc(row.body ?? "")}</div>
    <div class="art-cta">
      <b>Think this applies to your business?</b>
      <p style="margin:.4rem 0 0">The clearest next step is a short, honest look at what's actually holding your business up. <a href="/clarity-scorecard.html">Take the Clarity Scorecard →</a></p>
    </div>
  </article>
  <a class="art-back" href="/insights.html">← All insights</a>
</div></section></main>
<script src="/app.min.js" defer></script><script src="/apps.min.js" defer></script>
</body></html>`;
  const cspHeader = env.cspReportOnly
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";
  c.header(cspHeader, buildCsp(nonce));
  return c.html(html);
});

app.get("/api/newsletters", async c => {
  const rows = await getDb()
    .select()
    .from(schema.newsletters)
    .orderBy(desc(schema.newsletters.publishedAt))
    .limit(24);
  return c.json({ issues: rows });
});

/* Public booking API — real availability check + appointment storage. */

/** Return available slots for a product across a date range (inclusive).
 *  Query: ?product=&from=YYYY-MM-DD&to=YYYY-MM-DD */
app.get("/api/availability", async c => {
  const product = c.req.query("product") || "discovery";
  const fromDate = c.req.query("from");
  const toDate = c.req.query("to");
  if (
    !fromDate ||
    !toDate ||
    !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(toDate)
  ) {
    return c.json(
      { error: "from and to dates are required (YYYY-MM-DD)" },
      400
    );
  }
  const start = toGstTimestamp(fromDate, "00:00");
  const end = toGstTimestamp(toDate, "23:59");
  const existing = await getDb()
    .select({
      scheduledAt: schema.appointments.scheduledAt,
      durationMin: schema.appointments.durationMin,
      status: schema.appointments.status,
    })
    .from(schema.appointments)
    .where(
      and(
        gte(schema.appointments.scheduledAt, start),
        lte(schema.appointments.scheduledAt, end)
      )
    );
  return c.json({
    product,
    slots: generateAvailability(existing, fromDate, toDate),
  });
});

/** Create a booking request. Body: { product, date, time, name, email, phone?, notes? } */
app.post("/api/bookings", async c => {
  if (!(await rateLimit(`booking:${clientIp(c)}`, 10, 10 * 60 * 1000))) {
    return c.json(
      {
        ok: false,
        error: "Too many booking attempts. Please try again shortly.",
      },
      429
    );
  }
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }
  const product = typeof body.product === "string" ? body.product : "discovery";
  const date =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : null;
  const time =
    typeof body.time === "string" &&
    BOOKING_SLOTS.includes(body.time as (typeof BOOKING_SLOTS)[number])
      ? body.time
      : null;
  const name =
    typeof body.name === "string" ? body.name.trim().slice(0, 255) : "";
  const email =
    typeof body.email === "string" ? body.email.trim().slice(0, 320) : "";
  const phone =
    typeof body.phone === "string" ? body.phone.trim().slice(0, 64) : null;
  const notes =
    typeof body.notes === "string" ? body.notes.slice(0, 2000) : null;
  if (!date || !time || !name || !email || !email.includes("@")) {
    return c.json({ ok: false, error: "missing or invalid fields" }, 400);
  }

  const durationMin = productDurationMin(product);
  const scheduledAt = toGstTimestamp(date, time);

  // Re-check availability inside a short window to avoid double-booking.
  const windowStart = new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(scheduledAt.getTime() + 24 * 60 * 60 * 1000);
  const existing = await getDb()
    .select({
      scheduledAt: schema.appointments.scheduledAt,
      durationMin: schema.appointments.durationMin,
      status: schema.appointments.status,
    })
    .from(schema.appointments)
    .where(
      and(
        gte(schema.appointments.scheduledAt, windowStart),
        lte(schema.appointments.scheduledAt, windowEnd)
      )
    );
  if (!isSlotAvailable(existing, date, time, durationMin)) {
    return c.json(
      { ok: false, error: "That slot is no longer available." },
      409
    );
  }

  const when = `${formatGstDate(scheduledAt)} · ${formatGstTime(scheduledAt)} GST`;

  let appointmentId: number;
  try {
    appointmentId = await withTransaction(async tx => {
      const leadRes = await tx.insert(schema.leads).values({
        form: "booking",
        email,
        payload: JSON.stringify({ ...body, when }),
        sourcePage: "book.html",
      });
      const leadId = Number(
        (leadRes as unknown as [{ insertId: number }])[0].insertId
      );
      const apptRes = await tx.insert(schema.appointments).values({
        product,
        name,
        email,
        phone,
        notes,
        scheduledAt,
        durationMin,
        leadId,
      });
      return Number((apptRes as unknown as [{ insertId: number }])[0].insertId);
    });
  } catch (err) {
    logger.error("booking transaction failed", { error: err });
    return c.json({ ok: false, error: "Unable to save your booking." }, 500);
  }

  void recordAnalyticsEvent("booking_requested", {
    visitorId: body.visitor_id as string | undefined,
    properties: { product, appointmentId },
    url: "book.html",
  });

  const emailResult = await sendBookingConfirmation({
    name,
    email,
    product,
    when,
    format: `${durationMin}-minute session`,
    phone,
    notes,
    confirmed: false,
  });

  return c.json({
    ok: true,
    appointmentId,
    when,
    emailSent: emailResult.confirmSent,
    emailError: emailResult.error || null,
  });
});

/* Payment gateway webhook (SRS INT-01). Reads the RAW body for signature
   verification, then flips the payment_records row and activates membership.
   Idempotent: a record already marked paid is left untouched. */
app.post("/api/payments/webhook", async c => {
  if (!paymentsEnabled())
    return c.json({ ok: false, error: "payments disabled" }, 404);
  const signature = c.req.header("stripe-signature") ?? "";
  const raw = await c.req.text();
  let result;
  try {
    result = await getPaymentProvider().handleWebhook(raw, signature);
  } catch (err) {
    logger.error("webhook verification failed", { error: err });
    return c.json({ ok: false, error: "invalid signature" }, 400);
  }
  if (!result) return c.json({ ok: true, ignored: true });

  try {
    const db = getDb();
    const record = (
      await db
        .select()
        .from(schema.paymentRecords)
        .where(eq(schema.paymentRecords.providerRef, result.providerRef))
        .limit(1)
    ).at(0);

    if (result.status === "paid") {
      if (!record) {
        logger.error("webhook: no matching payment record", {
          providerRef: result.providerRef,
        });
        return c.json({ ok: false, error: "payment record not found" }, 400);
      }
      if (record.status === "paid")
        return c.json({ ok: true, duplicate: true });
      // The stored record is the authoritative source of user/tier/purpose.
      // Reject if the gateway metadata disagrees, so a tampered session can't
      // activate the wrong membership.
      if (result.userId != null && record.userId !== result.userId) {
        logger.error("webhook: userId mismatch", {
          providerRef: result.providerRef,
          recordUserId: record.userId,
          webhookUserId: result.userId,
        });
        return c.json({ ok: false, error: "user mismatch" }, 400);
      }
      if (result.tier != null && record.tier !== result.tier) {
        logger.error("webhook: tier mismatch", {
          providerRef: result.providerRef,
          recordTier: record.tier,
          webhookTier: result.tier,
        });
        return c.json({ ok: false, error: "tier mismatch" }, 400);
      }
      // Compare-and-swap: only the first concurrent webhook flips pending→paid.
      // The unique index on (provider, providerRef) is the backstop; this WHERE
      // clause makes the update itself idempotent so double activations can't
      // happen even in a race. The invoice is created in the same transaction so
      // the ledger stays in sync with the payment.
      const paidAt = new Date();
      const invoiceResult = await withTransaction(async tx => {
        const paidUpdate = await tx
          .update(schema.paymentRecords)
          .set({ status: "paid", paidAt })
          .where(
            and(
              eq(schema.paymentRecords.id, record.id),
              eq(schema.paymentRecords.status, "pending")
            )
          );
        if (
          (paidUpdate as unknown as [{ affectedRows: number }])[0]
            .affectedRows === 0
        ) {
          return { duplicate: true as const };
        }
        const invoice = await createInvoiceFromPayment(
          tx,
          {
            id: record.id,
            userId: record.userId,
            purpose: record.purpose,
            tier: record.tier ?? null,
            amount: record.amount,
            currency: record.currency,
            paidAt,
          },
          { status: "paid" }
        );
        return {
          duplicate: false as const,
          invoiceNumber: invoice.invoiceNumber,
        };
      });
      if (invoiceResult.duplicate) {
        return c.json({ ok: true, duplicate: true });
      }
      if (record.purpose === "renewal") {
        const { renewMembership } = await import("./queries/circle");
        await renewMembership(record.userId, "Renewed via online payment");
      } else if (record.tier) {
        await activateMembership(
          record.userId,
          record.tier,
          "Membership activated via online payment"
        );
      }
      const payer = (
        await getDb()
          .select({ name: schema.users.name, email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, record.userId))
          .limit(1)
      ).at(0);
      if (payer?.email && invoiceResult.invoiceNumber) {
        sendInvoiceReady({
          email: payer.email,
          name: payer.name,
          invoiceNumber: invoiceResult.invoiceNumber,
          amount: record.amount / 100,
          currency: record.currency,
        }).catch(() => {
          /* non-fatal */
        });
      }
      void recordAnalyticsEvent("payment_succeeded", {
        userId: record.userId,
        properties: {
          purpose: record.purpose,
          tier: record.tier,
          amount: record.amount,
          currency: record.currency,
        },
      });
    } else if (
      result.status === "failed" &&
      record &&
      record.status === "pending"
    ) {
      // Same compare-and-swap guard for the failed transition.
      const failedUpdate = await db
        .update(schema.paymentRecords)
        .set({ status: "failed" })
        .where(
          and(
            eq(schema.paymentRecords.id, record.id),
            eq(schema.paymentRecords.status, "pending")
          )
        );
      if (
        (failedUpdate as unknown as [{ affectedRows: number }])[0]
          .affectedRows === 0
      ) {
        return c.json({ ok: true, duplicate: true });
      }
    }
  } catch (err) {
    logger.error("webhook handling failed", { error: err });
    return c.json({ ok: false, error: "processing failed" }, 500);
  }
  return c.json({ ok: true });
});

/* Printable invoice HTML for finance admins. Protected by the same session cookie
   and finance scope used by the admin tRPC router, so the link can be opened in
   a new tab from AdminFinance. */
app.get("/api/admin/invoice-html", async c => {
  let user;
  try {
    user = await authenticateRequest(c.req.raw.headers);
  } catch {
    return c.json({ error: "Not signed in." }, 401);
  }
  if (!hasScope(user, "finance")) {
    return c.json({ error: "Forbidden." }, 403);
  }
  const rawId = c.req.query("id");
  const id = rawId ? Number(rawId) : NaN;
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid invoice id." }, 400);
  }
  try {
    const row = await getInvoiceById(id);
    const html = renderInvoiceHtml({
      invoiceNumber: row.invoice.invoiceNumber,
      billedAt: row.invoice.billedAt,
      dueAt: row.invoice.dueAt,
      status: row.invoice.status,
      amount: row.invoice.amount,
      currency: row.invoice.currency,
      lineItems: row.invoice.lineItems,
      payerName: row.payerName,
      payerEmail: row.payerEmail,
    });
    return c.html(html);
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return c.json({ error: "Invoice not found." }, 404);
    }
    logger.error("invoice-html render failed", { error: err });
    return c.json({ error: "Unable to render invoice." }, 500);
  }
});

/** Resolve the member name and home chapter for an invoice/credit note. */
async function resolveMemberAndChapter(memberId: number | null): Promise<{
  memberName?: string;
  chapterName?: string;
}> {
  if (!memberId) return {};
  const row = (
    await getDb()
      .select({
        memberName: schema.users.name,
        chapterName: schema.chapters.name,
      })
      .from(schema.members)
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .leftJoin(
        schema.chapters,
        eq(schema.chapters.id, schema.members.homeChapterId)
      )
      .where(eq(schema.members.id, memberId))
      .limit(1)
  ).at(0);
  return {
    memberName: row?.memberName ?? undefined,
    chapterName: row?.chapterName ?? undefined,
  };
}

/* Downloadable invoice PDF for finance admins. Reuses the same session/auth
   pattern as the HTML printable above. */
app.get("/api/admin/invoice-pdf", async c => {
  let user;
  try {
    user = await authenticateRequest(c.req.raw.headers);
  } catch {
    return c.json({ error: "Not signed in." }, 401);
  }
  if (!hasScope(user, "finance")) {
    return c.json({ error: "Forbidden." }, 403);
  }
  const rawId = c.req.query("id");
  const id = rawId ? Number(rawId) : NaN;
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid invoice id." }, 400);
  }
  try {
    const row = await getInvoiceById(id);
    const extra = await resolveMemberAndChapter(row.invoice.memberId);
    const pdf = await renderInvoicePdf(
      { ...row.invoice, payerName: row.payerName, payerEmail: row.payerEmail },
      extra
    );
    const number = encodeURIComponent(row.invoice.invoiceNumber);
    return c.body(Buffer.from(pdf), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="ehive-invoice-${number}.pdf"`,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return c.json({ error: "Invoice not found." }, 404);
    }
    logger.error("invoice-pdf render failed", { error: err });
    return c.json({ error: "Unable to render invoice PDF." }, 500);
  }
});

/* Downloadable credit-note PDF for finance admins. */
app.get("/api/admin/credit-note-pdf", async c => {
  let user;
  try {
    user = await authenticateRequest(c.req.raw.headers);
  } catch {
    return c.json({ error: "Not signed in." }, 401);
  }
  if (!hasScope(user, "finance")) {
    return c.json({ error: "Forbidden." }, 403);
  }
  const rawId = c.req.query("id");
  const id = rawId ? Number(rawId) : NaN;
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid credit note id." }, 400);
  }
  try {
    const row = await getCreditNoteById(id);
    const extra = await resolveMemberAndChapter(row.creditNote.memberId);
    const pdf = await renderCreditNotePdf(
      {
        ...row.creditNote,
        payerName: row.payerName,
        payerEmail: row.payerEmail,
      },
      extra
    );
    const number = encodeURIComponent(row.creditNote.creditNoteNumber);
    return c.body(Buffer.from(pdf), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="ehive-credit-note-${number}.pdf"`,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return c.json({ error: "Credit note not found." }, 404);
    }
    logger.error("credit-note-pdf render failed", { error: err });
    return c.json({ error: "Unable to render credit note PDF." }, 500);
  }
});

/* Liveness probe used by the platform's deploy healthcheck. Returns 200 as soon
 * as the server is accepting requests, so a deploy is never blocked by a
 * transient database blip — the pre-deploy `db:push` already validated the
 * schema/connection. Database reachability is reported for observability but
 * does not fail the probe (a DB outage shouldn't take the whole deploy down and
 * stop the marketing site from serving). */
app.get("/api/health", async c => {
  let db = "up";
  try {
    await getDb().execute(sql`select 1`);
  } catch (err) {
    db = "down";
    logger.error("health check: DB ping failed", { error: err });
  }
  const sched = getSchedulerStatus();
  const mail = await verifyMailTransport();
  return c.json({
    status: "ok",
    db,
    mail: {
      configured: mailEnabled(),
      provider: mailProvider(),
      ...mail,
    },
    scheduler: {
      lastRunAt: sched.lastRunAt,
      lastSuccessAt: sched.lastSuccessAt,
      lastFailureAt: sched.lastFailureAt,
      failures: sched.failures,
    },
    timestamp: new Date().toISOString(),
  });
});

/* Readiness probe (distinct from the liveness /api/health above): 200 only when
   the DB is reachable, so an orchestrator can pull an unhealthy replica out of
   rotation without killing the container. */
app.get("/api/ready", async c => {
  try {
    await getDb().execute(sql`select 1`);
    return c.json({ ready: true });
  } catch {
    return c.json({ ready: false }, 503);
  }
});

/* Prometheus-style metrics (text exposition, no external dependency). Enough for
   an ops dashboard: process uptime/memory, resident event-loop info, and a DB-up
   gauge. Guard with METRICS_TOKEN when set (Bearer) so it isn't world-readable. */
app.get("/metrics", async c => {
  const token = process.env.METRICS_TOKEN;
  if (token) {
    const auth = c.req.header("authorization") ?? "";
    if (auth !== `Bearer ${token}`) return c.text("unauthorized", 401);
  }
  let dbUp = 1;
  try {
    await getDb().execute(sql`select 1`);
  } catch {
    dbUp = 0;
  }
  const mem = process.memoryUsage();
  const sched = getSchedulerStatus();
  const ts = (d: string | null) => (d ? new Date(d).getTime() / 1000 : 0);
  const lines = [
    "# HELP ehive_up 1 if the process is serving.",
    "# TYPE ehive_up gauge",
    "ehive_up 1",
    "# HELP ehive_db_up 1 if the database is reachable.",
    "# TYPE ehive_db_up gauge",
    `ehive_db_up ${dbUp}`,
    "# HELP ehive_process_uptime_seconds Process uptime.",
    "# TYPE ehive_process_uptime_seconds gauge",
    `ehive_process_uptime_seconds ${Math.round(process.uptime())}`,
    "# HELP ehive_process_resident_memory_bytes Resident set size.",
    "# TYPE ehive_process_resident_memory_bytes gauge",
    `ehive_process_resident_memory_bytes ${mem.rss}`,
    "# HELP ehive_process_heap_used_bytes V8 heap in use.",
    "# TYPE ehive_process_heap_used_bytes gauge",
    `ehive_process_heap_used_bytes ${mem.heapUsed}`,
    "# HELP ehive_scheduler_last_run_seconds Unix timestamp of the last scheduler tick.",
    "# TYPE ehive_scheduler_last_run_seconds gauge",
    `ehive_scheduler_last_run_seconds ${ts(sched.lastRunAt)}`,
    "# HELP ehive_scheduler_last_success_seconds Unix timestamp of the last successful daily pass.",
    "# TYPE ehive_scheduler_last_success_seconds gauge",
    `ehive_scheduler_last_success_seconds ${ts(sched.lastSuccessAt)}`,
    "# HELP ehive_scheduler_last_failure_seconds Unix timestamp of the last scheduler failure.",
    "# TYPE ehive_scheduler_last_failure_seconds gauge",
    `ehive_scheduler_last_failure_seconds ${ts(sched.lastFailureAt)}`,
    "# HELP ehive_scheduler_failures_total Total scheduler job failures since boot.",
    "# TYPE ehive_scheduler_failures_total counter",
    `ehive_scheduler_failures_total ${sched.failures}`,
  ];
  return c.text(lines.join("\n") + "\n", 200, {
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
  });
});

app.all("/api/*", c => c.json({ error: "Not Found" }, 404));

/* SEO: robots + sitemap generated with the live host, so they're always correct
   whatever domain the app is served from. App routes are kept out of the index. */
const SITEMAP_PAGES = [
  "",
  "consulting.html",
  "consulting-clarity-sprint.html",
  "consulting-strategy-sprint.html",
  "consulting-gapnavigator.html",
  "consulting-brand-3d.html",
  "consulting-opsblueprint.html",
  "consulting-momentum90.html",
  "circle.html",
  "clarity-scorecard.html",
  "brand-check.html",
  "book.html",
  "about.html",
  "how-it-works.html",
  "membership.html",
  "partners.html",
  "franchise.html",
  "apply.html",
  "contact.html",
  "insights.html",
  "privacy.html",
  "terms.html",
  "code-of-conduct.html",
];
app.get("/robots.txt", c => {
  const base = env.publicUrl;
  return c.text(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "Disallow: /admin",
      "Disallow: /portal",
      "Disallow: /login",
      "Disallow: /logout",
      "Disallow: /forgot-password",
      "Disallow: /reset-password",
      "Disallow: /verify-email",
      `Sitemap: ${base}/sitemap.xml`,
      "",
    ].join("\n"),
    200,
    { "content-type": "text/plain; charset=utf-8" }
  );
});
app.get("/sitemap.xml", async c => {
  const base = env.publicUrl;
  const staticUrls = SITEMAP_PAGES.map(
    p =>
      `  <url><loc>${base}/${p}</loc><changefreq>weekly</changefreq></url>`
  );
  let articleUrls: string[] = [];
  try {
    const posts = await getDb()
      .select({
        slug: schema.insights.slug,
        updatedAt: schema.insights.updatedAt,
      })
      .from(schema.insights)
      .where(sql`${schema.insights.publishedAt} is not null`)
      .limit(500);
    articleUrls = posts.map(
      p =>
        `  <url><loc>${base}/insights/${p.slug}</loc><lastmod>${new Date(p.updatedAt).toISOString().slice(0, 10)}</lastmod><changefreq>monthly</changefreq></url>`
    );
  } catch {
    /* DB unavailable — static sitemap still valid */
  }
  const urls = [...staticUrls, ...articleUrls].join("\n");
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    200,
    { "content-type": "application/xml; charset=utf-8" }
  );
});

export default app;

if (env.isProduction) {
  // Seed the editorial article batch (idempotent by slug) so the blog publishes on deploy.
  try {
    const { seedInsights } = await import("./queries/seed-insights");
    const n = await seedInsights();
    if (n) logger.info(`[seed] published ${n} insight article(s)`);
  } catch (e) {
    logger.error("[seedInsights] skipped", { error: e });
  }

  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  const { serveStatic } = await import("@hono/node-server/serve-static");
  const fs = await import("fs");
  const path = await import("path");

  /* SPA client-side routes are rendered by the React app (portal.html).
     Registered before the static middlewares so deep links (and direct hits,
     e.g. an emailed /verify-email?token=… link) resolve to the SPA, not the
     marketing 404. Keep this list in step with the auth/portal routes in
     src/App.tsx. */
  const portalPath = path.resolve(
    import.meta.dirname,
    "../dist/public/portal.html"
  );
  let portalHtml: string | null = null;
  const readPortal = () => {
    if (!portalHtml) portalHtml = fs.readFileSync(portalPath, "utf-8");
    return portalHtml;
  };
  for (const p of [
    "/login",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/portal",
    "/portal/*",
    "/admin",
    "/admin/*",
  ]) {
    app.get(p, c => c.html(readPortal()));
  }

  /* Clean marketing slug → its static .html file (e.g. /thank-you). */
  const thankYouPath = path.resolve(
    import.meta.dirname,
    "../public/thank-you.html"
  );
  app.get("/thank-you", c => c.html(fs.readFileSync(thankYouPath, "utf-8")));

  /* Retired marketing pages — permanent redirects so old links/bookmarks/email
     CTAs send traffic to the current doors instead of 404s or stale content. */
  app.get("/business-setup.html", c =>
    c.redirect("/consulting.html", 301)
  );
  app.get("/business-setup", c => c.redirect("/consulting.html", 301));
  app.get("/get-started.html", c =>
    c.redirect("/clarity-scorecard.html", 301)
  );
  app.get("/get-started", c =>
    c.redirect("/clarity-scorecard.html", 301)
  );

  /* Marketing site: served straight from source (public/). No build-time copy —
     bulk copies race on this filesystem. Bundle assets (portal-*.js/css) fall
     through to serveStaticFiles (./dist/public) below. */
  app.use("*", serveStatic({ root: "./public" }));

  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  // Bind 0.0.0.0 so container platforms (Railway, Render, Fly) can route to it.
  const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
    logger.info(`Server running on http://0.0.0.0:${port}/`);
  });

  // Timed operations (M8): at-risk detection, renewal windows, … run in-process.
  let stopScheduler: (() => void) | undefined;
  try {
    const scheduler = await import("./lib/scheduler");
    scheduler.startScheduler();
    stopScheduler = scheduler.stopScheduler;
  } catch (e) {
    logger.error("[scheduler] failed to start", { error: e });
  }

  // Graceful shutdown: on a platform restart/deploy (SIGTERM) or Ctrl-C
  // (SIGINT), stop the scheduler, stop accepting connections and let in-flight
  // requests finish, then close the DB pool. A hard timeout guarantees exit if
  // draining stalls.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[shutdown] ${signal} received; draining…`);
    const hardExit = setTimeout(() => {
      logger.error("[shutdown] drain timed out; forcing exit");
      process.exit(1);
    }, 10_000);
    hardExit.unref();
    stopScheduler?.();
    server.close(async () => {
      try {
        const { closePool } = await import("./queries/connection");
        await closePool();
      } catch (e) {
        logger.error("[shutdown] error closing DB pool", { error: e });
      }
      clearTimeout(hardExit);
      logger.info("[shutdown] complete");
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
