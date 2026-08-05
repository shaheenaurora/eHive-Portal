import { desc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { mergeActivity, type Activity } from "../lib/member-change";

/** Latest saved Chapter Health Index per chapter. */
async function latestHealthMap(chapterIds: number[]): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  if (!chapterIds.length) return m;
  const snaps = await getDb()
    .select({ chapterId: schema.healthSnapshots.chapterId, total: schema.healthSnapshots.total })
    .from(schema.healthSnapshots)
    .where(inArray(schema.healthSnapshots.chapterId, chapterIds))
    .orderBy(desc(schema.healthSnapshots.createdAt));
  for (const s of snaps) if (!m.has(s.chapterId)) m.set(s.chapterId, s.total);
  return m;
}

/** Command-strip summary for the chapter list — stage mix, health, at-risk. */
export async function chaptersOverview() {
  const db = getDb();
  const chapters = await db.select({ id: schema.chapters.id, status: schema.chapters.status }).from(schema.chapters);
  const ids = chapters.map((c) => c.id);
  const health = await latestHealthMap(ids);

  const [memberCount] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.members)
    .where(sql`${schema.members.status} = 'active' and ${schema.members.homeChapterId} is not null`);

  const byStage: Record<string, number> = { seed: 0, provisional: 0, chartered: 0, mature: 0, at_risk: 0 };
  let atRisk = 0;
  const chis: number[] = [];
  for (const c of chapters) {
    byStage[c.status] = (byStage[c.status] ?? 0) + 1;
    const chi = health.get(c.id);
    if (chi != null) chis.push(chi);
    if (c.status === "at_risk" || (chi != null && chi < 50)) atRisk++;
  }
  const avgChi = chis.length ? Math.round(chis.reduce((a, b) => a + b, 0) / chis.length) : null;
  const atBar = chis.length ? Math.round((chis.filter((v) => v >= 65).length / chis.length) * 100) : 0;

  return {
    chapters: chapters.length,
    members: Number(memberCount?.n ?? 0),
    byStage, atRisk, avgChi, atBar,
  };
}

/** Unified per-chapter activity ledger (ERP parity with member/finance). */
export async function chapterActivity(chapterId: number): Promise<Activity[]> {
  const db = getDb();
  const [snaps, elections, motions, budgets, meetings, roles] = await Promise.all([
    db.select().from(schema.healthSnapshots).where(eq(schema.healthSnapshots.chapterId, chapterId)).orderBy(desc(schema.healthSnapshots.createdAt)).limit(20),
    db.select().from(schema.elections).where(eq(schema.elections.chapterId, chapterId)).orderBy(desc(schema.elections.createdAt)).limit(20),
    db.select().from(schema.motions).where(eq(schema.motions.chapterId, chapterId)).orderBy(desc(schema.motions.createdAt)).limit(20),
    db.select().from(schema.chapterBudgets).where(eq(schema.chapterBudgets.chapterId, chapterId)).orderBy(desc(schema.chapterBudgets.createdAt)).limit(30),
    db.select().from(schema.meetings).where(eq(schema.meetings.chapterId, chapterId)).orderBy(desc(schema.meetings.createdAt)).limit(20),
    db.select({ role: schema.chapterRoles.role, title: schema.chapterRoles.title, status: schema.chapterRoles.status,
      createdAt: schema.chapterRoles.createdAt, termEnd: schema.chapterRoles.termEnd, name: schema.users.name })
      .from(schema.chapterRoles)
      .leftJoin(schema.members, eq(schema.members.id, schema.chapterRoles.memberId))
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.chapterRoles.chapterId, chapterId)).orderBy(desc(schema.chapterRoles.createdAt)).limit(30),
  ]);

  const A: Activity[][] = [];
  A.push(snaps.map((s) => ({ at: s.createdAt, kind: "health", icon: "✦", title: `Health snapshot · index ${s.total}` })));
  A.push(elections.map((e) => ({ at: e.createdAt, kind: "election", icon: "⚖", title: `Election: ${e.title}`, detail: `${e.seat} · ${e.status}` })));
  A.push(motions.map((m) => ({ at: m.createdAt, kind: "motion", icon: "§", title: `Motion: ${m.title}`, detail: m.status })));
  A.push(budgets.map((b) => ({ at: b.decidedAt ?? b.createdAt, kind: "budget", icon: "▦", title: `Budget ${b.kind}: ${b.label}`, detail: `AED ${b.amount.toLocaleString()} · ${b.status}` })));
  A.push(meetings.map((m) => ({ at: m.scheduledAt ?? m.createdAt, kind: "meeting", icon: "◷", title: `${m.kind.replace("_", " ")}: ${m.title}`, detail: m.status })));
  A.push(roles.map((r) => ({ at: r.createdAt, kind: "role", icon: "★", title: `Role ${r.status === "active" ? "assigned" : "ended"}: ${r.title || r.role}`, actor: r.name ?? undefined })));

  return mergeActivity(A).slice(0, 80);
}
