import { eq, and, asc, sql, gte } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

/** The member record for a user, or null when they only have an application. */
export async function getMemberByUserId(userId: number) {
  const rows = await getDb()
    .select()
    .from(schema.members)
    .where(eq(schema.members.userId, userId))
    .limit(1);
  return rows.at(0) ?? null;
}

/** Score weights as { factor: maxPoints } — caps sum to 100. */
export async function getScoreWeights(): Promise<Record<string, number>> {
  const rows = await getDb().select().from(schema.hiveScoreConfig);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.factor] = r.weight;
  return out;
}

/**
 * Recompute a member's Hive Score from the raw score-events ledger:
 * per factor, min(rawSum, factorCap); total = sum of capped factors.
 * Writes the cached score + a history snapshot. Returns the new score.
 */
export async function recomputeScore(memberId: number): Promise<number> {
  const db = getDb();
  const weights = await getScoreWeights();
  const sums = await db
    .select({ factor: schema.scoreEvents.factor, total: sql<number>`coalesce(sum(${schema.scoreEvents.points}),0)` })
    .from(schema.scoreEvents)
    .where(eq(schema.scoreEvents.memberId, memberId))
    .groupBy(schema.scoreEvents.factor);
  const breakdown: Record<string, number> = {};
  for (const s of sums) breakdown[s.factor] = Math.min(s.total, weights[s.factor] ?? s.total);
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  await db.update(schema.members).set({ hiveScore: score }).where(eq(schema.members.id, memberId));
  await db.insert(schema.hiveScoreHistory).values({ memberId, score, breakdown: JSON.stringify(breakdown) });
  return score;
}

/** Add raw points to the ledger and recompute. */
export async function awardPoints(memberId: number, factor: string, points: number, note?: string) {
  await getDb().insert(schema.scoreEvents).values({ memberId, factor, points, note });
  return recomputeScore(memberId);
}

/** Open action items assigned to a member, newest first. */
export async function openActionItems(memberId: number) {
  return getDb()
    .select()
    .from(schema.actionItems)
    .where(and(eq(schema.actionItems.memberId, memberId), eq(schema.actionItems.status, "open")))
    .orderBy(asc(schema.actionItems.dueAt));
}

/** Next scheduled session across the member's pods. */
export async function nextSessionForMember(memberId: number) {
  const rows = await getDb()
    .select({ session: schema.sessions, pod: schema.pods })
    .from(schema.sessions)
    .innerJoin(schema.pods, eq(schema.sessions.podId, schema.pods.id))
    .innerJoin(schema.podMembers, and(eq(schema.podMembers.podId, schema.pods.id), eq(schema.podMembers.memberId, memberId)))
    .where(and(eq(schema.sessions.status, "scheduled"), gte(schema.sessions.startsAt, new Date())))
    .orderBy(asc(schema.sessions.startsAt))
    .limit(1);
  return rows.at(0) ?? null;
}

export function memberDisplayName(user: { name: string | null; email: string | null }) {
  if (user.name && user.name.trim()) return user.name;
  if (user.email) return user.email.split("@")[0];
  return "Member";
}


/* ================= BRD v2: point-rules engine, notifications, dormancy ================= */

import {
  POINT_RULE_DEFAULTS, POINT_RULE_FACTOR, POINT_RULE_LABEL,
  type PointRuleKey, type DormancyStage,
} from "@contracts/constants";

/** Point values per rule key — DB overrides (point_rules table) over BRD defaults. */
export async function getPointRules(): Promise<Record<string, number>> {
  const rows = await getDb().select().from(schema.pointRules);
  const out: Record<string, number> = { ...POINT_RULE_DEFAULTS };
  for (const r of rows) out[r.key] = r.points;
  return out;
}

/** Award points for a BRD point-rule key (value is admin-configurable). */
export async function awardRulePoints(memberId: number, key: PointRuleKey, note?: string): Promise<number> {
  const rules = await getPointRules();
  const pts = rules[key] ?? POINT_RULE_DEFAULTS[key];
  return awardPoints(memberId, POINT_RULE_FACTOR[key], pts, note ?? POINT_RULE_LABEL[key]);
}

/** In-portal notification (BRD 6.3 — email/WhatsApp dispatch is a platform dependency). */
export async function notify(memberId: number, text: string, kind = "info") {
  await getDb().insert(schema.notifications).values({ memberId, text, kind });
}

/** Start of the current quarter. */
export function quarterStart(d = new Date()): Date {
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1);
}

/** Quarter-to-date engagement counts for a member. */
export async function engagementCounts(memberId: number, since = quarterStart()) {
  const db = getDb();
  const sessions = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.attendance)
    .innerJoin(schema.sessions, eq(schema.attendance.sessionId, schema.sessions.id))
    .where(and(eq(schema.attendance.memberId, memberId), gte(schema.sessions.startsAt, since)));
  const oneToOne = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.oneToOnes)
    .where(and(
      sql`(${schema.oneToOnes.aMemberId} = ${memberId} or ${schema.oneToOnes.bMemberId} = ${memberId})`,
      eq(schema.oneToOnes.status, "confirmed"),
      eq(schema.oneToOnes.kind, "one_to_one"),
      gte(schema.oneToOnes.createdAt, since)));
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const giveBack = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.oneToOnes)
    .where(and(
      eq(schema.oneToOnes.bMemberId, memberId), // the mentor is the counterpart who confirmed
      eq(schema.oneToOnes.status, "confirmed"),
      eq(schema.oneToOnes.kind, "mentoring"),
      gte(schema.oneToOnes.createdAt, yearStart)));
  return {
    sessions: sessions.at(0)?.n ?? 0,
    oneToOnes: oneToOne.at(0)?.n ?? 0,
    giveBack: giveBack.at(0)?.n ?? 0,
  };
}

