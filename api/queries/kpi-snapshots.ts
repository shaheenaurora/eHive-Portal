import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { networkKpis } from "./reports";

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

/** Capture today's KPI snapshot: every network metric + each chapter's CHI.
 *  Idempotent per day — re-running overwrites the day's rows. Called by the
 *  daily scheduler and available as a manual action. */
export async function captureKpiSnapshots(now = new Date()): Promise<{ captured: number }> {
  const db = getDb();
  const on = dayKey(now);

  const { kpis } = await networkKpis();
  const rows: (typeof schema.kpiSnapshots.$inferInsert)[] = [];
  for (const k of kpis) {
    if (k.value == null || !Number.isFinite(k.value)) continue;
    rows.push({ scope: "network", scopeId: null, metric: k.key, value: Math.round(k.value), capturedOn: on });
  }

  // Latest CHI per chapter → chapter-scoped snapshots (powers per-chapter trends/alerts).
  const snaps = await db.select({ chapterId: schema.healthSnapshots.chapterId, total: schema.healthSnapshots.total })
    .from(schema.healthSnapshots).orderBy(desc(schema.healthSnapshots.createdAt));
  const seen = new Set<number>();
  for (const s of snaps) {
    if (seen.has(s.chapterId)) continue;
    seen.add(s.chapterId);
    rows.push({ scope: "chapter", scopeId: s.chapterId, metric: "chi", value: s.total, capturedOn: on });
  }

  // Overwrite today's rows so a re-run doesn't double-count.
  await db.delete(schema.kpiSnapshots).where(eq(schema.kpiSnapshots.capturedOn, on));
  if (rows.length) await db.insert(schema.kpiSnapshots).values(rows);
  return { captured: rows.length };
}

export type TrendPoint = { capturedOn: string; value: number };

/** Time series for the network metrics — the exec-dashboard trend lines. */
export async function kpiTrends(limitDays = 30): Promise<Record<string, TrendPoint[]>> {
  const db = getDb();
  const rows = await db
    .select({ metric: schema.kpiSnapshots.metric, value: schema.kpiSnapshots.value, capturedOn: schema.kpiSnapshots.capturedOn })
    .from(schema.kpiSnapshots)
    .where(eq(schema.kpiSnapshots.scope, "network"))
    .orderBy(asc(schema.kpiSnapshots.capturedOn));
  const out: Record<string, TrendPoint[]> = {};
  for (const r of rows) (out[r.metric] ??= []).push({ capturedOn: r.capturedOn, value: r.value });
  // Keep only the most recent `limitDays` points per metric.
  for (const k of Object.keys(out)) out[k] = out[k].slice(-limitDays);
  return out;
}

/** The two most recent network snapshots for a metric (for a delta). */
export async function metricDelta(metric: string): Promise<{ current: number | null; previous: number | null }> {
  const rows = await getDb()
    .select({ value: schema.kpiSnapshots.value })
    .from(schema.kpiSnapshots)
    .where(and(eq(schema.kpiSnapshots.scope, "network"), eq(schema.kpiSnapshots.metric, metric)))
    .orderBy(desc(schema.kpiSnapshots.capturedOn)).limit(2);
  return { current: rows[0]?.value ?? null, previous: rows[1]?.value ?? null };
}

/** Latest chapter CHI snapshots keyed by chapterId (used by alerting). */
export async function latestChapterChiSnapshots(): Promise<Map<number, number>> {
  const rows = await getDb()
    .select({ scopeId: schema.kpiSnapshots.scopeId, value: schema.kpiSnapshots.value, capturedOn: schema.kpiSnapshots.capturedOn })
    .from(schema.kpiSnapshots)
    .where(and(eq(schema.kpiSnapshots.scope, "chapter"), eq(schema.kpiSnapshots.metric, "chi")))
    .orderBy(desc(schema.kpiSnapshots.capturedOn));
  const m = new Map<number, number>();
  for (const r of rows) { if (r.scopeId != null && !m.has(r.scopeId)) m.set(r.scopeId, r.value); }
  return m;
}

/** Used by removeDemoData-style cleanups if ever needed. */
export async function purgeSnapshotsForChapters(chapterIds: number[]): Promise<void> {
  if (!chapterIds.length) return;
  await getDb().delete(schema.kpiSnapshots)
    .where(and(eq(schema.kpiSnapshots.scope, "chapter"), inArray(schema.kpiSnapshots.scopeId, chapterIds)));
}
