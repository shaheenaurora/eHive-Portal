import { installLogScrubber } from "./lib/log";
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
import * as schema from "@db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { paymentsEnabled, getPaymentProvider } from "./lib/payments";
import { activateMembership } from "./queries/circle";
import { notifyLead } from "./lib/lead-mail";

const app = new Hono<{ Bindings: HttpBindings }>();

/* Baseline security headers on every response. CSP allows Google Fonts and a
   transitional 'unsafe-inline' for scripts/styles while the marketing site is
   migrated to nonced/hashed inline assets. Frame options are SAMEORIGIN so the
   scorecard popup (a same-origin iframe) keeps working. */
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
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
app.use("/api/trpc/*", async c => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

/* Marketing-site lead capture (replaces the old Formspree placeholder).
   Accepts the JSON payloads posted by public/app.js submitLead(). */
app.post("/api/lead", async c => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }
  if (!body || typeof body.form !== "string" || !body.form) {
    return c.json({ ok: false, error: "form field required" }, 400);
  }
  const email =
    typeof body.email === "string" ? body.email.slice(0, 320) : null;
  const sourcePage =
    typeof body.source_page === "string"
      ? body.source_page.slice(0, 255)
      : null;
  try {
    await getDb()
      .insert(schema.leads)
      .values({
        form: body.form.slice(0, 64),
        email,
        payload: JSON.stringify(body).slice(0, 60000),
        sourcePage,
      });
  } catch (err) {
    console.error("lead insert failed", err);
    return c.json({ ok: false, error: "storage failed" }, 500);
  }
  // Send notification + confirmation emails and surface the result to the
  // caller so the UI can warn when the confirmation could not be delivered.
  const emailResult = await notifyLead({
    form: body.form,
    email,
    payload: body,
    sourcePage,
  });
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
  return c.json({ post: row });
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
  });
  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — eHive</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article"><meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}"><meta property="og:url" content="${url}"><meta property="og:site_name" content="eHive">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${desc}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M16 3 27 9.5v13L16 29 5 22.5v-13z' fill='none' stroke='%23D4A24C' stroke-width='2'/%3E%3Ccircle cx='16' cy='16' r='3' fill='%23D4A24C'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.min.css"><link rel="stylesheet" href="/apps.min.css">
<script type="application/ld+json">${jsonLd}</script>
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
    <li><a href="/business-setup.html">Business Setup</a></li><li><a href="/consulting.html">Consulting</a></li>
    <li><a href="/circle.html">eHive Circle</a></li><li><a href="/insights.html">Insights</a></li>
    <li><a class="btn btn-primary btn-sm" href="/get-started.html">Get Started</a></li>
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
      <p style="margin:.4rem 0 0">The clearest next step is a short, honest look at what's actually holding your business up. <a href="/get-started.html">Start a conversation →</a></p>
    </div>
  </article>
  <a class="art-back" href="/insights.html">← All insights</a>
