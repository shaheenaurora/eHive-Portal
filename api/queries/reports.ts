import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { TIER_PRICE_AED } from "@contracts/constants";
import { ragAtLeast, ragHealth, pct, type Kpi } from "../lib/reports-calc";

const fmtAed = (aed: number) =>
  "AED " + Math.round(aed).toLocaleString("en-AE");

/** Latest Chapter Health Index per chapter from stored snapshots. */
async function latestChi(): Promise<Map<number, number>> {
  const snaps = await getDb()
    .select({
      chapterId: schema.healthSnapshots.chapterId,
      total: schema.healthSnapshots.total,
    })
    .from(schema.healthSnapshots)
    .orderBy(desc(schema.healthSnapshots.createdAt));
  const m = new Map<number, number>();
  for (const s of snaps) if (!m.has(s.chapterId)) m.set(s.chapterId, s.total);
  return m;
}

/** Executive / network scorecard — the corporate-level KPIs (Framework Part 8),
 *  each with its target and RAG status. Two families kept visibly separate. */
export async function networkKpis(): Promise<{
  generatedAt: string;
  kpis: Kpi[];
}> {
  const db = getDb();
  const members = await db
    .select({
      tier: schema.members.tier,
      status: schema.members.status,
      lifecycleState: schema.members.lifecycleState,
      hiveScore: schema.members.hiveScore,
    })
    .from(schema.members);

  const active = members.filter(m => m.status === "active");
  const activeCount = active.length;
  const engaged = active.filter(m => m.hiveScore >= 20).length;
  const atRisk = active.filter(m => m.lifecycleState === "at_risk").length;
  const churned = members.filter(
    m =>
      m.status === "cancelled" ||
      m.lifecycleState === "lapsed" ||
      m.lifecycleState === "alumni"
  ).length;
  const retention = pct(activeCount, activeCount + churned);
  const arrAed = active.reduce((a, m) => a + (TIER_PRICE_AED[m.tier] ?? 0), 0);

  const chis = await latestChi();
  const chapters = await db
    .select({ id: schema.chapters.id })
    .from(schema.chapters)
    .where(isNull(schema.chapters.deletedAt));
  const chiVals = chapters
    .map(c => chis.get(c.id))
    .filter((v): v is number => v != null);
  const avgChi = chiVals.length
    ? Math.round(chiVals.reduce((a, b) => a + b, 0) / chiVals.length)
    : null;
  const atBar = pct(chiVals.filter(v => v >= 65).length, chiVals.length);

  const [paidThisYear] = await db
    .select({ n: sql<number>`coalesce(sum(amount),0)` })
    .from(schema.paymentRecords)
    .where(
      and(
        eq(schema.paymentRecords.status, "paid"),
        gte(
          schema.paymentRecords.createdAt,
          new Date(new Date().getFullYear(), 0, 1)
        )
      )
    );
  const revenueYtdAed = Number(paidThisYear?.n ?? 0) / 100;

  const kpis: Kpi[] = [
    {
      key: "activeMembers",
      label: "Total active members",
      value: activeCount,
      display: String(activeCount),
      target: "Grow to plan",
      status: "none",
      family: "community",
    },
    {
      key: "activeRate",
      label: "Active-member rate (Hive ≥ 20)",
      value: pct(engaged, activeCount),
      display: `${pct(engaged, activeCount)}%`,
      target: "≥ 80%",
      status: ragAtLeast(pct(engaged, activeCount), 80),
      family: "community",
    },
    {
      key: "retention",
      label: "System-wide retention (approx)",
      value: retention,
      display: `${retention}%`,
      target: "≥ 85%",
      status: ragAtLeast(retention, 85),
      family: "community",
    },
    {
      key: "atRisk",
      label: "Members at-risk",
      value: atRisk,
      display: String(atRisk),
      target: "Minimise",
      status:
        atRisk === 0 ? "green" : atRisk <= activeCount * 0.1 ? "amber" : "red",
      family: "community",
    },
    {
      key: "avgChi",
      label: "Network Health Index (avg CHI)",
      value: avgChi,
      display: avgChi == null ? "—" : String(avgChi),
      target: "≥ 65",
      status: ragHealth(avgChi),
      family: "community",
    },
    {
      key: "chaptersAtBar",
      label: "Chapters at/above bar (CHI ≥ 65)",
      value: atBar,
      display: `${atBar}%`,
      target: "≥ 80%",
      status: ragAtLeast(atBar, 80),
      family: "community",
    },
    {
      key: "arr",
      label: "ARR (contract dues, active base)",
      value: arrAed,
      display: fmtAed(arrAed),
      target: "Grow to plan",
      status: "none",
      family: "commercial",
    },
    {
      key: "mrr",
      label: "MRR (ARR ÷ 12)",
      value: Math.round(arrAed / 12),
      display: fmtAed(arrAed / 12),
      target: "Grow to plan",
      status: "none",
      family: "commercial",
    },
    {
      key: "revenueYtd",
      label: "Revenue collected (YTD, paid)",
      value: revenueYtdAed,
      display: fmtAed(revenueYtdAed),
      target: "To plan",
      status: "none",
      family: "commercial",
    },
  ];
  return { generatedAt: new Date().toISOString(), kpis };
}

