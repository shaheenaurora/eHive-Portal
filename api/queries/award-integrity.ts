/**
 * Integrity layer (Awards spec Part 8). Runs the anti-gaming and conflict scan
 * over a cycle, records IntegrityFlags, and gates conferral so no winner is
 * confirmed while an OPEN flag stands. An officer must clear or uphold each flag
 * first — surfacing conflicts before ratification, exactly as the spec requires.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { audit } from "../lib/audit";
import {
  detectVoteVelocity,
  isReciprocitySuspicious,
  VOTE_VELOCITY_WINDOW_MS,
  VOTE_VELOCITY_BURST,
  RECIPROCITY_THRESHOLD,
} from "../lib/awards-integrity";

type Actor = { id: number; email: string };

type FlagKind = "conflict" | "reciprocity" | "vote_velocity" | "conduct";
const OPEN_CONDUCT = ["open", "reviewing", "escalated"] as const;

async function judgeMemberIds(cycleId: number): Promise<Set<number>> {
  const db = getDb();
  const judges = await db
    .select({ userId: schema.awardJudges.userId })
    .from(schema.awardJudges)
    .where(eq(schema.awardJudges.cycleId, cycleId));
  const userIds = judges.map(j => j.userId);
  if (userIds.length === 0) return new Set();
  const members = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(inArray(schema.members.userId, userIds));
  return new Set(members.map(m => m.id));
}

/** Insert an auto-flag unless an equivalent OPEN one already exists (idempotent
 *  re-scans don't pile up duplicates). */
async function upsertAutoFlag(flag: {
  cycleId: number;
  nominationId: number | null;
  memberId: number | null;
  kind: FlagKind;
  severity: "info" | "warn" | "block";
  detail: string;
}): Promise<boolean> {
  const db = getDb();
  const dupe = (
    await db
      .select({ id: schema.awardIntegrityFlags.id })
      .from(schema.awardIntegrityFlags)
      .where(
        and(
          eq(schema.awardIntegrityFlags.cycleId, flag.cycleId),
          eq(schema.awardIntegrityFlags.kind, flag.kind),
          eq(schema.awardIntegrityFlags.status, "open"),
          isNull(schema.awardIntegrityFlags.raisedByUserId),
          flag.nominationId == null
            ? isNull(schema.awardIntegrityFlags.nominationId)
            : eq(schema.awardIntegrityFlags.nominationId, flag.nominationId)
        )
      )
      .limit(1)
  ).at(0);
  if (dupe) return false;
  await db.insert(schema.awardIntegrityFlags).values({
    cycleId: flag.cycleId,
    nominationId: flag.nominationId,
    memberId: flag.memberId,
    kind: flag.kind,
    severity: flag.severity,
    detail: flag.detail.slice(0, 500),
    raisedByUserId: null,
  });
  return true;
}

/** Run every automated integrity check over a cycle's shortlisted nominees and
 *  its votes; returns how many new flags were raised. */
