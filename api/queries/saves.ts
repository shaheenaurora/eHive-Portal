import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { SAVE_PLAYBOOK_STEPS, type SaveCaseStatus } from "@contracts/constants";
import { applyLifecycleTransition } from "../lib/lifecycle";

const OPEN_STATES: SaveCaseStatus[] = ["open", "working"];
const ALL_STEPS_MASK = (1 << SAVE_PLAYBOOK_STEPS.length) - 1;

/** The single open Save case for a member, if any. */
async function openCaseFor(memberId: number) {
  const rows = await getDb()
    .select()
    .from(schema.memberSaveCases)
    .where(
      and(
        eq(schema.memberSaveCases.memberId, memberId),
        inArray(schema.memberSaveCases.status, OPEN_STATES)
      )
    )
    .limit(1);
  return rows.at(0);
}

/** Find the best owner for a new save case: VP Membership, then President. */
async function pickSaveCaseOwner(
  chapterId: number | null
): Promise<number | null> {
  if (!chapterId) return null;
  const db = getDb();
  const roles = await db
    .select({ memberId: schema.chapterRoles.memberId, role: schema.chapterRoles.role })
    .from(schema.chapterRoles)
    .where(
      and(
        eq(schema.chapterRoles.chapterId, chapterId),
        eq(schema.chapterRoles.status, "active"),
        sql`${schema.chapterRoles.role} in ('vp_membership','president')`
      )
    );
  const vp = roles.find(r => r.role === "vp_membership");
  const pres = roles.find(r => r.role === "president");
  const chosen = vp ?? pres;
  if (!chosen) return null;
  const member = await db
    .select({ userId: schema.members.userId })
    .from(schema.members)
    .where(eq(schema.members.id, chosen.memberId))
    .limit(1);
  return member.at(0)?.userId ?? null;
}

/** Open a Save Playbook case for a member — idempotent: if one is already open,
 *  it's returned untouched. Called when a member is flagged At-Risk (by the
 *  scheduler or an admin) so the intervention is always tracked, never silent.
 *  Auto-assigns an owner and a 7-day SLA when the home chapter is known. */
export async function openSaveCase(
  memberId: number,
  reason: string,
  chapterId?: number | null
): Promise<number> {
  const existing = await openCaseFor(memberId);
  if (existing) return existing.id;
  const ownerUserId = await pickSaveCaseOwner(chapterId ?? null);
  const openedAt = new Date();
  const dueAt = new Date(openedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const res = await getDb()
    .insert(schema.memberSaveCases)
    .values({
      memberId,
      chapterId: chapterId ?? null,
      reason: reason.slice(0, 255),
      status: "open",
      stepsMask: 0,
      ownerUserId,
      openedAt,
      dueAt,
    });
  return Number((res as unknown as { insertId?: number }).insertId ?? 0);
}

/** A member recovered on their own (engagement standard met again). Close any
 *  open case as saved so the board reflects reality. Returns true if one closed. */
export async function autoCloseSaveOnRecovery(
  memberId: number,
  note = "Re-engaged — engagement standard met again."
): Promise<boolean> {
  const existing = await openCaseFor(memberId);
  if (!existing) return false;
  await getDb()
    .update(schema.memberSaveCases)
    .set({ status: "saved", resolution: note, closedAt: new Date() })
    .where(eq(schema.memberSaveCases.id, existing.id));
  return true;
}

export type SaveCaseRow = {
  id: number;
  memberId: number;
  memberName: string | null;
  tier: string | null;
  chapterId: number | null;
  chapterName: string | null;
  status: SaveCaseStatus;
  reason: string;
  ownerUserId: number | null;
  ownerName: string | null;
  stepsMask: number;
  stepsDone: number;
  stepsTotal: number;
  notes: string | null;
  resolution: string | null;
  openedAt: Date;
  closedAt: Date | null;
  dueAt: Date | null;
  daysOpen: number;
};

/** Days a case has been open (from openedAt to close, or to now if still open). */
function daysBetween(from: Date | string, to: Date | string | null): number {
  const end = to ? new Date(to).getTime() : Date.now();
  return Math.max(0, Math.floor((end - new Date(from).getTime()) / 86_400_000));
}

/** At-a-glance retention numbers for the Save Playbook board header. */
export async function saveCaseSummary(): Promise<{
  open: number;
  working: number;
  saved: number;
  lost: number;
  overdue: number;
  saveRate: number | null;
}> {
  const db = getDb();
  const byStatus = await db
    .select({ status: schema.memberSaveCases.status, n: sql<number>`count(*)` })
    .from(schema.memberSaveCases)
    .groupBy(schema.memberSaveCases.status);
  const [overdue] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.memberSaveCases)
    .where(
      and(
        inArray(schema.memberSaveCases.status, OPEN_STATES),
        sql`${schema.memberSaveCases.openedAt} < (now() - interval 7 day)`
      )
    );
  const counts: Record<SaveCaseStatus, number> = {
    open: 0,
    working: 0,
    saved: 0,
    lost: 0,
  };
  for (const r of byStatus) counts[r.status] = Number(r.n);
  const closed = counts.saved + counts.lost;
  return {
    ...counts,
    overdue: Number(overdue?.n ?? 0),
    saveRate: closed > 0 ? Math.round((counts.saved / closed) * 100) : null,
  };
}

