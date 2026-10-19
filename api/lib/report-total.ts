/* Server-authoritative scoring for paid assessment reports. The client sends
   its per-dimension scores but the TOTAL is always recomputed here — a
   tampered or buggy client must never be able to store (or unlock a paid
   report claiming) a total it didn't earn. Pure functions so they're
   unit-testable without a database. */

export type ReportDimInput = {
  key?: unknown;
  label?: unknown;
  score?: unknown;
  raw?: unknown;
  max?: unknown;
  weight?: unknown;
};

export type NormalizedReportDim = {
  key: string;
  label: string | null;
  score: number;
  max: number;
  pct: number;
  weight: number;
};

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The default points scale per dimension when the client doesn't send one.
 *  Both public tools score questions on a 0–10 scale, matching the clarity
 *  scorecard's DomainScore {key, raw, pct}. */
export const REPORT_DIM_DEFAULT_MAX = 10;

/**
 * Validate + normalise the client-supplied dims array. Accepts either
 * `{score|raw, max?, weight?}` or the scorecard-style `{raw}` shape; clamps
 * scores into [0, max], clamps weights to positive, and derives pct per dim.
 * Returns null when the input isn't a usable non-empty array of objects with
 * at least one numeric score each.
 */
export function normalizeReportDims(
  input: unknown
): NormalizedReportDim[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: NormalizedReportDim[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const o = item as ReportDimInput;
    const score = finiteNumber(o.score) ?? finiteNumber(o.raw);
    if (score === null) return null;
    const max = finiteNumber(o.max) ?? REPORT_DIM_DEFAULT_MAX;
    if (max <= 0) return null;
    const weightRaw = finiteNumber(o.weight) ?? 1;
    const weight = weightRaw > 0 ? weightRaw : 1;
    const clamped = Math.min(Math.max(score, 0), max);
    out.push({
      key:
        typeof o.key === "string" && o.key.trim()
          ? o.key.trim().slice(0, 64)
          : `dim${out.length + 1}`,
      label:
        typeof o.label === "string" && o.label.trim()
          ? o.label.trim().slice(0, 128)
          : null,
      score: clamped,
      max,
      pct: Math.round((clamped / max) * 100),
      weight,
    });
  }
  return out;
}

/**
 * Weighted overall total (0–100) from normalised dims: each dim contributes
 * its pct weighted by `weight`; the result is the weighted mean, rounded and
 * clamped to [0, 100]. An empty dim list scores 0 — but the save endpoint
 * rejects empty dims before this is ever called.
 */
export function recomputeReportTotal(dims: NormalizedReportDim[]): number {
  const weightSum = dims.reduce((s, d) => s + d.weight, 0);
  if (weightSum <= 0 || dims.length === 0) return 0;
  const weighted = dims.reduce((s, d) => s + d.pct * d.weight, 0);
  return Math.min(100, Math.max(0, Math.round(weighted / weightSum)));
}
