/** Pure (DB-free) KPI helpers for the reporting layer — RAG status against a
 *  target, per the KPI & Reporting Framework (Part 9: every report opens with
 *  KPIs-vs-target and a red/amber/green so the exception reads in five seconds). */

export type Rag = "green" | "amber" | "red" | "none";
export type KpiFamily = "community" | "commercial";
export type Kpi = {
  key: string;
  label: string;
  value: number | null;
  display: string;
  target: string;
  status: Rag;
  family: KpiFamily;
};

/** RAG for a "higher is better" KPI (green at/over target, amber within band). */
export function ragAtLeast(
  value: number | null,
  target: number,
  amberBand = 0.9
): Rag {
  if (value == null) return "none";
  if (value >= target) return "green";
  if (value >= target * amberBand) return "amber";
  return "red";
}

/** RAG for a "lower is better" KPI (green at/under target). */
export function ragAtMost(
  value: number | null,
  target: number,
  amberBand = 1.1
): Rag {
  if (value == null) return "none";
  if (value <= target) return "green";
  if (value <= target * amberBand) return "amber";
  return "red";
}

/** Health-index band → RAG (Thriving/Healthy green, Watch amber, At-risk red). */
export function ragHealth(chi: number | null): Rag {
  if (chi == null) return "none";
  if (chi >= 65) return "green";
  if (chi >= 50) return "amber";
  return "red";
}

/** Percentage helper that never divides by zero. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
