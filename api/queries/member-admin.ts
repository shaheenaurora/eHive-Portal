import { and, desc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { audit } from "../lib/audit";
import { notify } from "./circle";
import { applyLifecycleTransition } from "../lib/lifecycle";
import {
  tierRank,
  VERIFY_TOKEN_TTL_MS,
  type MemberLifecycle,
} from "@contracts/constants";
import {
  type Actor,
  type ChangeCategory,
  type FieldChange,
  type ChangeSource,
  type Activity,
  HIGH_IMPACT,
  PROFILE_FIELDS,
  violatesFourEyes,
  canApprove,
  mergeActivity,
  summarise,
} from "../lib/member-change";
import { env } from "../lib/env";
import { createAuthToken } from "../lib/tokens";
import { sendVerifyEmail } from "../lib/auth-mail";

export {
  type Actor,
  type ChangeCategory,
  type FieldChange,
  type ChangeSource,
  type Activity,
  HIGH_IMPACT,
  PROFILE_FIELDS,
  violatesFourEyes,
  canApprove,
  mergeActivity,
} from "../lib/member-change";

/* --------------------------- data-bound helpers -------------------------- */

async function loadMemberUser(memberId: number) {
  const rows = await getDb()
    .select({
      member: schema.members,
      userName: schema.users.name,
      userEmail: schema.users.email,
      userId: schema.members.userId,
    })
    .from(schema.members)
    .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .where(eq(schema.members.id, memberId))
    .limit(1);
  const row = rows.at(0);
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
  return row;
}

/** Does the actor hold an active leadership role in the member's home chapter? */
export async function actorLeadsMemberChapter(
  actorUserId: number,
  memberId: number
): Promise<boolean> {
  const db = getDb();
  const m = (
    await db
      .select({ homeChapterId: schema.members.homeChapterId })
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1)
  ).at(0);
  if (!m?.homeChapterId) return false;
  const actorMember = (
    await db
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(eq(schema.members.userId, actorUserId))
      .limit(1)
  ).at(0);
  if (!actorMember) return false;
  const roles = await db
    .select({ id: schema.chapterRoles.id })
    .from(schema.chapterRoles)
    .where(
      and(
        eq(schema.chapterRoles.memberId, actorMember.id),
        eq(schema.chapterRoles.chapterId, m.homeChapterId),
        eq(schema.chapterRoles.status, "active")
      )
    )
    .limit(1);
  return roles.length > 0;
}

/** Diff a profile patch against the current record → the fields that changed. */
function diffProfile(
  current: {
    userName: string | null;
    userEmail: string | null;
    member: typeof schema.members.$inferSelect;
  },
  patch: Record<string, string | undefined>
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const [field, meta] of Object.entries(PROFILE_FIELDS)) {
    if (!(field in patch) || patch[field] === undefined) continue;
    const to = (patch[field] ?? "").trim();
    const from =
      field === "name"
        ? (current.userName ?? "")
        : field === "email"
          ? (current.userEmail ?? "")
          : (((current.member as Record<string, unknown>)[field] as
              string | null) ?? "");
    if ((from ?? "") === to) continue;
    out.push({ field, label: meta.label, from: from ?? "", to });
  }
  return out;
}

/** Write the profile changes to `users`/`members` in one go. When the email
 *  address changes, clear verification status so the new address must be
 *  confirmed before sensitive flows can resume. */
