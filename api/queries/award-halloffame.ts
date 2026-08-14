/**
 * Hall of Fame tracker (Awards spec Part 6). Computes each member's multi-year
 * record against the auto-qualification rubric, exposes the candidate board to
 * an awards officer, and confers an induction — gated by the auto-qualification
 * bar AND the structural annual-intake cap that protects the honour's scarcity.
 */
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { audit } from "../lib/audit";
import {
  scoreHallOfFame,
  HALL_OF_FAME_RUBRIC,
  type HallOfFameInput,
  type HallOfFameScore,
} from "../lib/awards-halloffame";
import {
  HIVE_CHAMPION_BAND,
  HALL_OF_FAME_ANNUAL_INTAKE,
  HALL_OF_FAME_AWARD_KEY,
  HALL_OF_FAME_POINTS,
} from "@contracts/constants";
import { conferHallOfFame } from "./award-records";

type Actor = { id: number; email: string };

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
// A conduct case is "upheld" once it has been actioned against the subject.
const UPHELD_CONDUCT = "actioned" as const;

/** Gather every active member's multi-year inputs and score them. Members already
 *  inducted are flagged (and excluded from the qualified count) so the same
 *  person is never inducted twice. */
async function computeInputs(): Promise<{
  scored: (HallOfFameScore & {
    name: string | null;
    email: string | null;
    inducted: boolean;
    input: HallOfFameInput;
  })[];
}> {
  const db = getDb();
  const members = await db
    .select({
      id: schema.members.id,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.members)
    .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(eq(schema.members.status, "active"));
  const ids = members.map(m => m.id);
  if (ids.length === 0) return { scored: [] };

  // Champion-band years across the last 4 years (distinct calendar years with a
  // champion-band Hive Score on record).
  const since = new Date(Date.now() - 4 * YEAR_MS);
  const championYears = new Map<number, number>();
  for (const r of await db
    .select({
      memberId: schema.hiveScoreHistory.memberId,
      years: sql<number>`count(distinct year(${schema.hiveScoreHistory.computedAt}))`,
    })
    .from(schema.hiveScoreHistory)
    .where(
      and(
        inArray(schema.hiveScoreHistory.memberId, ids),
        gte(schema.hiveScoreHistory.score, HIVE_CHAMPION_BAND),
        gte(schema.hiveScoreHistory.computedAt, since)
      )
    )
    .groupBy(schema.hiveScoreHistory.memberId))
    championYears.set(r.memberId, Number(r.years) || 0);

  // Annual awards won across tenure (any conferred award other than the Hall of
  // Fame itself).
  const annualAwards = new Map<number, number>();
  const inductedSet = new Set<number>();
  for (const r of await db
    .select({
      memberId: schema.awardRecords.memberId,
      awardKey: schema.awardRecords.awardKey,
      n: sql<number>`count(*)`,
    })
    .from(schema.awardRecords)
    .where(
      and(
        isNotNull(schema.awardRecords.memberId),
        inArray(schema.awardRecords.memberId, ids)
      )
    )
    .groupBy(schema.awardRecords.memberId, schema.awardRecords.awardKey)) {
    const mid = r.memberId as number;
    if (r.awardKey === HALL_OF_FAME_AWARD_KEY) {
      inductedSet.add(mid);
    } else {
      annualAwards.set(mid, (annualAwards.get(mid) ?? 0) + (Number(r.n) || 0));
    }
  }

  // Converted referrals across tenure.
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
        eq(schema.referrals.status, "converted")
      )
    )
    .groupBy(schema.referrals.memberId))
    referrals.set(r.memberId, Number(r.n) || 0);

  // Confirmed mentoring sessions across tenure (member on either side).
  const mentoring = new Map<number, number>();
  const addMentoring = (mid: number, n: number) =>
    mentoring.set(mid, (mentoring.get(mid) ?? 0) + n);
  for (const col of [schema.oneToOnes.aMemberId, schema.oneToOnes.bMemberId]) {
    for (const r of await db
      .select({ memberId: col, n: sql<number>`count(*)` })
      .from(schema.oneToOnes)
      .where(
        and(
          inArray(col, ids),
          eq(schema.oneToOnes.kind, "mentoring"),
          eq(schema.oneToOnes.status, "confirmed")
        )
      )
      .groupBy(col))
      addMentoring(r.memberId, Number(r.n) || 0);
  }

  // Upheld (actioned) conduct matters ever recorded against the member.
  const upheld = new Map<number, number>();
  for (const r of await db
    .select({
      memberId: schema.conductCases.subjectMemberId,
      n: sql<number>`count(*)`,
    })
    .from(schema.conductCases)
    .where(
      and(
        isNotNull(schema.conductCases.subjectMemberId),
        inArray(schema.conductCases.subjectMemberId, ids),
        eq(schema.conductCases.status, UPHELD_CONDUCT)
      )
    )
    .groupBy(schema.conductCases.subjectMemberId))
    upheld.set(r.memberId as number, Number(r.n) || 0);

  const scored = members.map(m => {
    const input: HallOfFameInput = {
      memberId: m.id,
      championYears: championYears.get(m.id) ?? 0,
      annualAwards: annualAwards.get(m.id) ?? 0,
      convertedReferrals: referrals.get(m.id) ?? 0,
      mentoringSessions: mentoring.get(m.id) ?? 0,
      upheldConductCount: upheld.get(m.id) ?? 0,
    };
    return {
      ...scoreHallOfFame(input),
      name: m.name,
      email: m.email,
      inducted: inductedSet.has(m.id),
      input,
    };
  });
  return { scored };
}

