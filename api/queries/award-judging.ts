/**
 * Award panel-judging engine (Awards spec Part 1 / Part 7). Assigns an
 * independent panel to a cycle, records each judge's rubric-weighted score for
 * shortlisted nominees (with conflict-of-interest recusal), ranks nominees by
 * the panel average, and ratifies a winner through an independent officer — the
 * scoring → integrity → ratification → conferral gates.
 */
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { audit } from "../lib/audit";
import { notify } from "./circle";
import {
  parseRubric,
  weightedTotal,
  averageScore,
  validateRubric,
  type RubricCriterion,
} from "../lib/awards-scoring";

type Actor = { id: number; email: string };

async function getCycle(cycleId: number) {
  return (
    await getDb()
      .select()
      .from(schema.awardCycles)
      .where(eq(schema.awardCycles.id, cycleId))
      .limit(1)
  ).at(0);
}

async function getNomination(nominationId: number) {
  return (
    await getDb()
      .select()
      .from(schema.awardNominations)
      .where(eq(schema.awardNominations.id, nominationId))
      .limit(1)
  ).at(0);
}

async function memberIdForUser(userId: number): Promise<number | null> {
  const m = (
    await getDb()
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(eq(schema.members.userId, userId))
      .limit(1)
  ).at(0);
  return m?.id ?? null;
}

/* -------------------------------- rubric --------------------------------- */

export async function setCycleRubric(
  actor: Actor,
  cycleId: number,
  rubric: RubricCriterion[]
) {
  const v = validateRubric(rubric);
  if (!v.ok) throw new TRPCError({ code: "BAD_REQUEST", message: v.error });
  const cycle = await getCycle(cycleId);
  if (!cycle)
    throw new TRPCError({ code: "NOT_FOUND", message: "Cycle not found." });
  await getDb()
    .update(schema.awardCycles)
    .set({ rubric: JSON.stringify(rubric) })
    .where(eq(schema.awardCycles.id, cycleId));
  await audit(actor, "awards.rubric.set", {
    type: "awardCycle",
    id: cycleId,
    detail: rubric.map(c => `${c.key}:${c.weight}`).join(", "),
  });
  return { ok: true };
}

/* -------------------------------- judges --------------------------------- */

export async function isJudge(
  cycleId: number,
  userId: number
): Promise<boolean> {
  const row = (
    await getDb()
      .select({ id: schema.awardJudges.id })
      .from(schema.awardJudges)
      .where(
        and(
          eq(schema.awardJudges.cycleId, cycleId),
          eq(schema.awardJudges.userId, userId)
        )
      )
      .limit(1)
  ).at(0);
  return !!row;
}

export async function assignJudge(
  actor: Actor,
  cycleId: number,
  userId: number
) {
  const cycle = await getCycle(cycleId);
  if (!cycle)
    throw new TRPCError({ code: "NOT_FOUND", message: "Cycle not found." });
  const user = (
    await getDb()
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)
  ).at(0);
  if (!user)
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
  await getDb()
    .insert(schema.awardJudges)
    .values({ cycleId, userId, assignedByUserId: actor.id })
    .onDuplicateKeyUpdate({ set: { assignedByUserId: actor.id } });
  await audit(actor, "awards.judge.assign", {
    type: "awardCycle",
    id: cycleId,
    detail: `judge user #${userId}`,
  });
  return { ok: true };
}

export async function removeJudge(
  actor: Actor,
  cycleId: number,
  userId: number
) {
  await getDb()
    .delete(schema.awardJudges)
    .where(
      and(
        eq(schema.awardJudges.cycleId, cycleId),
        eq(schema.awardJudges.userId, userId)
      )
    );
  await audit(actor, "awards.judge.remove", {
    type: "awardCycle",
    id: cycleId,
    detail: `judge user #${userId}`,
  });
  return { ok: true };
}

export async function listJudges(cycleId: number) {
  return getDb()
    .select({
      userId: schema.awardJudges.userId,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.awardJudges)
    .leftJoin(schema.users, eq(schema.users.id, schema.awardJudges.userId))
    .where(eq(schema.awardJudges.cycleId, cycleId))
    .orderBy(asc(schema.awardJudges.id));
}

/* -------------------------------- scoring -------------------------------- */

export async function submitScore(
  judge: Actor,
  input: {
    cycleId: number;
    nominationId: number;
    scores: { key: string; value: number }[];
    note?: string;
  }
) {
  if (!(await isJudge(input.cycleId, judge.id)))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You're not on this award's judging panel.",
    });
  const nom = await getNomination(input.nominationId);
  if (!nom || nom.cycleId !== input.cycleId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Nomination not found.",
    });
  if (nom.status !== "shortlisted")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only shortlisted nominees are scored.",
    });
  // Conflict of interest: a judge can't score a nominee that is themselves or
  // that they nominated (integrity gate).
  const judgeMemberId = await memberIdForUser(judge.id);
  if (
    judgeMemberId &&
    (nom.nomineeMemberId === judgeMemberId ||
      nom.nominatedByMemberId === judgeMemberId)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can't score a nominee you're connected to.",
    });
  const cycle = await getCycle(input.cycleId);
  const rubric = parseRubric(cycle?.rubric ?? null);
  const total = weightedTotal(input.scores, rubric);
  await getDb()
    .insert(schema.awardScores)
    .values({
      cycleId: input.cycleId,
      nominationId: input.nominationId,
      judgeUserId: judge.id,
      scores: JSON.stringify(input.scores),
      total,
      note: input.note?.slice(0, 1000) ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        scores: JSON.stringify(input.scores),
        total,
        note: input.note?.slice(0, 1000) ?? null,
      },
    });
  return { ok: true, total };
}