async function writeProfile(
  memberId: number,
  userId: number,
  userName: string | null,
  changes: FieldChange[]
) {
  const db = getDb();
  const userSet: Record<string, unknown> = {};
  const memberSet: Record<string, unknown> = {};
  let emailChanged = false;
  for (const c of changes) {
    const meta = PROFILE_FIELDS[c.field];
    if (!meta) continue;
    (meta.table === "users" ? userSet : memberSet)[c.field] = c.to;
    if (c.field === "email") emailChanged = true;
  }
  if (emailChanged) {
    const newEmail = (userSet.email as string).toLowerCase();
    const ownerEmail = env.ownerEmail.trim().toLowerCase();
    if (ownerEmail && newEmail === ownerEmail) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "That email address is reserved and cannot be assigned.",
      });
    }
    userSet.emailVerifiedAt = null;
  }
  if (Object.keys(userSet).length)
    await db
      .update(schema.users)
      .set(userSet)
      .where(eq(schema.users.id, userId));
  if (Object.keys(memberSet).length)
    await db
      .update(schema.members)
      .set(memberSet)
      .where(eq(schema.members.id, memberId));
  if (emailChanged) {
    const newEmail = userSet.email as string;
    try {
      const raw = await createAuthToken(userId, "verify", VERIFY_TOKEN_TTL_MS);
      await sendVerifyEmail(
        newEmail,
        userName ?? "",
        `${env.publicUrl}/verify-email?token=${raw}`
      );
    } catch (e) {
      // Non-fatal: the email change is persisted; verification can be resent.
      console.error("failed to send re-verification email", e);
    }
  }
}

const STATUS_ENUM = ["active", "paused", "cancelled"] as const;

/** Apply an approved/discretionary high-impact change to the member record. */
async function applyHighImpact(
  actor: Actor,
  memberId: number,
  category: ChangeCategory,
  changes: FieldChange[],
  reason: string | null
) {
  const db = getDb();
  const m = (
    await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1)
  ).at(0);
  if (!m) return;
  const to = changes[0]?.to ?? null;

  if (category === "tier" && to && to !== m.tier) {
    const type = tierRank(to) > tierRank(m.tier) ? "upgrade" : "downgrade";
    await db
      .update(schema.members)
      .set({ tier: to as never })
      .where(eq(schema.members.id, memberId));
    await db.insert(schema.membershipEvents).values({
      memberId,
      type,
      fromTier: m.tier,
      toTier: to,
      note: reason,
      status: "approved",
      decidedAt: new Date(),
    });
  } else if (
    category === "status" &&
    to &&
    (STATUS_ENUM as readonly string[]).includes(to) &&
    to !== m.status
  ) {
    await db
      .update(schema.members)
      .set({ status: to as never })
      .where(eq(schema.members.id, memberId));
    if (to !== "active") {
      await db.insert(schema.membershipEvents).values({
        memberId,
        type: to === "paused" ? "pause" : "cancel",
        note: reason,
      });
    }
  } else if (category === "lifecycle" && to && to !== m.lifecycleState) {
    await applyLifecycleTransition(memberId, to as MemberLifecycle, {
      actor,
      reason: reason ?? undefined,
    });
  }
}

/* ------------------------------- services ------------------------------- */

/** Immediate profile-field edit (no approval). Records an `applied` row so the
 *  member's activity ledger captures the change; audits and notifies. */
export async function applyProfileEdit(
  actor: Actor,
  memberId: number,
  patch: Record<string, string | undefined>,
  source: ChangeSource
) {
  const row = await loadMemberUser(memberId);
  const changes = diffProfile(row, patch);
  if (!changes.length) return { ok: true, changed: 0 };
  await writeProfile(memberId, row.userId, row.userName, changes);
  await getDb()
    .insert(schema.memberChangeRequests)
    .values({
      memberId,
      category: "profile",
      changes: JSON.stringify(changes),
      status: "applied",
      source,
      requestedByUserId: actor.id,
      requestedByEmail: actor.email,
      decidedByUserId: actor.id,
      decidedByEmail: actor.email,
      decidedAt: new Date(),
    });
  await audit(actor, "member.profile.edit", {
    type: "member",
    id: memberId,
    detail: summarise(changes),
  });
  try {
    await notify(
      memberId,
      `Your profile was updated (${changes.map(c => c.label).join(", ")}).`,
      "membership"
    );
  } catch {
    /* non-fatal */
  }
  return { ok: true, changed: changes.length };
}