</div></section></main>
<script src="/app.min.js" defer></script><script src="/apps.min.js" defer></script>
</body></html>`;
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
    console.error("webhook verification failed", err);
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
        console.error(
          "webhook: no matching payment record for",
          result.providerRef
        );
        return c.json({ ok: false, error: "payment record not found" }, 400);
      }
      if (record.status === "paid")
        return c.json({ ok: true, duplicate: true });
      // The stored record is the authoritative source of user/tier/purpose.
      // Reject if the gateway metadata disagrees, so a tampered session can't
      // activate the wrong membership.
      if (result.userId != null && record.userId !== result.userId) {
        console.error(
          "webhook: userId mismatch",
          result.providerRef,
          record.userId,
          result.userId
        );
        return c.json({ ok: false, error: "user mismatch" }, 400);
      }
      if (result.tier != null && record.tier !== result.tier) {
        console.error(
          "webhook: tier mismatch",
          result.providerRef,
          record.tier,
          result.tier
        );
        return c.json({ ok: false, error: "tier mismatch" }, 400);
      }
      await db
        .update(schema.paymentRecords)
        .set({ status: "paid" })
        .where(eq(schema.paymentRecords.id, record.id));
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
    } else if (
      result.status === "failed" &&
      record &&
      record.status === "pending"
    ) {
      await db
        .update(schema.paymentRecords)
        .set({ status: "failed" })
        .where(eq(schema.paymentRecords.id, record.id));
    }
  } catch (err) {
    console.error("webhook handling failed", err);
    return c.json({ ok: false, error: "processing failed" }, 500);
  }
  return c.json({ ok: true });
});

/* Health/readiness probe: checks DB connectivity without touching business logic. */
app.get("/api/health", async c => {
  try {
    await getDb().select({ ok: sql<number>`1` });
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("health check failed", err);
    return c.json(
      { status: "error", timestamp: new Date().toISOString() },
      503
    );
  }
});

app.all("/api/*", c => c.json({ error: "Not Found" }, 404));

/* SEO: robots + sitemap generated with the live host, so they're always correct
   whatever domain the app is served from. App routes are kept out of the index. */
const SITEMAP_PAGES = [
  "",
  "business-setup.html",
  "consulting.html",
  "consulting-clarity-sprint.html",
  "consulting-strategy-sprint.html",
  "consulting-gapnavigator.html",
  "consulting-brand-3d.html",
  "consulting-opsblueprint.html",
  "consulting-momentum90.html",
  "circle.html",
  "clarity-scorecard.html",
  "get-started.html",
  "book.html",
  "about.html",
  "insights.html",
  "privacy.html",
  "terms.html",
];
app.get("/robots.txt", c => {
  const origin = new URL(c.req.url).origin;
  return c.text(
    [
      "User-agent: *",
      "Disallow: /portal",
      "Disallow: /admin",
      "Disallow: /login",
      "Disallow: /forgot-password",
      "Disallow: /reset-password",
      "Disallow: /verify-email",
      "Disallow: /api",
      "Allow: /",
      `Sitemap: ${origin}/sitemap.xml`,
      "",
    ].join("\n")
  );
});
app.get("/sitemap.xml", async c => {
  const origin = new URL(c.req.url).origin;
  const staticUrls = SITEMAP_PAGES.map(
    p => `  <url><loc>${origin}/${p}</loc><changefreq>weekly</changefreq></url>`
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
        `  <url><loc>${origin}/insights/${p.slug}</loc><lastmod>${new Date(p.updatedAt).toISOString().slice(0, 10)}</lastmod><changefreq>monthly</changefreq></url>`
    );
  } catch {
    /* DB unavailable — static sitemap still valid */
  }
  const urls = [...staticUrls, ...articleUrls].join("\n");
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    200,
    { "content-type": "application/xml" }
  );
});

export default app;

if (env.isProduction) {
  // Self-healing, additive schema reconciliation so a deploy that adds columns
  // works without a manual db:push. Never blocks boot if it fails.
  try {
    const { ensureSchema } = await import("./queries/ensure-schema");
    await ensureSchema();
  } catch (e) {
    console.error("[ensureSchema] skipped:", e);
  }

  // Seed the editorial article batch (idempotent by slug) so the blog publishes on deploy.
  try {
    const { seedInsights } = await import("./queries/seed-insights");
    const n = await seedInsights();
    if (n) console.log(`[seed] published ${n} insight article(s)`);
  } catch (e) {
    console.error("[seedInsights] skipped:", e);
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

  /* Marketing site: served straight from source (public/). No build-time copy —
     bulk copies race on this filesystem. Bundle assets (portal-*.js/css) fall
     through to serveStaticFiles (./dist/public) below. */
  app.use("*", serveStatic({ root: "./public" }));

  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  // Bind 0.0.0.0 so container platforms (Railway, Render, Fly) can route to it.
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });

  // Timed operations (M8): at-risk detection, renewal windows, … run in-process.
  try {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  } catch (e) {
    console.error("[scheduler] failed to start:", e);
  }
}
