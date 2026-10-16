import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

/** Cache-Control policy for statically served files, keyed off the request
    path. Hashed build artifacts (/assets/*) and fonts (/fonts/*, *.woff2) are
    content-addressed, so they can be cached immutably for a year. HTML shells
    (portal.html, marketing pages, the SSR'd 404) and the PWA bootstrap files
    (sw.js, manifest.webmanifest) must revalidate on every load — a stale
    no-cache header here is what lets service-worker updates roll out. Returns
    undefined for anything else, leaving the header unset (status quo). */
export function staticCacheControl(requestPath: string): string | undefined {
  const p = requestPath.toLowerCase();
  if (
    p.endsWith(".woff2") ||
    p.startsWith("/assets/") ||
    p.startsWith("/fonts/")
  ) {
    return "public, max-age=31536000, immutable";
  }
  if (p.endsWith(".html") || p === "/sw.js" || p.endsWith(".webmanifest")) {
    return "no-cache";
  }
  return undefined;
}

export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");

  app.use(
    "*",
    serveStatic({
      root: "./dist/public",
      onFound: (_path, c) => {
        const policy = staticCacheControl(c.req.path);
        if (policy) c.header("Cache-Control", policy);
      },
    })
  );

  app.notFound(c => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    const content = fs.readFileSync(indexPath, "utf-8");
    c.header("Cache-Control", "no-cache");
    return c.html(content);
  });
}