/** How many Hall of Fame inductions have been conferred in the current calendar
 *  year (against the annual intake cap). */
async function intakeUsedThisYear(): Promise<number> {
  const startOfYear = new Date(new Date().getFullYear(), 0, 1);
  const row = (
    await getDb()
      .select({ n: sql<number>`count(*)` })
      .from(schema.awardRecords)
      .where(
        and(
          eq(schema.awardRecords.awardKey, HALL_OF_FAME_AWARD_KEY),
          gte(schema.awardRecords.conferredAt, startOfYear)
        )
      )
  ).at(0);
  return Number(row?.n) || 0;
}

export type HallOfFameBoardRow = {
  memberId: number;
  name: string | null;
  email: string | null;
  sub: HallOfFameScore["sub"];
  total: number;
  qualified: boolean;
  gaps: string[];
  inducted: boolean;
  input: HallOfFameInput;
};

/** The officer's Hall of Fame board: candidates ranked by their multi-year
 *  score, plus the intake headroom left this year. */
export async function hallOfFameBoard(): Promise<{
  rubric: typeof HALL_OF_FAME_RUBRIC;
  intake: { cap: number; usedThisYear: number; remaining: number };
  rows: HallOfFameBoardRow[];
}> {
  const { scored } = await computeInputs();
  const used = await intakeUsedThisYear();
  const rows = scored
    .filter(s => s.qualified || s.inducted || s.total > 0)
    .sort((a, b) => {
      // Inducted first, then qualified, then by score.
      if (a.inducted !== b.inducted) return a.inducted ? -1 : 1;
      if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
      return b.total - a.total;
    })
    .slice(0, 50)
    .map(s => ({
      memberId: s.memberId,
      name: s.name,
      email: s.email,
      sub: s.sub,
      total: s.total,
      qualified: s.qualified,
      gaps: s.gaps,
      inducted: s.inducted,
      input: s.input,
    }));
  return {
    rubric: HALL_OF_FAME_RUBRIC,
    intake: {
      cap: HALL_OF_FAME_ANNUAL_INTAKE,
      usedThisYear: used,
      remaining: Math.max(0, HALL_OF_FAME_ANNUAL_INTAKE - used),
    },
    rows,
  };
}

/** Induct a member into the Hall of Fame. Re-verifies auto-qualification (the
 *  data decides who is eligible), blocks a double induction, and enforces the
 *  annual intake cap before conferral. */
export async function inductHallOfFame(actor: Actor, memberId: number) {
  const { scored } = await computeInputs();
  const cand = scored.find(s => s.memberId === memberId);
  if (!cand)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That member isn't an active candidate.",
    });
  if (cand.inducted)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This member is already in the Hall of Fame.",
    });
  if (!cand.qualified)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Not yet auto-qualified: ${cand.gaps.join("; ")}.`,
    });
  const used = await intakeUsedThisYear();
  if (used >= HALL_OF_FAME_ANNUAL_INTAKE)
    throw new TRPCError({
      code: "CONFLICT",
      message: `This year's Hall of Fame intake (${HALL_OF_FAME_ANNUAL_INTAKE}) is full — scarcity is structural.`,
    });

  await conferHallOfFame(actor, { memberId }, cand.total, HALL_OF_FAME_POINTS);
  await audit(actor, "awards.halloffame.induct", {
    type: "member",
    id: memberId,
    detail: `score ${cand.total}`,
  });
  return { ok: true };
}

/** The public Hall of Fame — inducted members, newest first. */
export async function hallOfFameInductees(): Promise<
  {
    memberId: number | null;
    name: string | null;
    conferredAt: Date;
    score: number | null;
  }[]
> {
  const rows = await getDb()
    .select({
      memberId: schema.awardRecords.memberId,
      name: schema.users.name,
      conferredAt: schema.awardRecords.conferredAt,
      score: schema.awardRecords.score,
    })
    .from(schema.awardRecords)
    .leftJoin(
      schema.members,
      eq(schema.members.id, schema.awardRecords.memberId)
    )
    .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(eq(schema.awardRecords.awardKey, HALL_OF_FAME_AWARD_KEY))
    .orderBy(desc(schema.awardRecords.conferredAt))
    .limit(100);
  return rows;
}
