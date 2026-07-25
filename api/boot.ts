import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
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

/* Baseline security headers on every response. CSP is intentionally omitted for
   now — the marketing pages use inline scripts and Google Fonts, so a strict
   policy needs a staged rollout; the headers below add real protection without
   risking breakage. Frame options are SAMEORIGIN so the scorecard popup (a
   same-origin iframe) keeps working. */
app.use("*", secureHeaders({
  strictTransportSecurity: "max-age=15552000; includeSubDomains",
  xFrameOptions: "SAMEORIGIN",
  xContentTypeOptions: "nosniff",
  referrerPolicy: "strict-origin-when-cross-origin",
  crossOriginResourcePolicy: "same-origin",
  crossOriginOpenerPolicy: "same-origin-allow-popups",
}));

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

/* Marketing-site lead capture (replaces the old Formspree placeholder).
   Accepts the JSON payloads posted by public/app.js submitLead(). */
app.post("/api/lead", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }
  if (!body || typeof body.form !== "string" || !body.form) {
    return c.json({ ok: false, error: "form field required" }, 400);
  }
  const email = typeof body.email === "string" ? body.email.slice(0, 320) : null;
  const sourcePage = typeof body.source_page === "string" ? body.source_page.slice(0, 255) : null;
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
  // Fire notification + confirmation emails without blocking the response.
  void notifyLead({ form: body.form, email, payload: body, sourcePage });
  return c.json({ ok: true });
});

/* Public content JSON for the marketing site (published insights + newsletter archive). */
app.get("/api/insights", async (c) => {
  const rows = await getDb()
    .select({
      slug: schema.insights.slug, title: schema.insights.title,
      excerpt: schema.insights.excerpt, tag: schema.insights.tag,
      publishedAt: schema.insights.publishedAt,
    })
    .from(schema.insights)
    .where(sql`${schema.insights.publishedAt} is not null`)
    .orderBy(desc(schema.insights.publishedAt))
    .limit(30);
  return c.json({ posts: rows });
});

app.get("/api/insights/:slug", async (c) => {
  const rows = await getDb()
    .select()
    .from(schema.insights)
    .where(eq(schema.insights.slug, c.req.param("slug")))
    .limit(1);
  const row = rows.at(0);
  if (!row || !row.publishedAt) return c.json({ error: "Not found" }, 404);
  return c.json({ post: row });
});

app.get("/api/newsletters", async (c) => {
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
app.post("/api/payments/webhook", async (c) => {
  if (!paymentsEnabled()) return c.json({ ok: false, error: "payments disabled" }, 404);
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
      if (record && record.status === "paid") return c.json({ ok: true, duplicate: true });
      if (record) {
        await db
          .update(schema.paymentRecords)
          .set({ status: "paid" })
          .where(eq(schema.paymentRecords.id, record.id));
      }
      const userId = result.userId ?? record?.userId;
      const tier = result.tier ?? record?.tier ?? undefined;
      if (userId && tier) {
        await activateMembership(userId, tier, "Membership activated via online payment");
      }
    } else if (result.status === "failed" && record && record.status === "pending") {
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

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

/* SEO: robots + sitemap generated with the live host, so they're always correct
   whatever domain the app is served from. App routes are kept out of the index. */
const SITEMAP_PAGES = [
  "", "business-setup.html", "consulting.html", "consulting-clarity-sprint.html",
  "consulting-strategy-sprint.html", "consulting-gapnavigator.html", "consulting-brand-3d.html",
  "consulting-opsblueprint.html", "consulting-momentum90.html", "circle.html",
  "clarity-scorecard.html", "get-started.html", "book.html", "about.html",
  "insights.html", "privacy.html", "terms.html",
];
app.get("/robots.txt", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.text(
    [
      "User-agent: *",
      "Disallow: /portal", "Disallow: /admin", "Disallow: /login",
      "Disallow: /forgot-password", "Disallow: /reset-password", "Disallow: /verify-email",
      "Disallow: /api", "Allow: /",
      `Sitemap: ${origin}/sitemap.xml`, "",
    ].join("\n"),
  );
});
app.get("/sitemap.xml", (c) => {
  const origin = new URL(c.req.url).origin;
  const urls = SITEMAP_PAGES.map(
    (p) => `  <url><loc>${origin}/${p}</loc><changefreq>weekly</changefreq></url>`,
  ).join("\n");
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    200,
    { "content-type": "application/xml" },
  );
});

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  const { serveStatic } = await import("@hono/node-server/serve-static");
  const fs = await import("fs");
  const path = await import("path");

  /* SPA client-side routes: /login, /portal/* and /admin/* are rendered by the
     React app (portal.html). Registered before the static middlewares so deep
     links (and direct hits to /login) resolve to the SPA, not marketing pages. */
  const portalPath = path.resolve(import.meta.dirname, "../dist/public/portal.html");
  let portalHtml: string | null = null;
  const readPortal = () => {
    if (!portalHtml) portalHtml = fs.readFileSync(portalPath, "utf-8");
    return portalHtml;
  };
  for (const p of ["/login", "/portal", "/portal/*", "/admin", "/admin/*"]) {
    app.get(p, (c) => c.html(readPortal()));
  }

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
}