/* --------------------------------- board --------------------------------- */

export type JudgingBoardRow = {
  nominationId: number;
  nomineeName: string | null;
  nomineeChapterName: string | null;
  category: string;
  status: string;
  average: number;
  scoredBy: number;
  ratifiedByUserId: number | null;
  scores: { judgeUserId: number; total: number; note: string | null }[];
};

/** The panel board for a cycle: each shortlisted nominee with its per-judge
 *  scores, the panel average, and ranking (average desc, then more judges,
 *  then earlier nomination). */
export async function judgingBoard(cycleId: number) {
  const db = getDb();
  const cycle = await getCycle(cycleId);
  if (!cycle)
    throw new TRPCError({ code: "NOT_FOUND", message: "Cycle not found." });
  const rubric = parseRubric(cycle.rubric ?? null);

  const nominee = alias(schema.users, "nominee");
  const nomineeMember = alias(schema.members, "nomineeMember");
  const noms = await db
    .select({
      id: schema.awardNominations.id,
      category: schema.awardNominations.category,
      status: schema.awardNominations.status,
      nomineeName: nominee.name,
      nomineeChapterName: schema.chapters.name,
      ratifiedByUserId: schema.awardNominations.ratifiedByUserId,
    })
    .from(schema.awardNominations)
    .leftJoin(
      nomineeMember,
      eq(nomineeMember.id, schema.awardNominations.nomineeMemberId)
    )
    .leftJoin(nominee, eq(nominee.id, nomineeMember.userId))
    .leftJoin(
      schema.chapters,
      eq(schema.chapters.id, schema.awardNominations.nomineeChapterId)
    )
    .where(
      and(
        eq(schema.awardNominations.cycleId, cycleId),
        eq(schema.awardNominations.status, "shortlisted")
      )
    );

  const scores = await db
    .select({
      nominationId: schema.awardScores.nominationId,
      judgeUserId: schema.awardScores.judgeUserId,
      total: schema.awardScores.total,
      note: schema.awardScores.note,
    })
    .from(schema.awardScores)
    .where(eq(schema.awardScores.cycleId, cycleId));

  const byNom = new Map<number, typeof scores>();
  for (const s of scores) {
    const list = byNom.get(s.nominationId) ?? [];
    list.push(s);
    byNom.set(s.nominationId, list);
  }

  const rows: JudgingBoardRow[] = noms.map(n => {
    const list = byNom.get(n.id) ?? [];
    return {
      nominationId: n.id,
      nomineeName: n.nomineeName,
      nomineeChapterName: n.nomineeChapterName,
      category: n.category,
      status: n.status,
      average: averageScore(list.map(s => s.total)),
      scoredBy: list.length,
      ratifiedByUserId: n.ratifiedByUserId,
      scores: list.map(s => ({
        judgeUserId: s.judgeUserId,
        total: s.total,
        note: s.note,
      })),
    };
  });
  rows.sort(
    (a, b) =>
      b.average - a.average ||
      b.scoredBy - a.scoredBy ||
      a.nominationId - b.nominationId
  );
  return { rubric, rows };
}

/* ------------------------------ ratification ----------------------------- */

/** Independent ratification of a winner (gate 4). The ratifier must not be a
 *  judge of the cycle. Sets the nomination to `winner`, records the ratifier,
 *  and notifies the nominee. */
export async function ratifyWinner(
  actor: Actor,
  cycleId: number,
  nominationId: number
) {
  if (await isJudge(cycleId, actor.id))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "A judge of this cycle can't also ratify its winner.",
    });
  const nom = await getNomination(nominationId);
  if (!nom || nom.cycleId !== cycleId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Nomination not found.",
    });
  await getDb()
    .update(schema.awardNominations)
    .set({
      status: "winner",
      ratifiedByUserId: actor.id,
      ratifiedAt: new Date(),
    })
    .where(eq(schema.awardNominations.id, nominationId));
  if (nom.nomineeMemberId) {
    try {
      await notify(
        nom.nomineeMemberId,
        "Congratulations — your award has been ratified. 🏆",
        "recognition"
      );
    } catch {
      /* non-fatal */
    }
  }
  await audit(actor, "awards.winner.ratify", {
    type: "awardNomination",
    id: nominationId,
    detail: `cycle #${cycleId}`,
  });
  return { ok: true };
}