/** Chapter-scoped Save Playbook board for officers. */
export async function listSaveCasesForChapter(
  chapterId: number,
  opts: { status?: "open" | "closed" | "all" } = {}
): Promise<SaveCaseRow[]> {
  const owner = alias(schema.users, "owner");
  const wanted = opts.status ?? "open";
  const rows = await getDb()
    .select({
      id: schema.memberSaveCases.id,
      memberId: schema.memberSaveCases.memberId,
      memberName: schema.users.name,
      tier: schema.members.tier,
      chapterId: schema.memberSaveCases.chapterId,
      chapterName: schema.chapters.name,
      status: schema.memberSaveCases.status,
      reason: schema.memberSaveCases.reason,
      ownerUserId: schema.memberSaveCases.ownerUserId,
      ownerName: owner.name,
      stepsMask: schema.memberSaveCases.stepsMask,
      notes: schema.memberSaveCases.notes,
      resolution: schema.memberSaveCases.resolution,
      openedAt: schema.memberSaveCases.openedAt,
      closedAt: schema.memberSaveCases.closedAt,
      dueAt: schema.memberSaveCases.dueAt,
    })
    .from(schema.memberSaveCases)
    .leftJoin(
      schema.members,
      eq(schema.members.id, schema.memberSaveCases.memberId)
    )
    .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .leftJoin(
      schema.chapters,
      eq(schema.chapters.id, schema.memberSaveCases.chapterId)
    )
    .leftJoin(owner, eq(owner.id, schema.memberSaveCases.ownerUserId))
    .where(
      and(
        eq(schema.members.homeChapterId, chapterId),
        wanted === "all"
          ? undefined
          : wanted === "open"
            ? inArray(schema.memberSaveCases.status, OPEN_STATES)
            : sql`${schema.memberSaveCases.status} not in ('open','working')`
      )
    )
    .orderBy(desc(schema.memberSaveCases.openedAt))
    .limit(500);

  return rows.map(r => ({
    ...r,
    stepsDone: popcount(r.stepsMask & ALL_STEPS_MASK),
    stepsTotal: SAVE_PLAYBOOK_STEPS.length,
    daysOpen: daysBetween(r.openedAt, r.closedAt),
  }));
}

/** Verify a save case belongs to the given chapter. Returns the case or throws. */
export async function requireSaveCaseInChapter(
  id: number,
  chapterId: number
) {
  const db = getDb();
  const row = await db
    .select({
      id: schema.memberSaveCases.id,
      memberId: schema.memberSaveCases.memberId,
      chapterId: schema.memberSaveCases.chapterId,
      status: schema.memberSaveCases.status,
    })
    .from(schema.memberSaveCases)
    .leftJoin(
      schema.members,
      eq(schema.members.id, schema.memberSaveCases.memberId)
    )
    .where(eq(schema.memberSaveCases.id, id))
    .limit(1);
  const c = row.at(0);
  if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Save case not found." });
  const caseChapterId = c.chapterId;
  if (caseChapterId !== chapterId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This save case is not in your chapter.",
    });
  }
  return c;
}

/** Board of Save cases with member/chapter/owner names joined. Open-first. */
export async function listSaveCases(
  opts: { status?: "open" | "closed" | "all" } = {}
): Promise<SaveCaseRow[]> {
  const owner = alias(schema.users, "owner");
  const wanted = opts.status ?? "open";
  const rows = await getDb()
    .select({
      id: schema.memberSaveCases.id,
      memberId: schema.memberSaveCases.memberId,
      memberName: schema.users.name,
      tier: schema.members.tier,
      chapterId: schema.memberSaveCases.chapterId,
      chapterName: schema.chapters.name,
      status: schema.memberSaveCases.status,
      reason: schema.memberSaveCases.reason,
      ownerUserId: schema.memberSaveCases.ownerUserId,
      ownerName: owner.name,
      stepsMask: schema.memberSaveCases.stepsMask,
      notes: schema.memberSaveCases.notes,
      resolution: schema.memberSaveCases.resolution,
      openedAt: schema.memberSaveCases.openedAt,
      closedAt: schema.memberSaveCases.closedAt,
      dueAt: schema.memberSaveCases.dueAt,
    })
    .from(schema.memberSaveCases)
    .leftJoin(
      schema.members,
      eq(schema.members.id, schema.memberSaveCases.memberId)
    )
    .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .leftJoin(
      schema.chapters,
      eq(schema.chapters.id, schema.memberSaveCases.chapterId)
    )
    .leftJoin(owner, eq(owner.id, schema.memberSaveCases.ownerUserId))
    .orderBy(desc(schema.memberSaveCases.openedAt))
    .limit(500);

  return rows
    .filter(
      r =>
        wanted === "all" ||
        (wanted === "open"
          ? OPEN_STATES.includes(r.status)
          : !OPEN_STATES.includes(r.status))
    )
    .map(r => ({
      ...r,
      stepsDone: popcount(r.stepsMask & ALL_STEPS_MASK),
      stepsTotal: SAVE_PLAYBOOK_STEPS.length,
      daysOpen: daysBetween(r.openedAt, r.closedAt),
    }));
}