/** File a pending change request (maker step). High-impact requires a reason. */
export async function proposeChange(
  actor: Actor,
  memberId: number,
  input: {
    category: ChangeCategory;
    changes: FieldChange[];
    reason?: string;
    source: ChangeSource;
  }
) {
  if (!input.changes.length)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to change." });
  if (HIGH_IMPACT.has(input.category) && !(input.reason ?? "").trim())
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A reason is required for this change.",
    });
  await loadMemberUser(memberId);
  const res = await getDb()
    .insert(schema.memberChangeRequests)
    .values({
      memberId,
      category: input.category,
      changes: JSON.stringify(input.changes),
      reason: input.reason ?? null,
      status: "pending",
      source: input.source,
      requestedByUserId: actor.id,
      requestedByEmail: actor.email,
    });
  await audit(actor, "member.change.propose", {
    type: "member",
    id: memberId,
    detail: `${input.category}: ${summarise(input.changes)}`,
  });
  return {
    ok: true,
    id: Number((res as unknown as { insertId?: number }).insertId ?? 0),
  };
}

/** Management-discretion path: a full admin applies a high-impact change now. */
export async function applyChangeNow(
  actor: Actor,
  memberId: number,
  input: { category: ChangeCategory; changes: FieldChange[]; reason?: string }
) {
  if (HIGH_IMPACT.has(input.category) && !(input.reason ?? "").trim())
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A reason is required for this change.",
    });
  await applyHighImpact(
    actor,
    memberId,
    input.category,
    input.changes,
    input.reason ?? null
  );
  await getDb()
    .insert(schema.memberChangeRequests)
    .values({
      memberId,
      category: input.category,
      changes: JSON.stringify(input.changes),
      reason: input.reason ?? null,
      status: "applied",
      source: "admin",
      requestedByUserId: actor.id,
      requestedByEmail: actor.email,
      decidedByUserId: actor.id,
      decidedByEmail: actor.email,
      decidedAt: new Date(),
    });
  await audit(actor, "member.change.apply_now", {
    type: "member",
    id: memberId,
    detail: `${input.category}: ${summarise(input.changes)}${input.reason ? ` (${input.reason})` : ""}`,
  });
  return { ok: true };
}

/** Approve or reject a pending request (checker step). Enforces four-eyes and
 *  the approver authorization. On approve the change is applied. */
export async function decideChange(
  actor: Actor,
  requestId: number,
  decision: "approve" | "reject",
  note?: string
) {
  const db = getDb();
  const req = (
    await db
      .select()
      .from(schema.memberChangeRequests)
      .where(eq(schema.memberChangeRequests.id, requestId))
      .limit(1)
  ).at(0);
  if (!req)
    throw new TRPCError({ code: "NOT_FOUND", message: "Request not found." });
  if (req.status !== "pending")
    throw new TRPCError({
      code: "CONFLICT",
      message: "This request was already decided.",
    });
  if (violatesFourEyes(actor.id, req.requestedByUserId))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can't approve your own request — it needs a second person.",
    });
  const leadsMemberChapter = await actorLeadsMemberChapter(
    actor.id,
    req.memberId
  );
  if (!canApprove(actor, { leadsMemberChapter }))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You're not authorised to decide this request.",
    });

  const changes = JSON.parse(req.changes) as FieldChange[];
  if (decision === "approve") {
    if (req.category === "profile") {
      const row = await loadMemberUser(req.memberId);
      await writeProfile(req.memberId, row.userId, row.userName, changes);
    } else {
      await applyHighImpact(
        actor,
        req.memberId,
        req.category as ChangeCategory,
        changes,
        req.reason
      );
    }
  }
  await db
    .update(schema.memberChangeRequests)
    .set({
      status: decision === "approve" ? "approved" : "rejected",
      decidedByUserId: actor.id,
      decidedByEmail: actor.email,
      decisionNote: note ?? null,
      decidedAt: new Date(),
    })
    .where(eq(schema.memberChangeRequests.id, requestId));

  await audit(actor, `member.change.${decision}`, {
    type: "member",
    id: req.memberId,
    detail: `${req.category}: ${summarise(changes)}`,
  });
  // Tell the member (on approve) and the person who requested it.
  const verb = decision === "approve" ? "approved" : "declined";
  if (decision === "approve") {
    try {
      await notify(
        req.memberId,
        `A change to your membership was approved (${changes.map(c => c.label).join(", ")}).`,
        "membership"
      );
    } catch {
      /* non-fatal */
    }
  }
  if (req.requestedByUserId) {
    const reqMember = (
      await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(eq(schema.members.userId, req.requestedByUserId))
        .limit(1)
    ).at(0);
    if (reqMember) {
      try {
        await notify(
          reqMember.id,
          `Your requested change was ${verb}${note ? `: ${note}` : "."}`,
          "membership"
        );
      } catch {
        /* non-fatal */
      }
    }
  }
  return { ok: true };
}