export async function scanCycleIntegrity(actor: Actor, cycleId: number) {
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

  const noms = await db
    .select({
      id: schema.awardNominations.id,
      nomineeMemberId: schema.awardNominations.nomineeMemberId,
      nominatedByMemberId: schema.awardNominations.nominatedByMemberId,
    })
    .from(schema.awardNominations)
    .where(
      and(
        eq(schema.awardNominations.cycleId, cycleId),
        eq(schema.awardNominations.status, "shortlisted")
      )
    );

  const judges = await judgeMemberIds(cycleId);

  // Open conduct cases across the shortlisted nominees.
  const nomineeIds = noms
    .map(n => n.nomineeMemberId)
    .filter((v): v is number => v != null);
  const openConduct = new Set<number>();
  if (nomineeIds.length) {
    for (const r of await db
      .select({ memberId: schema.conductCases.subjectMemberId })
      .from(schema.conductCases)
      .where(
        and(
          inArray(schema.conductCases.subjectMemberId, nomineeIds),
          inArray(schema.conductCases.status, [...OPEN_CONDUCT])
        )
      ))
      if (r.memberId != null) openConduct.add(r.memberId);
  }

  let created = 0;

  for (const n of noms) {
    // Officer self-dealing / connected judge (conflict).
    const nomineeIsJudge =
      n.nomineeMemberId != null && judges.has(n.nomineeMemberId);
    const nominatorIsJudge =
      n.nominatedByMemberId != null && judges.has(n.nominatedByMemberId);
    if (nomineeIsJudge || nominatorIsJudge) {
      const why = nomineeIsJudge
        ? "Nominee is a judge of this cycle."
        : "Nominated by a judge of this cycle.";
      if (
        await upsertAutoFlag({
          cycleId,
          nominationId: n.id,
          memberId: n.nomineeMemberId,
          kind: "conflict",
          severity: "block",
          detail: why,
        })
      )
        created++;
    }

    // Open conduct/moderation case (should be cleared before conferral).
    if (n.nomineeMemberId != null && openConduct.has(n.nomineeMemberId)) {
      if (
        await upsertAutoFlag({
          cycleId,
          nominationId: n.id,
          memberId: n.nomineeMemberId,
          kind: "conduct",
          severity: "block",
          detail: "Nominee has an open conduct/moderation case.",
        })
      )
        created++;
    }

    // Reciprocity / mutual-crediting collusion between nominee and nominator.
    if (n.nomineeMemberId != null && n.nominatedByMemberId != null) {
      const a = n.nomineeMemberId;
      const b = n.nominatedByMemberId;
      const mutual = (
        await db
          .select({ c: sql<number>`count(*)` })
          .from(schema.oneToOnes)
          .where(
            and(
              eq(schema.oneToOnes.status, "confirmed"),
              sql`((${schema.oneToOnes.aMemberId} = ${a} and ${schema.oneToOnes.bMemberId} = ${b}) or (${schema.oneToOnes.aMemberId} = ${b} and ${schema.oneToOnes.bMemberId} = ${a}))`
            )
          )
      ).at(0);
      const count = Number(mutual?.c) || 0;
      if (isReciprocitySuspicious(count)) {
        if (
          await upsertAutoFlag({
            cycleId,
            nominationId: n.id,
            memberId: a,
            kind: "reciprocity",
            severity: "warn",
            detail: `${count} reciprocal 1-2-1s with the nominator (≥${RECIPROCITY_THRESHOLD}).`,
          })
        )
          created++;
      }
    }
  }

  // Vote brigading — bursts of votes for one nominee.
  const votes = await db
    .select({
      nominationId: schema.awardVotes.nominationId,
      createdAt: schema.awardVotes.createdAt,
    })
    .from(schema.awardVotes)
    .where(eq(schema.awardVotes.cycleId, cycleId));
  const hits = detectVoteVelocity(
    votes.map(v => ({
      nominationId: v.nominationId,
      atMs: new Date(v.createdAt).getTime(),
    })),
    { windowMs: VOTE_VELOCITY_WINDOW_MS, burstThreshold: VOTE_VELOCITY_BURST }
  );
  for (const h of hits) {
    if (
      await upsertAutoFlag({
        cycleId,
        nominationId: h.nominationId,
        memberId: null,
        kind: "vote_velocity",
        severity: "warn",
        detail: `${h.burst} votes within ${Math.round(h.windowMs / 1000)}s — possible brigading.`,
      })
    )
      created++;
  }

  await audit(actor, "awards.integrity.scan", {
    type: "awardCycle",
    id: cycleId,
    detail: `${created} new flag(s)`,
  });
  return { ok: true, created };
}

export type IntegrityFlagRow = {
  id: number;
  nominationId: number | null;
  memberId: number | null;
  nomineeName: string | null;
  kind: string;
  severity: string;
  detail: string;
  status: string;
  auto: boolean;
  resolutionNote: string | null;
  createdAt: Date;
};

