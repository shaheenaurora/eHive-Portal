/**
 * Hall of Fame auto-qualification (Awards spec Part 6, Table 18). A member's
 * MULTI-YEAR record is scored against a weighted rubric; crossing the bar makes
 * them a candidate that a panel then ratifies. This deliberately rewards
 * sustained excellence over a single lucky year — the criteria all look back
 * across the member's tenure, never at one cycle.
 *
 * Pure and deterministic so it can be unit-tested without a database.
 */
import {
  HALL_OF_FAME_MIN_CHAMPION_YEARS,
  HALL_OF_FAME_MIN_ANNUAL_AWARDS,
  HALL_OF_FAME_CONTRIBUTION_TARGET,
} from "@contracts/constants";

export type HallOfFameCriterion = {
  key: "sustained" | "recognition" | "contribution" | "standing";
  label: string;
  weight: number; // percent; the four sum to 100
};

/** The published rubric (Table 18). Weights sum to 100. */
export const HALL_OF_FAME_RUBRIC: HallOfFameCriterion[] = [
  { key: "sustained", label: "Sustained engagement", weight: 40 },
  { key: "recognition", label: "Repeat recognition", weight: 30 },
  { key: "contribution", label: "Contribution depth", weight: 20 },
  { key: "standing", label: "Standing", weight: 10 },
];

export type HallOfFameInput = {
  memberId: number;
  /** Number of years in which the member reached champion-band Hive Score. */
  championYears: number;
  /** Annual awards conferred on the member across their tenure. */
  annualAwards: number;
  /** Converted referrals across tenure (qualified, real outcomes only). */
  convertedReferrals: number;
  /** Confirmed mentoring sessions across tenure. */
  mentoringSessions: number;
  /** Upheld (actioned) conduct matters ever recorded against the member. */
  upheldConductCount: number;
};

export type HallOfFameScore = {
  memberId: number;
  /** Per-criterion 0–100 sub-scores, keyed by rubric criterion. */
  sub: Record<HallOfFameCriterion["key"], number>;
  /** Rubric-weighted total, 0–100. */
  total: number;
  /** True when the member crosses every hard bar and may be inducted. */
  qualified: boolean;
  /** Human-readable reasons the member is not yet qualified (empty if they are). */
  gaps: string[];
};

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Score one member's multi-year record against the Hall of Fame rubric. */
export function scoreHallOfFame(input: HallOfFameInput): HallOfFameScore {
  const sustained = clampPct(
    (input.championYears / HALL_OF_FAME_MIN_CHAMPION_YEARS) * 100
  );
  const recognition = clampPct(
    (input.annualAwards / HALL_OF_FAME_MIN_ANNUAL_AWARDS) * 100
  );
  const contribution = clampPct(
    ((input.convertedReferrals + input.mentoringSessions) /
      HALL_OF_FAME_CONTRIBUTION_TARGET) *
      100
  );
  const standing = input.upheldConductCount > 0 ? 0 : 100;
  const sub = { sustained, recognition, contribution, standing };

  const total = clampPct(
    HALL_OF_FAME_RUBRIC.reduce((acc, c) => acc + sub[c.key] * c.weight, 0) / 100
  );

  const gaps: string[] = [];
  if (input.championYears < HALL_OF_FAME_MIN_CHAMPION_YEARS)
    gaps.push(
      `Champion-band in ${input.championYears}/${HALL_OF_FAME_MIN_CHAMPION_YEARS} required years`
    );
  if (input.annualAwards < HALL_OF_FAME_MIN_ANNUAL_AWARDS)
    gaps.push(
      `${input.annualAwards}/${HALL_OF_FAME_MIN_ANNUAL_AWARDS} annual awards won`
    );
  if (input.upheldConductCount > 0)
    gaps.push("An upheld conduct matter is on record");

  return {
    memberId: input.memberId,
    sub,
    total,
    qualified: gaps.length === 0,
    gaps,
  };
}
