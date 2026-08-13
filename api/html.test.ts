import { describe, it, expect } from "vitest";
import { escapeHtml } from "./lib/html";

describe("escapeHtml", () => {
  it("escapes tags so they can't execute when rendered", () => {
    expect(escapeHtml("<p>Hello <b>world</b></p>")).toBe(
      "&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;"
    );
  });
  it("neutralises a script payload", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });
  it("neutralises an event-handler injection", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
    );
  });
  it("escapes ampersands first so entities aren't double-broken", () => {
    expect(escapeHtml("Tom & Jerry <3")).toBe("Tom &amp; Jerry &lt;3");
  });
  it("handles null/empty", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml("")).toBe("");
  });
});