export type ChapterScorecard = {
  chapterId: number;
  chapterName: string;
  members: number;
  chi: number | null;
  chiStatus: string;
  activeRate: number;
  atRisk: number;
  arrAed: number;
};

/** Per-chapter scorecard — the framework's most important report (Part 4). */
export async function chapterScorecards(): Promise<ChapterScorecard[]> {
  const db = getDb();
  const chapters = await db
    .select({ id: schema.chapters.id, name: schema.chapters.name })
    .from(schema.chapters)
    .where(isNull(schema.chapters.deletedAt));
  const members = await db
    .select({
      homeChapterId: schema.members.homeChapterId,
      tier: schema.members.tier,
      hiveScore: schema.members.hiveScore,
      lifecycleState: schema.members.lifecycleState,
    })
    .from(schema.members)
    .where(eq(schema.members.status, "active"));
  const chis = await latestChi();

  return chapters
    .map(c => {
      const mem = members.filter(m => m.homeChapterId === c.id);
      const engaged = mem.filter(m => m.hiveScore >= 20).length;
      const atRisk = mem.filter(m => m.lifecycleState === "at_risk").length;
      const arrAed = mem.reduce((a, m) => a + (TIER_PRICE_AED[m.tier] ?? 0), 0);
      const chi = chis.get(c.id) ?? null;
      return {
        chapterId: c.id,
        chapterName: c.name,
        members: mem.length,
        chi,
        chiStatus: ragHealth(chi),
        activeRate: pct(engaged, mem.length),
        atRisk,
        arrAed,
      };
    })
    .sort((a, b) => b.members - a.members);
}

/** Member At-Risk List (Framework Part 9.1) — who to reach out to this week. */
export async function atRiskReport() {
  const db = getDb();
  const rows = await db
    .select({
      memberId: schema.members.id,
      name: schema.users.name,
      email: schema.users.email,
      tier: schema.members.tier,
      hiveScore: schema.members.hiveScore,
      chapterName: schema.chapters.name,
    })
    .from(schema.members)
    .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .leftJoin(
      schema.chapters,
      eq(schema.chapters.id, schema.members.homeChapterId)
    )
    .where(
      and(
        eq(schema.members.status, "active"),
        eq(schema.members.lifecycleState, "at_risk")
      )
    )
    .orderBy(schema.members.hiveScore)
    .limit(500);
  return rows;
}

/** Pipeline & conversion — prospects and applications funnel (Framework Part 9.1). */
export async function pipelineReport() {
  const db = getDb();
  const [prospects, apps] = await Promise.all([
    db
      .select({ stage: schema.prospects.stage, n: sql<number>`count(*)` })
      .from(schema.prospects)
      .groupBy(schema.prospects.stage),
    db
      .select({ status: schema.applications.status, n: sql<number>`count(*)` })
      .from(schema.applications)
      .groupBy(schema.applications.status),
  ]);
  const prospectStages = Object.fromEntries(
    prospects.map(p => [p.stage ?? "unknown", Number(p.n)])
  );
  const appStatuses = Object.fromEntries(
    apps.map(a => [a.status, Number(a.n)])
  );
  const totalProspects = prospects.reduce((a, p) => a + Number(p.n), 0);
  const totalApps = apps.reduce((a, p) => a + Number(p.n), 0);
  const approved = Number(appStatuses["approved"] ?? 0);
  return {
    prospectStages,
    appStatuses,
    totalProspects,
    totalApps,
    conversionPct: pct(approved, totalApps),
  };
}

/** Cohort/renewals snapshot used by several management reports. */
export async function renewalsReport() {
  const db = getDb();
  const rows = await db
    .select({
      tier: schema.members.tier,
      renewalAt: schema.members.renewalAt,
      name: schema.users.name,
      chapterName: schema.chapters.name,
    })
    .from(schema.members)
    .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .leftJoin(
      schema.chapters,
      eq(schema.chapters.id, schema.members.homeChapterId)
    )
    .where(
      and(
        eq(schema.members.status, "active"),
        inArray(schema.members.lifecycleState, ["active", "renewal", "at_risk"])
      )
    )
    .orderBy(schema.members.renewalAt)
    .limit(500);
  return rows;
}