/** The approval queue. Corporate view (all pending) or chapter-scoped for leads. */
export async function listChangeRequests(
  opts: { chapterId?: number; memberId?: number; includeDecided?: boolean } = {}
) {
  const db = getDb();
  const requester = alias(schema.users, "requester");
  const wheres = [] as ReturnType<typeof eq>[];
  if (!opts.includeDecided)
    wheres.push(eq(schema.memberChangeRequests.status, "pending"));
  else
    wheres.push(
      inArray(schema.memberChangeRequests.status, [
        "pending",
        "approved",
        "rejected",
        "applied",
      ])
    );
  if (opts.chapterId)
    wheres.push(eq(schema.members.homeChapterId, opts.chapterId));
  if (opts.memberId)
    wheres.push(eq(schema.memberChangeRequests.memberId, opts.memberId));

  const rows = await db
    .select({
      req: schema.memberChangeRequests,
      memberName: schema.users.name,
      memberEmail: schema.users.email,
      chapterName: schema.chapters.name,
      requesterName: requester.name,
    })
    .from(schema.memberChangeRequests)
    .innerJoin(
      schema.members,
      eq(schema.members.id, schema.memberChangeRequests.memberId)
    )
    .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
    .leftJoin(
      schema.chapters,
      eq(schema.chapters.id, schema.members.homeChapterId)
    )
    .leftJoin(
      requester,
      eq(requester.id, schema.memberChangeRequests.requestedByUserId)
    )
    .where(and(...wheres))
    .orderBy(desc(schema.memberChangeRequests.createdAt))
    .limit(200);

  return rows.map(r => ({
    id: r.req.id,
    memberId: r.req.memberId,
    category: r.req.category,
    status: r.req.status,
    source: r.req.source,
    reason: r.req.reason,
    createdAt: r.req.createdAt,
    changes: JSON.parse(r.req.changes) as FieldChange[],
    memberName: r.memberName,
    memberEmail: r.memberEmail,
    chapterName: r.chapterName,
    requesterName: r.requesterName,
    requestedByUserId: r.req.requestedByUserId,
    decisionNote: r.req.decisionNote,
    decidedAt: r.req.decidedAt,
  }));
}

/* ------------------------- unified activity ledger ------------------------ */

const CAT_ICON: Record<string, string> = {
  profile: "✎",
  tier: "◈",
  status: "◔",
  lifecycle: "⭢",
  chapter: "⌂",
};

