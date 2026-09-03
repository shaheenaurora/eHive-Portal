import { describe, it, expect } from "vitest";
import { resolveMotionOutcome } from "@contracts/constants";

describe("motion quorum (G5)", () => {
  const q = (
    yes: number,
    no: number,
    abstain: number,
    eligible: number,
    quorumPct = 50
  ) => resolveMotionOutcome({ yes, no, abstain, eligible, quorumPct });

  it("fails a motion that hasn't met quorum, even with a yes majority", () => {
    // 1 yes out of 10 eligible = 10% turnout, below 50%
    const r = q(1, 0, 0, 10);
    expect(r.quorumMet).toBe(false);
    expect(r.status).toBe("failed");
  });

  it("passes on a majority once quorum is met", () => {
    // 6 of 10 voted (quorum), yes outweighs no
    const r = q(4, 2, 0, 10);
    expect(r.quorumMet).toBe(true);
    expect(r.status).toBe("passed");
  });

  it("rejects on a majority-no once quorum is met", () => {
    const r = q(2, 4, 0, 10);
    expect(r.quorumMet).toBe(true);
    expect(r.status).toBe("rejected");
  });

  it("counts abstentions toward turnout for quorum", () => {
    // 3 yes + 2 abstain = 5/10 = exactly 50% → quorum met
    const r = q(3, 0, 2, 10);
    expect(r.turnout).toBe(5);
    expect(r.quorumMet).toBe(true);
    expect(r.status).toBe("passed");
  });

  it("a tie at quorum is not a pass", () => {
    const r = q(3, 3, 0, 10);
    expect(r.quorumMet).toBe(true);
    expect(r.status).toBe("rejected");
  });

  it("treats a chapter with no eligible members as failed, never divide-by-zero", () => {
    const r = q(0, 0, 0, 0);
    expect(r.quorumMet).toBe(false);
    expect(r.status).toBe("failed");
  });
});
