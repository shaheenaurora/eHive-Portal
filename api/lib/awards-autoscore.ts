/**
 * Pure auto-scoring engine (Awards spec Part 1 — the default judging mechanism).
 * Given each eligible candidate's RAW metric values and a weighted rubric, it
 * min-max normalises every metric across the cohort to 0–100, computes each
 * candidate's weighted total, and ranks them. "The data decides" — no nomination,
 * no campaign. Kept pure so it is fully unit-tested.
 */

export type AutoRubricCriterion = {
  key: string;
  label: string;
  weight: number;
};

/** Default auto-score rubric. Engagement is the Hive-Score velocity in the
 *  window; the others are counted contributions. Weights sum to 100 and can be
 *  overridden per cycle. (The spec's Member-of-the-Month rubric further splits a
 *  contribution criterion; that needs a factor mapping and is layered later.) */
export const DEFAULT_AUTOSCORE_RUBRIC: AutoRubricCriterion[] = [
  { key: "engagement", label: "Engagement (Hive Score in window)", weight: 40 },
  { key: "referrals", label: "Qualified referrals", weight: 30 },
  { key: "attendance", label: "Attendance & consistency", weight: 30 },
];

export interface AutoCandidate {
  memberId: number;
  /** Lower = longer tenure (used as the final tie-break). Epoch ms. */
  tenureAtMs: number;
  /** Raw metric values keyed by rubric criterion key. */
  raw: Record<string, number>;
}

export interface AutoScored {
  memberId: number;
  total: number; // 0–100 weighted, rounded
  raw: Record<string, number>;
  normalized: Record<string, number>; // 0–100 per criterion
  rank: number; // 1-based
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Rank candidates by rubric-weighted, cohort-normalised score. Each metric is
 * min-max normalised across the cohort: the cohort max → 100, the min → 0. When
 * a metric is flat across everyone, a positive value scores 100 and zero scores
 * 0 (so a metric nobody varies on doesn't decide the result, but real activity
 * still counts). Ties break by raw `engagement` (if present), then earlier
 * tenure, then lower memberId — mirroring the spec's Hive-Score-then-tenure rule.
 */
export function autoScore(
  candidates: AutoCandidate[],
  rubric: AutoRubricCriterion[] = DEFAULT_AUTOSCORE_RUBRIC
): AutoScored[] {
  if (candidates.length === 0) return [];
  const weightSum = rubric.reduce((a, c) => a + c.weight, 0) || 1;

  // Per-metric min/max across the cohort.
  const bounds = new Map<string, { min: number; max: number }>();
  for (const c of rubric) {
    let min = Infinity;
    let max = -Infinity;
    for (const cand of candidates) {
      const v = cand.raw[c.key] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    bounds.set(c.key, { min, max });
  }

  const scored = candidates.map(cand => {
    const normalized: Record<string, number> = {};
    let weighted = 0;
    for (const c of rubric) {
      const v = cand.raw[c.key] ?? 0;
      const b = bounds.get(c.key)!;
      let norm: number;
      if (b.max > b.min) norm = ((v - b.min) / (b.max - b.min)) * 100;
      else norm = v > 0 ? 100 : 0; // flat metric
      norm = clamp(norm);
      normalized[c.key] = Math.round(norm);
      weighted += norm * c.weight;
    }
    return {
      memberId: cand.memberId,
      total: Math.round(weighted / weightSum),
      raw: cand.raw,
      normalized,
      tenureAtMs: cand.tenureAtMs,
      rank: 0,
    };
  });

  scored.sort(
    (a, b) =>
      b.total - a.total ||
      (b.raw.engagement ?? 0) - (a.raw.engagement ?? 0) ||
      a.tenureAtMs - b.tenureAtMs ||
      a.memberId - b.memberId
  );
  return scored.map((s, i) => ({
    memberId: s.memberId,
    total: s.total,
    raw: s.raw,
    normalized: s.normalized,
    rank: i + 1,
  }));
}
