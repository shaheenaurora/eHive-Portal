import { describe, it, expect } from "vitest";
import {
  autoScore,
  DEFAULT_AUTOSCORE_RUBRIC,
  type AutoCandidate,
} from "./lib/awards-autoscore";

const cand = (
  memberId: number,
  raw: Record<string, number>,
  tenureAtMs = 0
): AutoCandidate => ({ memberId, tenureAtMs, raw });

describe("autoScore", () => {
  it("normalises each metric across the cohort and ranks by weighted total", () => {
    // engagement max=100 → 100 norm; referrals max=10 → 100; attendance max=8 →100
    const out = autoScore([
      cand(1, { engagement: 100, referrals: 8, attendance: 8 }),
      cand(2, { engagement: 50, referrals: 10, attendance: 4 }),
      cand(3, { engagement: 0, referrals: 0, attendance: 0 }),
    ]);
    expect(out[0].memberId).toBe(1); // strong across the board
    expect(out[out.length - 1].memberId).toBe(3); // nothing → last
    expect(out[0].rank).toBe(1);
    expect(out[0].total).toBeGreaterThan(out[1].total);
  });

  it("rewards the quiet high-contributor over a thin-but-loud profile", () => {
    // Spec worked example: quiet member with real contribution beats a big
    // network with thin contribution.
    const out = autoScore([
      cand(1, { engagement: 95, referrals: 6, attendance: 8 }), // quiet, high contribution
      cand(2, { engagement: 40, referrals: 10, attendance: 1 }), // loud network, thin
    ]);
    expect(out[0].memberId).toBe(1);
  });

  it("breaks ties by engagement, then earlier tenure, then id", () => {
    // Two identical totals; engagement decides, then tenure.
    const out = autoScore([
      cand(1, { engagement: 50, referrals: 5, attendance: 5 }, 2000),
      cand(2, { engagement: 50, referrals: 5, attendance: 5 }, 1000),
    ]);
    // identical raw → tie on total & engagement → earlier tenure (member 2) wins
    expect(out[0].memberId).toBe(2);
  });

  it("handles a flat metric (nobody varies) without letting it decide", () => {
    // everyone has engagement 10 (flat → all 100 on that metric); referrals decide
    const out = autoScore([
      cand(1, { engagement: 10, referrals: 2, attendance: 0 }),
      cand(2, { engagement: 10, referrals: 8, attendance: 0 }),
    ]);
    expect(out[0].memberId).toBe(2);
  });

  it("returns an empty list for no candidates", () => {
    expect(autoScore([])).toEqual([]);
  });

  it("uses a rubric whose weights sum to 100 by default", () => {
    expect(DEFAULT_AUTOSCORE_RUBRIC.reduce((a, c) => a + c.weight, 0)).toBe(
      100
    );
  });
});
