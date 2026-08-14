/**
 * Auto-score a cycle's eligible members from live KPI data (Awards spec Part 1,
 * the default judging mechanism). Applies the eligibility gate (active standing,
 * tenure, no open conduct case), computes windowed metrics (Hive-Score velocity,
 * qualified referrals, attendance), and ranks with the pure autoScore engine.
 */
import { and, eq, gte, lte, inArray, sql, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import {
  autoScore,
  DEFAULT_AUTOSCORE_RUBRIC,
  type AutoCandidate,
} from "../lib/awards-autoscore";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
// Conduct-case states that count as "open" for eligibility (not resolved).
const OPEN_CONDUCT = ["open", "reviewing", "escalated"] as const;

export interface AutoScoreBoardRow {
  memberId: number;
  name: string | null;
  email: string | null;
  total: number;
  rank: number;
  raw: Record<string, number>;
  normalized: Record<string, number>;
}

export async function autoScoreCycle(cycleId: number): Promise<{
  rubric: typeof DEFAULT_AUTOSCORE_RUBRIC;
  window: { from: string; to: string };
  eligible: number;
  rows: AutoScoreBoardRow[];
}> {
  const db = getDb();
  const cycle = (
    await db
      .select()
      .from(schema.awardCycles)
      .where(eq(schema.awardCycles.id, cycleId))
      .limit(1)
  ).at(0);
  if (!cycle)
    throw new TRPCError({ code: "NOT_FOUND", message: "Cycle not found." });

  const to = cycle.closesAt ? new Date(cycle.closesAt) : new Date();
  const from = cycle.opensAt
    ? new Date(cycle.opensAt)
    : new Date(to.getTime() - YEAR_MS);

  // --- eligibility gate ---
  const conds = [eq(schema.members.status, "active")];
  if (cycle.level === "chapter" && cycle.unitId)
    conds.push(eq(schema.members.homeChapterId, cycle.unitId));
  // Members with an open conduct case are excluded.
  const openCases = await db
    .select({ memberId: schema.conductCases.subjectMemberId })
    .from(schema.conductCases)
    .where(inArray(schema.conductCases.status, [...OPEN_CONDUCT]));
  const excluded = openCases
    .map(r => r.memberId)
    .filter((v): v is number => v != null);
  if (excluded.length > 0) conds.push(notInArray(schema.members.id, excluded));

  const eligible = await db
    .select({
      id: schema.members.id,
      joinedAt: schema.members.joinedAt,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.members)
    .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(and(...conds));

  const ids = eligible.map(m => m.id);
  const emptyResult = {
    rubric: DEFAULT_AUTOSCORE_RUBRIC,
    window: { from: from.toISOString(), to: to.toISOString() },
    eligible: 0,
    rows: [] as AutoScoreBoardRow[],
  };
  if (ids.length === 0) return emptyResult;

  // --- windowed metrics ---
  const engagement = new Map<number, number>();
  for (const r of await db
    .select({
      memberId: schema.scoreEvents.memberId,
      pts: sql<number>`sum(${schema.scoreEvents.points})`,
    })
    .from(schema.scoreEvents)
    .where(
      and(
        inArray(schema.scoreEvents.memberId, ids),
        gte(schema.scoreEvents.createdAt, from),
        lte(schema.scoreEvents.createdAt, to)
      )
    )
    .groupBy(schema.scoreEvents.memberId))
    engagement.set(r.memberId, Number(r.pts) || 0);

  const referrals = new Map<number, number>();
  for (const r of await db
    .select({
      memberId: schema.referrals.memberId,
      n: sql<number>`count(*)`,
    })
    .from(schema.referrals)
    .where(
      and(
        inArray(schema.referrals.memberId, ids),
        eq(schema.referrals.status, "converted"),
        gte(schema.referrals.createdAt, from),
        lte(schema.referrals.createdAt, to)
      )
    )
    .groupBy(schema.referrals.memberId))
    referrals.set(r.memberId, Number(r.n) || 0);

  const attendance = new Map<number, number>();
  for (const r of await db
    .select({
      memberId: schema.attendance.memberId,
      n: sql<number>`count(*)`,
    })
    .from(schema.attendance)
    .innerJoin(
      schema.sessions,
      eq(schema.sessions.id, schema.attendance.sessionId)
    )
    .where(
      and(
        inArray(schema.attendance.memberId, ids),
        eq(schema.attendance.status, "attended"),
        gte(schema.sessions.startsAt, from),
        lte(schema.sessions.startsAt, to)
      )
    )
    .groupBy(schema.attendance.memberId))
    attendance.set(r.memberId, Number(r.n) || 0);

  const candidates: AutoCandidate[] = eligible.map(m => ({
    memberId: m.id,
    tenureAtMs: new Date(m.joinedAt).getTime(),
    raw: {
      engagement: engagement.get(m.id) ?? 0,
      referrals: referrals.get(m.id) ?? 0,
      attendance: attendance.get(m.id) ?? 0,
    },
  }));

  const nameById = new Map(eligible.map(m => [m.id, m]));
  const ranked = autoScore(candidates, DEFAULT_AUTOSCORE_RUBRIC);
  const rows: AutoScoreBoardRow[] = ranked.slice(0, 50).map(s => ({
    memberId: s.memberId,
    name: nameById.get(s.memberId)?.name ?? null,
    email: nameById.get(s.memberId)?.email ?? null,
    total: s.total,
    rank: s.rank,
    raw: s.raw,
    normalized: s.normalized,
  }));

  return {
    rubric: DEFAULT_AUTOSCORE_RUBRIC,
    window: { from: from.toISOString(), to: to.toISOString() },
    eligible: ids.length,
    rows,
  };
}
