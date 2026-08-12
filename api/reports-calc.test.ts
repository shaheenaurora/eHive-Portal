import { describe, it, expect } from "vitest";
import { ragAtLeast, ragAtMost, ragHealth, pct } from "./lib/reports-calc";

describe("KPI RAG status", () => {
  it("higher-is-better: green at/over target, amber within band, red below", () => {
    expect(ragAtLeast(85, 85)).toBe("green");
    expect(ragAtLeast(90, 85)).toBe("green");
    expect(ragAtLeast(80, 85)).toBe("amber"); // 80 ≥ 85*0.9 (76.5)
    expect(ragAtLeast(70, 85)).toBe("red");
    expect(ragAtLeast(null, 85)).toBe("none");
  });

  it("lower-is-better: green at/under target", () => {
    expect(ragAtMost(4, 5)).toBe("green");
    expect(ragAtMost(5, 5)).toBe("green");
    expect(ragAtMost(5.4, 5)).toBe("amber"); // ≤ 5*1.1
    expect(ragAtMost(7, 5)).toBe("red");
  });

  it("health bands: ≥65 green, 50–64 amber, <50 red", () => {
    expect(ragHealth(80)).toBe("green");
    expect(ragHealth(65)).toBe("green");
    expect(ragHealth(58)).toBe("amber");
    expect(ragHealth(40)).toBe("red");
    expect(ragHealth(null)).toBe("none");
  });

  it("pct never divides by zero", () => {
    expect(pct(3, 4)).toBe(75);
    expect(pct(0, 0)).toBe(0);
    expect(pct(1, 3)).toBe(33);
  });
});
