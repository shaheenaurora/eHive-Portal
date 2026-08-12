import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { tierRank } from "@contracts/constants";

/**
 * POD health (PD-02/03) — an anonymised signal from attendance consistency and
 * commitment completion over recent activity. 0–100.
 */
export async function computePodHealth(podId: number): Promise<{
  total: number;
  attendance: number;
  commitments: number;
  sessions: number;
}> {
  const db = getDb();
  const roster = await db
    .select()
    .from(schema.podMembers)
    .where(eq(schema.podMembers.podId, podId));
  const size = roster.length || 1;
  const sessions = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.podId, podId),
        sql`${schema.sessions.startsAt} < now()`
      )
    )
    .orderBy(desc(schema.sessions.startsAt))
    .limit(6);

  let attendance = 100;
  if (sessions.length) {
    const ids = sessions.map(s => s.id);
    const [att] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.attendance)
      .where(
        and(
          inArray(schema.attendance.sessionId, ids),
          eq(schema.attendance.status, "attended")
        )
      );
    attendance = Math.min(
      100,
      Math.round((Number(att?.n ?? 0) / (sessions.length * size)) * 100)
    );
  }

  const items = await db
    .select()
    .from(schema.actionItems)
    .where(eq(schema.actionItems.podId, podId));
  const commitments = items.length
    ? Math.round(
        (items.filter(i => i.status === "done").length / items.length) * 100
      )
    : 100;

  return {
    total: Math.round(attendance * 0.6 + commitments * 0.4),
    attendance,
    commitments,
    sessions: sessions.length,
  };
}

/**
 * Suggest PODs for a member (PD-01 matching engine). Scores each pod on:
 * capacity room, peer level (tier), sector diversity, and non-competition
 * (a pod containing a member from the same company is disqualified).
 */
export async function suggestPods(memberId: number): Promise<
  Array<{
    podId: number;
    name: string;
    score: number;
    reason: string;
    blocked?: string;
  }>
> {
  const db = getDb();
  const me = (
    await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1)
  ).at(0);
  if (!me) return [];
  const pods = await db
    .select()
    .from(schema.pods)
    .where(isNull(schema.pods.deletedAt));
  const out: Array<{
    podId: number;
    name: string;
    score: number;
    reason: string;
    blocked?: string;
  }> = [];

  for (const pod of pods) {
    // already in it?
    const mine = await db
      .select()
      .from(schema.podMembers)
      .where(
        and(
          eq(schema.podMembers.podId, pod.id),
          eq(schema.podMembers.memberId, memberId)
        )
      )
      .limit(1);
    if (mine.length) continue;

    const members = await db
      .select({ m: schema.members })
      .from(schema.podMembers)
      .innerJoin(
        schema.members,
        eq(schema.members.id, schema.podMembers.memberId)
      )
      .where(
        and(
          eq(schema.podMembers.podId, pod.id),
          ne(schema.podMembers.memberId, memberId)
        )
      );
    const roster = members.map(r => r.m);
    const size = roster.length;

    // Non-competition: no direct competitor (same company) in the pod.
    if (
      me.company &&
      roster.some(
        r => (r.company ?? "").toLowerCase() === me.company!.toLowerCase()
      )
    ) {
      out.push({
        podId: pod.id,
        name: pod.name,
        score: 0,
        reason: "A member from the same company is already here.",
        blocked: "competition",
      });
      continue;
    }
    if (size >= pod.capacity) {
      out.push({
        podId: pod.id,
        name: pod.name,
        score: 0,
        reason: "Pod is at capacity.",
        blocked: "full",
      });
      continue;
    }
    if (tierRank(me.tier) < tierRank(pod.tierGate)) {
      out.push({
        podId: pod.id,
        name: pod.name,
        score: 0,
        reason: "Above the member's tier.",
        blocked: "tier",
      });
      continue;
    }

    let score = 50;
    const reasons: string[] = [];
    // Room to grow toward the ideal 6–8.
    if (size >= 5 && size <= 7) {
      score += 20;
      reasons.push("healthy size");
    } else if (size < 3) {
      score += 8;
      reasons.push("forming");
    }
    // Sector diversity — reward a pod where the member's sector isn't dominant.
    if (me.sector) {
      const same = roster.filter(
        r => (r.sector ?? "").toLowerCase() === me.sector!.toLowerCase()
      ).length;
      if (same === 0) {
        score += 20;
        reasons.push("mixed sectors");
      } else if (same >= 2) {
        score -= 15;
        reasons.push("sector already well represented");
      }
    }
    // Peer level — same tier band clusters peers.
    if (roster.some(r => r.tier === me.tier)) {
      score += 10;
      reasons.push("peers at the same tier");
    }

    out.push({
      podId: pod.id,
      name: pod.name,
      score: Math.max(0, Math.min(100, score)),
      reason: reasons.join(", ") || "open pod",
    });
  }

  return out.sort((a, b) => b.score - a.score);
}
