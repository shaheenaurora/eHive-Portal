/**
 * Pure (DB-free) award panel-scoring math — rubric parsing/validation, a single
 * judge's rubric-weighted total, and the panel average. Kept pure so the
 * judging engine is unit-tested in isolation (Awards spec Part 1 / Part 7).
 */

export type RubricCriterion = { key: string; label: string; weight: number };

/** Default panel rubric for qualitative, panel-judged awards (weights sum 100).
 *  A cycle can override this with its own rubric JSON. */
export const DEFAULT_PANEL_RUBRIC: RubricCriterion[] = [
  { key: "merit", label: "Merit & contribution", weight: 40 },
  { key: "impact", label: "Impact & outcomes", weight: 35 },
  { key: "evidence", label: "Strength of evidence", weight: 25 },
];

function isCriterion(c: unknown): c is RubricCriterion {
  return (
    !!c &&
    typeof c === "object" &&
    typeof (c as RubricCriterion).key === "string" &&
    typeof (c as RubricCriterion).label === "string" &&
    typeof (c as RubricCriterion).weight === "number"
  );
}

/** Parse a stored rubric JSON, falling back to the default when absent/invalid. */
export function parseRubric(
  json: string | null | undefined
): RubricCriterion[] {
  if (!json) return DEFAULT_PANEL_RUBRIC;
  try {
    const r = JSON.parse(json);
    if (
      Array.isArray(r) &&
      r.length > 0 &&
      r.every(isCriterion) &&
      validateRubric(r).ok
    )
      return r as RubricCriterion[];
  } catch {
    /* fall through */
  }
  return DEFAULT_PANEL_RUBRIC;
}

export interface RubricValidation {
  ok: boolean;
  error?: string;
}

/** Validate a rubric: non-empty, unique non-blank keys, non-negative weights
 *  that sum to 100. */
export function validateRubric(rubric: RubricCriterion[]): RubricValidation {
  if (!Array.isArray(rubric) || rubric.length === 0)
    return { ok: false, error: "A rubric needs at least one criterion." };
  const keys = new Set<string>();
  let sum = 0;
  for (const c of rubric) {
    if (!c.key || !c.key.trim())
      return { ok: false, error: "Every criterion needs a key." };
    if (keys.has(c.key))
      return { ok: false, error: `Duplicate criterion key: ${c.key}.` };
    keys.add(c.key);
    if (
      typeof c.weight !== "number" ||
      !Number.isFinite(c.weight) ||
      c.weight < 0
    )
      return { ok: false, error: `Invalid weight for ${c.key}.` };
    sum += c.weight;
  }
  if (Math.round(sum) !== 100)
    return { ok: false, error: "Rubric weights must sum to 100." };
  return { ok: true };
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** One judge's rubric-weighted total (0–100). Missing criteria score 0; each
 *  criterion value is clamped to 0–100. Weights need not pre-sum to 100 — the
 *  result is normalised by the total weight. */
export function weightedTotal(
  scores: { key: string; value: number }[],
  rubric: RubricCriterion[]
): number {
  const map = new Map(scores.map(s => [s.key, clamp(Number(s.value) || 0)]));
  let weighted = 0;
  let weightSum = 0;
  for (const c of rubric) {
    weighted += (map.get(c.key) ?? 0) * c.weight;
    weightSum += c.weight;
  }
  return weightSum > 0 ? Math.round(weighted / weightSum) : 0;
}

/** The panel average of judge totals (0–100), rounded. Empty → 0. */
export function averageScore(totals: number[]): number {
  if (totals.length === 0) return 0;
  return Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
}

/** Fairness cap (Awards spec §8.2): true when a member already won the same
 *  award within `windowDays` before `nowMs`, so an auto award can't go to the
 *  same person back-to-back. `priorConferredAtMs` is the most recent prior win
 *  for that (award, member), or null when there is none. */
export function isBackToBack(
  priorConferredAtMs: number | null,
  nowMs: number,
  windowDays: number
): boolean {
  if (priorConferredAtMs == null) return false;
  return nowMs - priorConferredAtMs < windowDays * 24 * 60 * 60 * 1000;
}
