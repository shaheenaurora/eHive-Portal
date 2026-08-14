/**
 * Conferral (Awards spec Part 7, gate 5) — records a conferred award as an
 * immutable AwardRecord, awards recognition points, and enforces the fairness
 * cap (no back-to-back auto wins). Shared by the auto-score and panel paths.
 */
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { audit } from "../lib/audit";
import { notify, awardPoints } from "./circle";
import { isBackToBack } from "../lib/awards-scoring";
import {
  AWARD_FAIRNESS_WINDOW_DAYS,
  AWARD_RECOGNITION_POINTS,
  HALL_OF_FAME_AWARD_KEY,
} from "@contracts/constants";
import { autoScoreCycle } from "./award-autoscore";

type Actor = { id: number; email: string };

/** A stable award key from a cycle name, e.g. "Member of the Month" → "member_of_the_month". */
export function awardKeyFromName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "award"
  );
}

async function mostRecentWin(
  awardKey: string,
  memberId: number
): Promise<Date | null> {
  const row = (
    await getDb()
      .select({ conferredAt: schema.awardRecords.conferredAt })
      .from(schema.awardRecords)
      .where(
        and(
          eq(schema.awardRecords.awardKey, awardKey),
          eq(schema.awardRecords.memberId, memberId)
        )
      )
      .orderBy(desc(schema.awardRecords.conferredAt))
      .limit(1)
  ).at(0);
  return row?.conferredAt ? new Date(row.conferredAt) : null;
}

/** Insert an AwardRecord, award recognition points to a member winner, notify
 *  and audit. Shared low-level conferral used by both mechanisms. */
async function confer(
  actor: Actor,
  rec: {
    cycleId: number | null;
    awardKey: string;
    label: string;
    level: "network" | "chapter" | "zone" | "region" | "country";
    memberId?: number | null;
    chapterId?: number | null;
    source: "auto" | "panel" | "vote";
    score?: number | null;
    /** Recognition points; defaults to the standard win value. */
    points?: number;
  }
) {
  const db = getDb();
  const points = rec.points ?? AWARD_RECOGNITION_POINTS;
  const res = await db.insert(schema.awardRecords).values({
    cycleId: rec.cycleId ?? null,
    awardKey: rec.awardKey,
    label: rec.label.slice(0, 160),
    level: rec.level,
    memberId: rec.memberId ?? null,
    chapterId: rec.chapterId ?? null,
    source: rec.source,
    score: rec.score ?? null,
    points,
    conferredByUserId: actor.id,
  });
  const recordId = Number(
    (res as unknown as { insertId?: number }).insertId ?? 0
  );
  if (rec.memberId) {
    try {
      await awardPoints(rec.memberId, "recognition", points, rec.label);
      await notify(
        rec.memberId,
        `You've been recognised: ${rec.label}. 🏆`,
        "recognition"
      );
    } catch {
      /* non-fatal */
    }
  }
  await audit(actor, "awards.conferred", {
    type: "awardCycle",
    id: rec.cycleId ?? recordId,
    detail: `${rec.label} · ${rec.source}${rec.memberId ? ` · member #${rec.memberId}` : ""}`,
  });
  return { ok: true, recordId };
}

/** Confer an award from a panel ratification (no fairness cap — panel awards are
 *  annual). Called by ratifyWinner after the winner is set. */
export async function conferPanelWinner(
  actor: Actor,
  cycle: {
    id: number;
    name: string;
    level: "network" | "chapter" | "zone" | "region" | "country";
  },
  nominee: { memberId?: number | null; chapterId?: number | null },
  score?: number | null
) {
  return confer(actor, {
    cycleId: cycle.id,
    awardKey: awardKeyFromName(cycle.name),
    label: cycle.name,
    level: cycle.level,
    memberId: nominee.memberId,
    chapterId: nominee.chapterId,
    source: "panel",
    score: score ?? null,
  });
}

/** Confer an award from a member vote (no fairness cap — People's Choice etc.). */
export async function conferVoteWinner(
  actor: Actor,
  cycle: {
    id: number;
    name: string;
    level: "network" | "chapter" | "zone" | "region" | "country";
  },
  nominee: { memberId?: number | null; chapterId?: number | null },
  votes: number
) {
  return confer(actor, {
    cycleId: cycle.id,
    awardKey: awardKeyFromName(cycle.name),
    label: cycle.name,
    level: cycle.level,
    memberId: nominee.memberId,
    chapterId: nominee.chapterId,
    source: "vote",
    score: votes,
  });
}

/** Confer a Hall of Fame induction — a permanent, network-level lifetime honour
 *  carrying its own (larger) recognition-point value. Ratified by a panel/admin;
 *  eligibility and the annual intake cap are enforced by the caller. */
export async function conferHallOfFame(
  actor: Actor,
  member: { memberId: number },
  score: number,
  points: number,
  label = "Hall of Fame"
) {
  return confer(actor, {
    cycleId: null,
    awardKey: HALL_OF_FAME_AWARD_KEY,
    label,
    level: "network",
    memberId: member.memberId,
    source: "panel",
    score,
    points,
  });
}

/** Confer the auto-scored winner of a cycle. Verifies the member is the top of
 *  the computed board ("the data decides", not a hand-pick) and enforces the
 *  no-back-to-back fairness cap. */
export async function recordAutoWinner(
  actor: Actor,
  cycleId: number,
  memberId: number
) {
  const cycle = (
    await getDb()
      .select()
      .from(schema.awardCycles)
      .where(eq(schema.awardCycles.id, cycleId))
      .limit(1)
  ).at(0);
  if (!cycle)
    throw new TRPCError({ code: "NOT_FOUND", message: "Cycle not found." });

  const board = await autoScoreCycle(cycleId);
  const top = board.rows[0];
  if (!top || top.memberId !== memberId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Only the top-ranked member on the auto-score board can be recorded as the winner.",
    });

  const awardKey = awardKeyFromName(cycle.name);
  const prior = await mostRecentWin(awardKey, memberId);
  if (
    isBackToBack(
      prior?.getTime() ?? null,
      Date.now(),
      AWARD_FAIRNESS_WINDOW_DAYS
    )
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This member won the same award recently — recognition rotates (no back-to-back wins).",
    });

  return confer(actor, {
    cycleId,
    awardKey,
    label: cycle.name,
    level: cycle.level,
    memberId,
    source: "auto",
    score: top.total,
  });
}

/** A member's conferred awards, newest first (for the profile / Hall of Fame). */
export async function memberAwards(memberId: number) {
  return getDb()
    .select({
      id: schema.awardRecords.id,
      awardKey: schema.awardRecords.awardKey,
      label: schema.awardRecords.label,
      level: schema.awardRecords.level,
      source: schema.awardRecords.source,
      score: schema.awardRecords.score,
      points: schema.awardRecords.points,
      conferredAt: schema.awardRecords.conferredAt,
    })
    .from(schema.awardRecords)
    .where(eq(schema.awardRecords.memberId, memberId))
    .orderBy(desc(schema.awardRecords.conferredAt))
    .limit(100);
}