async function setDormancyStage(memberId: number, from: string, to: DormancyStage, reason: string, actor = "system") {
  const db = getDb();
  await db.update(schema.members).set({ dormancyStage: to }).where(eq(schema.members.id, memberId));
  await db.insert(schema.dormancyLog).values({ memberId, fromStage: from, toStage: to, reason, actor });
  const labels: Record<string, string> = { at_risk: "At Risk", dormant: "Dormant", non_renewal: "Non-Renewal", active: "Active" };
  await notify(memberId, `Your engagement status changed to ${labels[to] ?? to}. ${reason}`, "dormancy");
}

/**
 * BRD 6.3 Dormancy Ladder evaluation (quarterly, admin-triggered):
 * meets standard -> active; some activity but below standard -> at_risk;
 * zero activity -> dormant; dormant twice in a row -> non_renewal.
 * Members on exception pause are skipped (pause counter decremented).
 */
export async function evaluateDormancy(): Promise<{ evaluated: number; transitions: number }> {
  const db = getDb();
  const configs = await db.select().from(schema.engagementConfig);
  const cfgByTier = new Map(configs.map(c => [c.tier, c]));
  const all = await db.select().from(schema.members).where(eq(schema.members.status, "active"));
  let transitions = 0;
  for (const m of all) {
    if (m.exceptionPause > 0) {
      await db.update(schema.members).set({ exceptionPause: m.exceptionPause - 1 }).where(eq(schema.members.id, m.id));
      continue;
    }
    const cfg = cfgByTier.get(m.tier as any);
    const counts = await engagementCounts(m.id);
    const needSessions = Math.max(1, Math.ceil((cfg?.sessionsRequired ?? 2) / 4));
    const needOneToOnes = cfg?.oneToOnesPerQuarter ?? 1;
    const anyActivity = counts.sessions > 0 || counts.oneToOnes > 0 || counts.giveBack > 0;
    const meets = counts.sessions >= needSessions && counts.oneToOnes >= needOneToOnes;
    const cur = (m.dormancyStage ?? "active") as DormancyStage;
    let next: DormancyStage = cur;
    let reason = "";
    if (meets) {
      if (cur !== "active") { next = "active"; reason = "Engagement standard met."; }
    } else if (anyActivity) {
      if (cur !== "at_risk") { next = "at_risk"; reason = "Below the Engagement Standard this quarter."; }
    } else if (cur === "dormant") {
      next = "non_renewal"; reason = "No engagement for two consecutive quarters.";
    } else {
      next = "dormant"; reason = "No recorded engagement this quarter.";
    }
    if (next !== cur) { await setDormancyStage(m.id, cur, next, reason); transitions++; }
  }
  return { evaluated: all.length, transitions };
}

/** BRD 6.6 — intro eligibility: FRP complete + Active status. */
export async function introEligibility(memberId: number): Promise<{ eligible: boolean; reasons: string[] }> {
  const db = getDb();
  const reasons: string[] = [];
  const m = (await db.select().from(schema.members).where(eq(schema.members.id, memberId)).limit(1)).at(0);
  if (!m) return { eligible: false, reasons: ["Not a member"] };
  if (m.status !== "active") reasons.push("Membership is not active");
  if ((m.dormancyStage ?? "active") !== "active") reasons.push("Engagement status is not Active");
  const completed = await db.select({ n: sql<number>`count(*)` }).from(schema.frpEnrolments)
    .where(and(eq(schema.frpEnrolments.memberId, memberId), eq(schema.frpEnrolments.status, "completed")));
  if ((completed.at(0)?.n ?? 0) === 0) reasons.push("FRP not completed");
  return { eligible: reasons.length === 0, reasons };
}

/** Human-readable check-in code for event QR/door check-in. */
export function newCheckinCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s.slice(0, 4) + "-" + s.slice(4);
}

/** BRD 6.4 — promote the longest-waiting member when a seat frees up. */
export async function promoteWaitlist(eventId: number) {
  const db = getDb();
  const next = await db.select().from(schema.eventRegs)
    .where(and(eq(schema.eventRegs.eventId, eventId), eq(schema.eventRegs.status, "waitlisted")))
    .orderBy(asc(schema.eventRegs.createdAt)).limit(1);
  const reg = next.at(0);
  if (!reg) return;
  await db.update(schema.eventRegs)
    .set({ status: "registered", checkinCode: newCheckinCode() })
    .where(eq(schema.eventRegs.id, reg.id));
  const ev = (await db.select().from(schema.events).where(eq(schema.events.id, eventId)).limit(1)).at(0);
  await notify(reg.memberId, `A seat opened up — you're registered for ${ev?.title ?? "the event"}.`, "event");
}