/** Update the owner, step checklist, and/or notes on an open case. Toggling the
 *  last step to done does NOT auto-close — closing is an explicit outcome call. */
export async function updateSaveCase(
  id: number,
  patch: { ownerUserId?: number | null; stepsMask?: number; notes?: string }
): Promise<void> {
  const set: Record<string, unknown> = {};
  if (patch.ownerUserId !== undefined) set.ownerUserId = patch.ownerUserId;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.stepsMask !== undefined) {
    set.stepsMask = patch.stepsMask & ALL_STEPS_MASK;
    // Any progress moves an untouched case from "open" to "working".
    if ((patch.stepsMask & ALL_STEPS_MASK) > 0) set.status = statusOnProgress();
  }
  if (Object.keys(set).length) {
    await getDb()
      .update(schema.memberSaveCases)
      .set(set)
      .where(
        and(
          eq(schema.memberSaveCases.id, id),
          inArray(schema.memberSaveCases.status, OPEN_STATES)
        )
      );
  }
}

/** Close a case with an explicit outcome. On "saved" the member's CRM lifecycle
 *  is returned to Active; on "lost" the lifecycle is left for the renewal/lapse
 *  flow to handle. Returns the memberId so callers can audit/notify. */
export async function closeSaveCase(
  id: number,
  outcome: "saved" | "lost",
  resolution?: string
): Promise<number | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.memberSaveCases)
    .where(eq(schema.memberSaveCases.id, id))
    .limit(1);
  const c = rows.at(0);
  if (!c || !OPEN_STATES.includes(c.status)) return null;
  await db
    .update(schema.memberSaveCases)
    .set({
      status: outcome,
      resolution: resolution ?? null,
      closedAt: new Date(),
    })
    .where(eq(schema.memberSaveCases.id, id));
  if (outcome === "saved") {
    // Only clear the at-risk flag — never override a renewal/suspended state.
    // The lifecycle helper enforces the transition matrix and keeps status coherent.
    await applyLifecycleTransition(c.memberId, "active", {
      reason: resolution || "Save case closed as saved",
      audit: false,
    }).catch(() => {
      /* ignore invalid transitions — member may have moved on */
    });
  }
  return c.memberId;
}

/** Reverse a close: put a saved/lost case back to open (undo the outcome). */
export async function reopenSaveCase(id: number): Promise<boolean> {
  const rows = await getDb()
    .select()
    .from(schema.memberSaveCases)
    .where(eq(schema.memberSaveCases.id, id))
    .limit(1);
  const c = rows.at(0);
  if (!c || OPEN_STATES.includes(c.status)) return false;
  await getDb()
    .update(schema.memberSaveCases)
    .set({
      status: c.stepsMask > 0 ? "working" : "open",
      resolution: null,
      closedAt: null,
    })
    .where(eq(schema.memberSaveCases.id, id));
  return true;
}

function statusOnProgress(): SaveCaseStatus {
  return "working";
}
function popcount(n: number): number {
  let c = 0;
  while (n) {
    c += n & 1;
    n >>>= 1;
  }
  return c;
}

/** Open a Save case for every active member currently flagged At-Risk that
 *  doesn't already have one. For members flagged before the playbook existed
 *  (e.g. seeded/demo data set directly to at_risk rather than transitioned).
 *  Idempotent. Returns how many cases were opened. */
export async function backfillAtRiskSaves(): Promise<number> {
  const rows = await getDb()
    .select({
      id: schema.members.id,
      homeChapterId: schema.members.homeChapterId,
    })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.status, "active"),
        eq(schema.members.lifecycleState, "at_risk")
      )
    );
  let opened = 0;
  for (const m of rows) {
    const existing = await openCaseFor(m.id);
    if (existing) continue;
    await openSaveCase(
      m.id,
      "Flagged at-risk — engagement below standard.",
      m.homeChapterId
    );
    opened++;
  }
  return opened;
}