/** Everything that has happened to / been done by this member, one timeline. */
export async function memberActivity(memberId: number): Promise<Activity[]> {
  const db = getDb();
  const row = await loadMemberUser(memberId);
  const userId = row.userId;

  const [evs, reqs, auditRows, milestones, podRows, att, regs, saves] =
    await Promise.all([
      db
        .select()
        .from(schema.membershipEvents)
        .where(eq(schema.membershipEvents.memberId, memberId))
        .orderBy(desc(schema.membershipEvents.createdAt))
        .limit(60),
      db
        .select()
        .from(schema.memberChangeRequests)
        .where(eq(schema.memberChangeRequests.memberId, memberId))
        .orderBy(desc(schema.memberChangeRequests.createdAt))
        .limit(60),
      db
        .select()
        .from(schema.adminAuditLog)
        .where(
          and(
            inArray(schema.adminAuditLog.targetType, ["member", "user"]),
            or(
              eq(schema.adminAuditLog.targetId, String(memberId)),
              eq(schema.adminAuditLog.targetId, String(userId))
            )
          )
        )
        .orderBy(desc(schema.adminAuditLog.createdAt))
        .limit(60),
      db
        .select()
        .from(schema.onboardingMilestones)
        .where(eq(schema.onboardingMilestones.memberId, memberId))
        .orderBy(desc(schema.onboardingMilestones.completedAt))
        .limit(30),
      db
        .select({ pod: schema.pods.name, joinedAt: schema.podMembers.joinedAt })
        .from(schema.podMembers)
        .innerJoin(schema.pods, eq(schema.pods.id, schema.podMembers.podId))
        .where(eq(schema.podMembers.memberId, memberId)),
      db
        .select({
          status: schema.attendance.status,
          at: schema.attendance.markedAt,
          topic: schema.sessions.topic,
        })
        .from(schema.attendance)
        .innerJoin(
          schema.sessions,
          eq(schema.sessions.id, schema.attendance.sessionId)
        )
        .where(eq(schema.attendance.memberId, memberId))
        .orderBy(desc(schema.attendance.markedAt))
        .limit(30),
      db
        .select({
          title: schema.events.title,
          at: schema.events.startsAt,
          status: schema.eventRegs.status,
        })
        .from(schema.eventRegs)
        .innerJoin(
          schema.events,
          eq(schema.events.id, schema.eventRegs.eventId)
        )
        .where(eq(schema.eventRegs.memberId, memberId))
        .orderBy(desc(schema.events.startsAt))
        .limit(30),
      db
        .select()
        .from(schema.memberSaveCases)
        .where(eq(schema.memberSaveCases.memberId, memberId))
        .orderBy(desc(schema.memberSaveCases.openedAt))
        .limit(20),
    ]);

  const A: Activity[][] = [];
  A.push(
    evs.map(e => ({
      at: e.createdAt,
      kind: "membership",
      icon: "◈",
      title: `${e.type}${e.toTier && e.toTier !== e.fromTier ? ` → ${e.toTier}` : ""}${e.status === "pending" ? " (requested)" : e.status === "rejected" ? " (declined)" : ""}`,
      detail: e.note ?? undefined,
      actor: e.actorEmail ?? undefined,
    }))
  );
  A.push(
    reqs.map(r => {
      const ch = JSON.parse(r.changes) as FieldChange[];
      const label =
        r.status === "applied"
          ? "changed"
          : r.status === "pending"
            ? "change requested"
            : r.status;
      return {
        at: r.decidedAt ?? r.createdAt,
        kind: "change",
        icon: CAT_ICON[r.category] ?? "✎",
        title: `${r.category} ${label}`,
        detail: summarise(ch) + (r.reason ? ` — ${r.reason}` : ""),
        actor: r.decidedByEmail ?? r.requestedByEmail ?? undefined,
      };
    })
  );
  A.push(
    auditRows.map(a => ({
      at: a.createdAt,
      kind: "admin",
      icon: "❑",
      title: a.action,
      detail: a.detail ?? undefined,
      actor: a.actorEmail ?? undefined,
    }))
  );
  A.push(
    milestones.map(m => ({
      at: m.completedAt,
      kind: "onboarding",
      icon: "✓",
      title: `Milestone: ${m.milestone}`,
      detail: m.note ?? undefined,
    }))
  );
  A.push(
    podRows.map(p => ({
      at: p.joinedAt,
      kind: "pod",
      icon: "◍",
      title: `Joined pod ${p.pod}`,
    }))
  );
  A.push(
    att.map(a => ({
      at: a.at,
      kind: "session",
      icon: "◷",
      title: `Session ${a.status}`,
      detail: a.topic ?? undefined,
    }))
  );
  A.push(
    regs.map(r => ({
      at: r.at,
      kind: "event",
      icon: "◇",
      title: `Event: ${r.title}`,
      detail: r.status,
    }))
  );
  A.push(
    saves.map(s => ({
      at: s.openedAt,
      kind: "save",
      icon: "⛑",
      title: `Save case ${s.status}`,
      detail: s.reason,
    }))
  );

  return mergeActivity(A).slice(0, 120);
}
