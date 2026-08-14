import { describe, it, expect } from "vitest";
import {
  scoreHallOfFame,
  HALL_OF_FAME_RUBRIC,
  type HallOfFameInput,
} from "./lib/awards-halloffame";

const base: HallOfFameInput = {
  memberId: 1,
  championYears: 0,
  annualAwards: 0,
  convertedReferrals: 0,
  mentoringSessions: 0,
  upheldConductCount: 0,
};

describe("HALL_OF_FAME_RUBRIC", () => {
  it("weights sum to 100", () => {
    expect(HALL_OF_FAME_RUBRIC.reduce((s, c) => s + c.weight, 0)).toBe(100);
  });
});

describe("scoreHallOfFame", () => {
  it("a spotless multi-year record qualifies with a top score", () => {
    const r = scoreHallOfFame({
      ...base,
      championYears: 4,
      annualAwards: 5,
      convertedReferrals: 15,
      mentoringSessions: 10,
      upheldConductCount: 0,
    });
    expect(r.qualified).toBe(true);
    expect(r.gaps).toEqual([]);
    expect(r.total).toBe(100);
    expect(r.sub.standing).toBe(100);
  });

  it("hits the champion-year and award bars exactly at the threshold", () => {
    const r = scoreHallOfFame({
      ...base,
      championYears: 3,
      annualAwards: 3,
      convertedReferrals: 20,
      mentoringSessions: 0,
    });
    expect(r.qualified).toBe(true);
    expect(r.sub.sustained).toBe(100);
    expect(r.sub.recognition).toBe(100);
    expect(r.sub.contribution).toBe(100);
  });

  it("fails to qualify with too few champion years", () => {
    const r = scoreHallOfFame({
      ...base,
      championYears: 2,
      annualAwards: 3,
    });
    expect(r.qualified).toBe(false);
    expect(r.gaps.join(" ")).toMatch(/Champion-band in 2\/3/);
    // Partial credit still shown on the sub-score.
    expect(r.sub.sustained).toBe(67);
  });

  it("fails to qualify with too few annual awards", () => {
    const r = scoreHallOfFame({ ...base, championYears: 4, annualAwards: 1 });
    expect(r.qualified).toBe(false);
    expect(r.gaps.join(" ")).toMatch(/1\/3 annual awards/);
  });

  it("an upheld conduct matter zeroes standing and blocks qualification", () => {
    const r = scoreHallOfFame({
      ...base,
      championYears: 4,
      annualAwards: 5,
      convertedReferrals: 20,
      upheldConductCount: 1,
    });
    expect(r.sub.standing).toBe(0);
    expect(r.qualified).toBe(false);
    expect(r.gaps.join(" ")).toMatch(/upheld conduct/i);
  });

  it("caps every sub-score at 100 even with extreme inputs", () => {
    const r = scoreHallOfFame({
      ...base,
      championYears: 40,
      annualAwards: 50,
      convertedReferrals: 500,
      mentoringSessions: 500,
    });
    expect(r.total).toBe(100);
    for (const c of HALL_OF_FAME_RUBRIC) expect(r.sub[c.key]).toBe(100);
  });
});
