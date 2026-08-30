import { describe, it, expect } from "vitest";
import app from "./boot";

describe("public site + ops routes", () => {
  it("/api/health returns the expected shape", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      db: string;
      mail: { configured: boolean; ok: boolean; provider: string | null };
      scheduler: { lastRunAt: string | null };
    };
    expect(body.status).toBe("ok");
    expect(["up", "down"]).toContain(body.db);
    expect(body.mail).toMatchObject({
      configured: expect.any(Boolean),
      ok: expect.any(Boolean),
    });
    expect(body.mail.provider === null || typeof body.mail.provider === "string").toBe(true);
    expect(body.scheduler).toHaveProperty("lastRunAt");
  });

  it("/api/ready returns a readiness object", async () => {
    const res = await app.request("/api/ready");
    expect([200, 503]).toContain(res.status);
    const body = (await res.json()) as { ready: boolean };
    expect(typeof body.ready).toBe("boolean");
  });

  it("/robots.txt serves crawl guidance", async () => {
    const res = await app.request("/robots.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("User-agent: *");
    expect(text).toContain("Sitemap:");
    expect(text).toContain("Disallow: /api/");
  });

  it("/sitemap.xml serves the public page list", async () => {
    const res = await app.request("/sitemap.xml");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(text).toContain("<urlset");
    expect(text).toContain("<loc>");
    expect(text).toContain("consulting.html");
    expect(text).toContain("clarity-scorecard.html");
  });
});
