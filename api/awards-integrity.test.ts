import { describe, it, expect } from "vitest";
import {
  detectVoteVelocity,
  isReciprocitySuspicious,
  RECIPROCITY_THRESHOLD,
} from "./lib/awards-integrity";

describe("detectVoteVelocity", () => {
  const min = 60 * 1000;

  it("flags a burst of votes for one nominee inside the window", () => {
    // 5 votes for nominee 1 within 40s, plus one straggler.
    const votes = [
      { nominationId: 1, atMs: 0 },
      { nominationId: 1, atMs: 10_000 },
      { nominationId: 1, atMs: 20_000 },
      { nominationId: 1, atMs: 30_000 },
      { nominationId: 1, atMs: 40_000 },
    ];
    const hits = detectVoteVelocity(votes, {
      windowMs: 2 * min,
      burstThreshold: 5,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].nominationId).toBe(1);
    expect(hits[0].burst).toBe(5);
  });

  it("does not flag votes spread out beyond the window", () => {
    const votes = [
      { nominationId: 1, atMs: 0 },
      { nominationId: 1, atMs: 5 * min },
      { nominationId: 1, atMs: 10 * min },
      { nominationId: 1, atMs: 15 * min },
      { nominationId: 1, atMs: 20 * min },
    ];
    const hits = detectVoteVelocity(votes, {
      windowMs: 2 * min,
      burstThreshold: 5,
    });
    expect(hits).toHaveLength(0);
  });

  it("counts each nominee independently", () => {
    const votes = [
      ...Array.from({ length: 6 }, (_, i) => ({
        nominationId: 1,
        atMs: i * 5_000,
      })),
      { nominationId: 2, atMs: 0 },
      { nominationId: 2, atMs: 3 * min },
    ];
    const hits = detectVoteVelocity(votes, {
      windowMs: 2 * min,
      burstThreshold: 5,
    });
    expect(hits.map(h => h.nominationId)).toEqual([1]);
    expect(hits[0].burst).toBe(6);
  });

  it("uses a sliding window (not fixed buckets)", () => {
    // Votes at 90s intervals: any 2-minute window holds at most 2.
    const votes = Array.from({ length: 5 }, (_, i) => ({
      nominationId: 1,
      atMs: i * 90_000,
    }));
    const hits = detectVoteVelocity(votes, {
      windowMs: 2 * min,
      burstThreshold: 3,
    });
    expect(hits).toHaveLength(0);
  });
});

describe("isReciprocitySuspicious", () => {
  it("flags at or above the threshold", () => {
    expect(isReciprocitySuspicious(RECIPROCITY_THRESHOLD)).toBe(true);
    expect(isReciprocitySuspicious(RECIPROCITY_THRESHOLD + 3)).toBe(true);
  });
  it("does not flag below the threshold", () => {
    expect(isReciprocitySuspicious(RECIPROCITY_THRESHOLD - 1)).toBe(false);
    expect(isReciprocitySuspicious(0)).toBe(false);
  });
});
