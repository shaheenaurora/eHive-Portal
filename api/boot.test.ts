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
      payments: {
        enabled: boolean;
        mode: "live" | "test" | null;
        webhookSecretSet: boolean;
      };
      scheduler: { lastRunAt: string | null };
    };
    expect(body.status).toBe("ok");
    expect(["up", "down"]).toContain(body.db);
    expect(body.mail).toMatchObject({
      configured: expect.any(Boolean),
      ok: expect.any(Boolean),
    });
    expect(
      body.mail.provider === null || typeof body.mail.provider === "string"
    ).toBe(true);
    expect(body.payments).toMatchObject({
      enabled: expect.any(Boolean),
      webhookSecretSet: expect.any(Boolean),
    });
    expect(["live", "test", null]).toContain(body.payments.mode);
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

  it("/api/public-stats returns non-sensitive counts", async () => {
    const res = await app.request("/api/public-stats");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      chapters: expect.any(Number),
      members: expect.any(Number),
      countries: expect.any(Number),
    });
  });

  it("/api/bookings/manage rejects missing or invalid tokens", async () => {
    const missing = await app.request("/api/bookings/manage");
    expect(missing.status).toBe(401);
    const bad = await app.request(
      "/api/bookings/manage?a=1&t=bogus.token.here"
    );
    expect(bad.status).toBe(401);
    const badBody = (await bad.json()) as { ok: boolean };
    expect(badBody.ok).toBe(false);
  });

  it("/api/bookings/manage POST rejects invalid tokens without touching state", async () => {
    const res = await app.request("/api/bookings/manage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1, t: "bogus.token.here", action: "cancel" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("paid report routes", () => {
  it("/api/report/config returns pricing, payments flag and tool labels", async () => {
    const res = await app.request("/api/report/config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      priceAed: number;
      priceFils: number;
      paymentsEnabled: boolean;
      launchOffer: boolean;
      tools: Record<string, { label: string }>;
    };
    expect(body.priceAed).toBe(99);
    expect(body.priceFils).toBe(9900);
    expect(typeof body.paymentsEnabled).toBe("boolean");
    /* launch offer defaults ON (REPORT_LAUNCH_OFFER unset) — while it runs
     * the full report is free for everyone and charging is impossible */
    expect(body.launchOffer).toBe(true);
    expect(body.tools["brand-check"].label).toBe("Brand Check");
    expect(body.tools["clarity-scorecard"].label).toBe("Clarity Scorecard");
  });

  it("/api/report/checkout and /request-invoice are closed during the launch offer", async () => {
    for (const path of ["/api/report/checkout", "/api/report/request-invoice"]) {
      const res = await app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: "brand-check", token: "1.2.abc" }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toBe("launch_offer");
    }
  });

  it("/api/report/save validates input before touching storage", async () => {
    const post = (b: unknown) =>
      app.request("/api/report/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(b),
      });
    const cases = [
      { tool: "mystery", email: "a@b.co", answers: {}, dims: [{ score: 1 }] },
      { tool: "brand-check", email: "nope", answers: {}, dims: [{ score: 1 }] },
      { tool: "brand-check", email: "a@b.co", answers: {}, dims: [] },
      { tool: "brand-check", email: "a@b.co", answers: {}, dims: "x" },
      { tool: "brand-check", email: "a@b.co", dims: [{ score: 5 }] },
      {
        tool: "brand-check",
        email: "a@b.co",
        answers: "x",
        dims: [{ score: 5 }],
      },
    ];
    for (const body of cases) {
      const res = await post(body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { ok: boolean };
      expect(json.ok).toBe(false);
    }
  });

  it("/api/report/save quietly drops honeypot submissions without a token", async () => {
    const res = await app.request("/api/report/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tool: "brand-check",
        email: "a@b.co",
        answers: {},
        dims: [{ score: 5 }],
        company_website: "https://spam.example",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; token?: string };
    expect(body.ok).toBe(true);
    expect(body.token).toBeUndefined();
  });

  it("/api/report/:tool/:token rejects bad tokens and unknown tools pre-storage", async () => {
    const malformed = await app.request("/api/report/brand-check/not-a-token");
    expect(malformed.status).toBe(403);
    const unknownTool = await app.request("/api/report/mystery/1.2.abc");
    expect(unknownTool.status).toBe(404);
  });

  it("/api/report/compose validates input and rejects bad tokens pre-storage", async () => {
    const post = (b: unknown) =>
      app.request("/api/report/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(b),
      });
    const invalidJson = await app.request("/api/report/compose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(invalidJson.status).toBe(400);

    const unknownTool = await post({ tool: "mystery", token: "1.2.abc" });
    expect(unknownTool.status).toBe(404);
    const body404 = (await unknownTool.json()) as { ok: boolean };
    expect(body404.ok).toBe(false);

    const malformedToken = await post({
      tool: "brand-check",
      token: "not-a-token",
    });
    expect(malformedToken.status).toBe(403);
    const body403 = (await malformedToken.json()) as { ok: boolean };
    expect(body403.ok).toBe(false);
  });
});