/** All flags for a cycle, open first, newest first, with nominee names. */
export async function listFlags(cycleId: number): Promise<IntegrityFlagRow[]> {
  const nominee = alias(schema.users, "nominee");
  const nomineeMember = alias(schema.members, "nomineeMember");
  const rows = await getDb()
    .select({
      id: schema.awardIntegrityFlags.id,
      nominationId: schema.awardIntegrityFlags.nominationId,
      memberId: schema.awardIntegrityFlags.memberId,
      nomineeName: nominee.name,
      kind: schema.awardIntegrityFlags.kind,
      severity: schema.awardIntegrityFlags.severity,
      detail: schema.awardIntegrityFlags.detail,
      status: schema.awardIntegrityFlags.status,
      raisedByUserId: schema.awardIntegrityFlags.raisedByUserId,
      resolutionNote: schema.awardIntegrityFlags.resolutionNote,
      createdAt: schema.awardIntegrityFlags.createdAt,
    })
    .from(schema.awardIntegrityFlags)
    .leftJoin(
      nomineeMember,
      eq(nomineeMember.id, schema.awardIntegrityFlags.memberId)
    )
    .leftJoin(nominee, eq(nominee.id, nomineeMember.userId))
    .where(eq(schema.awardIntegrityFlags.cycleId, cycleId))
    .orderBy(desc(schema.awardIntegrityFlags.id))
    .limit(200);
  return rows
    .map(r => ({
      id: r.id,
      nominationId: r.nominationId,
      memberId: r.memberId,
      nomineeName: r.nomineeName,
      kind: r.kind,
      severity: r.severity,
      detail: r.detail,
      status: r.status,
      auto: r.raisedByUserId == null,
      resolutionNote: r.resolutionNote,
      createdAt: r.createdAt,
    }))
    .sort((a, b) => {
      // Open flags first.
      if ((a.status === "open") !== (b.status === "open"))
        return a.status === "open" ? -1 : 1;
      return b.id - a.id;
    });
}

/** Raise a manual integrity flag. */
export async function raiseFlag(
  actor: Actor,
  input: {
    cycleId: number;
    nominationId?: number | null;
    memberId?: number | null;
    detail: string;
    severity?: "info" | "warn" | "block";
  }
) {
  await getDb()
    .insert(schema.awardIntegrityFlags)
    .values({
      cycleId: input.cycleId,
      nominationId: input.nominationId ?? null,
      memberId: input.memberId ?? null,
      kind: "manual",
      severity: input.severity ?? "warn",
      detail: input.detail.slice(0, 500),
      raisedByUserId: actor.id,
    });
  await audit(actor, "awards.integrity.raise", {
    type: "awardCycle",
    id: input.cycleId,
    detail: input.detail.slice(0, 120),
  });
  return { ok: true };
}

/** Resolve a flag — clear it (concern dismissed) or uphold it (concern stands). */
export async function resolveFlag(
  actor: Actor,
  flagId: number,
  decision: "clear" | "uphold",
  note?: string
) {
  const flag = (
    await getDb()
      .select()
      .from(schema.awardIntegrityFlags)
      .where(eq(schema.awardIntegrityFlags.id, flagId))
      .limit(1)
  ).at(0);
  if (!flag)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flag not found." });
  await getDb()
    .update(schema.awardIntegrityFlags)
    .set({
      status: decision === "clear" ? "cleared" : "upheld",
      resolvedByUserId: actor.id,
      resolutionNote: note?.slice(0, 500) ?? null,
      resolvedAt: new Date(),
    })
    .where(eq(schema.awardIntegrityFlags.id, flagId));
  await audit(actor, `awards.integrity.${decision}`, {
    type: "awardCycle",
    id: flag.cycleId,
    detail: `flag #${flagId}`,
  });
  return { ok: true };
}

/** Throw if a winner about to be conferred still has an OPEN integrity flag —
 *  either on the nomination or on the member. The conferral gate. */
export async function assertCleared(input: {
  nominationId?: number | null;
  memberId?: number | null;
}): Promise<void> {
  const conds = [eq(schema.awardIntegrityFlags.status, "open")];
  const targets = [];
  if (input.nominationId != null)
    targets.push(
      eq(schema.awardIntegrityFlags.nominationId, input.nominationId)
    );
  if (input.memberId != null)
    targets.push(eq(schema.awardIntegrityFlags.memberId, input.memberId));
  if (targets.length === 0) return;
  const or =
    targets.length === 1 ? targets[0] : sql`(${sql.join(targets, sql` or `)})`;
  const open = (
    await getDb()
      .select({ id: schema.awardIntegrityFlags.id })
      .from(schema.awardIntegrityFlags)
      .where(and(...conds, or))
      .limit(1)
  ).at(0);
  if (open)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This winner has an open integrity flag — clear or uphold it before conferral.",
    });
}
