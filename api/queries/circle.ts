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
