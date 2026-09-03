/**
 * Constrained shortlist voting (Awards spec Part 1 — the member-vote mechanism).
 * Eligible members cast ONE equal vote over a pre-qualified shortlist. The same
 * anti-gaming rules apply everywhere: shortlist-only, one equal vote, no
 * self-voting, and voters in good standing (active, no open conduct case).
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { audit } from "../lib/audit";
import { conferVoteWinner } from "./award-records";
import { nomineeInUnit } from "./awards";

type Actor = { id: number; email: string };

const OPEN_CONDUCT = ["open", "reviewing", "escalated"] as const;

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

/** The shortlist a member can vote over, with the member's own current vote (so
 *  the UI can show it) — but NOT live tallies, to avoid a bandwagon effect. */
export async function voteShortlist(cycleId: number, voterMemberId: number) {
  const db = getDb();
  const cycle = await getCycle(cycleId);
  const open = cycle?.status === "judging";
  const nominee = alias(schema.users, "nominee");
  const nomineeMember = alias(schema.members, "nomineeMember");
  const options = await db
    .select({
      nominationId: schema.awardNominations.id,
      category: schema.awardNominations.category,
      nomineeMemberId: schema.awardNominations.nomineeMemberId,
      nomineeName: nominee.name,
      nomineeChapterName: schema.chapters.name,
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
  const mine = (
    await db
      .select({ nominationId: schema.awardVotes.nominationId })
      .from(schema.awardVotes)
      .where(
        and(
          eq(schema.awardVotes.cycleId, cycleId),
          eq(schema.awardVotes.voterMemberId, voterMemberId)
        )
      )
      .limit(1)
  ).at(0);
  return { open, options, myVote: mine?.nominationId ?? null };
}

/** Cast one equal vote for a shortlisted nominee. */
export async function castVote(
  voter: { memberId: number },
  cycleId: number,
  nominationId: number
) {
  const db = getDb();
  const cycle = await getCycle(cycleId);
  if (!cycle || cycle.status !== "judging")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Voting isn't open for this award.",
    });
  const now = new Date();
  if (cycle.opensAt && now < new Date(cycle.opensAt))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Voting hasn't opened yet.",
    });
  if (cycle.closesAt && now > new Date(cycle.closesAt))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Voting has closed.",
    });
  const voterMember = (
    await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, voter.memberId))
      .limit(1)
  ).at(0);
  if (!voterMember)
    throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
  // Scoped cycles: the voter must belong to the cycle's unit.
  if (
    cycle.level !== "network" &&
    cycle.unitId &&
    !(await nomineeInUnit(cycle.level, cycle.unitId, {
      nomineeMemberId: voter.memberId,
    }))
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can only vote in your own chapter or region.",
    });
  const nom = await getNomination(nominationId);
  if (!nom || nom.cycleId !== cycleId || nom.status !== "shortlisted")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "You can only vote for a shortlisted nominee.",
    });
  if (nom.nomineeMemberId === voter.memberId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "You can't vote for yourself.",
    });
  // Voter must be in good standing.
  const openCase = (
    await db
      .select({ id: schema.conductCases.id })
      .from(schema.conductCases)
      .where(
        and(
          eq(schema.conductCases.subjectMemberId, voter.memberId),
          inArray(schema.conductCases.status, [...OPEN_CONDUCT])
        )
      )
      .limit(1)
  ).at(0);
  if (openCase)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your account isn't eligible to vote right now.",
    });
  const existing = (
    await db
      .select({ id: schema.awardVotes.id })
      .from(schema.awardVotes)
      .where(
        and(
          eq(schema.awardVotes.cycleId, cycleId),
          eq(schema.awardVotes.voterMemberId, voter.memberId)
        )
      )
      .limit(1)
  ).at(0);
  if (existing)
    throw new TRPCError({
      code: "CONFLICT",
      message: "You've already voted in this award.",
    });
  await db.insert(schema.awardVotes).values({
    cycleId,
    nominationId,
    voterMemberId: voter.memberId,
  });
  return { ok: true };
}

export type VoteTallyRow = {
  nominationId: number;
  nomineeName: string | null;
  nomineeChapterName: string | null;
  nomineeMemberId: number | null;
  nomineeChapterId: number | null;
  votes: number;
};

/** Admin vote tally for a cycle, ranked by votes (tie-break: earlier nomination). */
export async function voteTally(cycleId: number): Promise<VoteTallyRow[]> {
  const db = getDb();
  const nominee = alias(schema.users, "nominee");
  const nomineeMember = alias(schema.members, "nomineeMember");
  const rows = await db
    .select({
      nominationId: schema.awardNominations.id,
      nomineeName: nominee.name,
      nomineeChapterName: schema.chapters.name,
      nomineeMemberId: schema.awardNominations.nomineeMemberId,
      nomineeChapterId: schema.awardNominations.nomineeChapterId,
      votes: sql<number>`count(${schema.awardVotes.id})`,
    })
    .from(schema.awardNominations)
    .leftJoin(
      schema.awardVotes,
      eq(schema.awardVotes.nominationId, schema.awardNominations.id)
    )
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
    )
    .groupBy(schema.awardNominations.id)
    .orderBy(
      desc(sql`count(${schema.awardVotes.id})`),
      schema.awardNominations.id
    );
  return rows.map(r => ({ ...r, votes: Number(r.votes) || 0 }));
}

/** Confer the vote winner (the shortlisted nominee with the most votes). */
export async function recordVoteWinner(
  actor: Actor,
  cycleId: number,
  nominationId: number
) {
  const cycle = await getCycle(cycleId);
  if (!cycle)
    throw new TRPCError({ code: "NOT_FOUND", message: "Cycle not found." });
  const tally = await voteTally(cycleId);
  const top = tally[0];
  if (!top || top.nominationId !== nominationId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Only the nominee with the most votes can be recorded as winner.",
    });
  // Integrity gate: no conferral while an open flag stands on this winner.
  const { assertCleared } = await import("./award-integrity");
  await assertCleared({
    nominationId,
    memberId: top.nomineeMemberId,
  });
  await getDb()
    .update(schema.awardNominations)
    .set({
      status: "winner",
      ratifiedByUserId: actor.id,
      ratifiedAt: new Date(),
    })
    .where(eq(schema.awardNominations.id, nominationId));
  await conferVoteWinner(
    actor,
    { id: cycle.id, name: cycle.name, level: cycle.level },
    { memberId: top.nomineeMemberId, chapterId: top.nomineeChapterId },
    top.votes
  );
  await audit(actor, "awards.vote.winner", {
    type: "awardNomination",
    id: nominationId,
    detail: `${top.votes} votes`,
  });
  return { ok: true };
}
