import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";
import { getDb } from "./queries/connection";
import * as schema from "@db/schema";
import { eq, desc, sql } from "drizzle-orm";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.get(Paths.oauthCallback, createOAuthCallbackHandler());
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
  try {
    await getDb()
      .insert(schema.leads)
      .values({
        form: body.form.slice(0, 64),
        email: typeof body.email === "string" ? body.email.slice(0, 320) : null,
        payload: JSON.stringify(body).slice(0, 60000),
        sourcePage:
          typeof body.source_page === "string" ? body.source_page.slice(0, 255) : null,
      });
    return c.json({ ok: true });
  } catch (err) {
    console.error("lead insert failed", err);
    return c.json({ ok: false, error: "storage failed" }, 500);
  }
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

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  const { serveStatic } = await import("@hono/node-server/serve-static");
  const fs = await import("fs");
  const path = await import("path");

  /* SPA client-side routes: /portal/* and /admin/* are rendered by the React
     app (portal.html). Registered before the static middlewares so deep links
     resolve to the SPA instead of the marketing pages. */
  const portalPath = path.resolve(import.meta.dirname, "../dist/public/portal.html");
  let portalHtml: string | null = null;
  const readPortal = () => {
    if (!portalHtml) portalHtml = fs.readFileSync(portalPath, "utf-8");
    return portalHtml;
  };
  for (const p of ["/portal", "/portal/*", "/admin", "/admin/*"]) {
    app.get(p, (c) => c.html(readPortal()));
  }

  /* Marketing site: served straight from source (public/). No build-time copy —
     bulk copies race on this filesystem. Bundle assets (portal-*.js/css) fall
     through to serveStaticFiles (./dist/public) below. */
  app.use("*", serveStatic({ root: "./public" }));

  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
