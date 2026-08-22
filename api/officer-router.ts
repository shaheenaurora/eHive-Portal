import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull, desc, asc, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { createRouter, mergeRouters, authedQuery } from "./middleware";
import { notify } from "./queries/circle";
import { computeChapterHealth } from "./queries/health";
import { computeOnboarding } from "./queries/onboarding";
import {
  ensureCadenceTemplates,
  listCadences,
  recordCadence,
  reopenCadence,
} from "./queries/cadence";
import { audit } from "./lib/audit";
import { safeUrl } from "./lib/url";
import {
  applyProfileEdit,
  proposeChange,
  decideChange,
  listChangeRequests,
} from "./queries/member-admin";
import { CADENCE_STATUSES } from "@contracts/cadence";
import { ROLE_ONBOARDING_STEPS } from "@contracts/constants";
import { requireOfficer, inChapter } from "./officer/shared";
import { officerGovernanceRouter } from "./officer/governance";
import { officerFinanceRouter } from "./officer/finance";
import { officerEventsRouter } from "./officer/events";
import { officerRegionalRouter } from "./officer/regional";

const officerCoreRouter = createRouter({
  /* Console overview: roster with mentor/onboarding status + learnings. */
  overview: authedQuery.query(async ({ ctx }) => {
    const { chapterId, roleKeys, member } = await requireOfficer(ctx.user.id);
    const db = getDb();
    const chapter = (
      await db
        .select()
        .from(schema.chapters)
        .where(
          and(
            eq(schema.chapters.id, chapterId),
            isNull(schema.chapters.deletedAt)
          )
        )
        .limit(1)
    ).at(0);
    const roster = await db
      .select({ member: schema.members, user: schema.users })
      .from(schema.members)
      .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.members.homeChapterId, chapterId))
      .orderBy(asc(schema.users.name))
      .limit(300);
    // Mentor pairings inside the chapter (buddy = mentor, newMember = mentee).
    const pairs = await db.select().from(schema.buddies);
    const menteeIds = new Set(pairs.map(p => p.newMemberId));
    const rosterIds = new Set(roster.map(r => r.member.id));
    const chapterPairs = pairs.filter(
      p => rosterIds.has(p.newMemberId) && rosterIds.has(p.buddyMemberId)
    );
    const learnings = await db
      .select({ post: schema.chapterPosts, name: schema.users.name })
      .from(schema.chapterPosts)
      .leftJoin(
        schema.members,
        eq(schema.members.id, schema.chapterPosts.authorMemberId)
      )
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.chapterPosts.chapterId, chapterId))
      .orderBy(desc(schema.chapterPosts.createdAt))
      .limit(50);
    const health = await computeChapterHealth(chapterId);
    const cadence = await listCadences(chapterId);
    // ML — this officer's own active appointments + their onboarding-playbook progress.
    const myRoles = await db
      .select({
        id: schema.chapterRoles.id,
        role: schema.chapterRoles.role,
        title: schema.chapterRoles.title,
        onboardingMask: schema.chapterRoles.onboardingMask,
        termStart: schema.chapterRoles.termStart,
      })
      .from(schema.chapterRoles)
      .where(
        and(
          eq(schema.chapterRoles.memberId, member.id),
          eq(schema.chapterRoles.status, "active")
        )
      )
      .orderBy(asc(schema.chapterRoles.createdAt));
    // Onboarding cohort — members still in their first 90 days (ML-03).
    const onboardingMembers = roster.filter(
      r => r.member.lifecycleState === "onboarding"
    );
    const onboarding = await Promise.all(
      onboardingMembers.map(async r => {
        const p = await computeOnboarding(r.member);
        return {
          id: r.member.id,
          name: r.user.name ?? r.user.email ?? "Member",
          percent: p.percent,
          doneCount: p.doneCount,
          total: p.total,
          dayCount: p.dayCount,
          stage: p.stage,
        };
      })
    );
    return {
      chapter,
      roleKeys,
      health,
      cadence,
      onboarding,
      myRoles,
      roster: roster.map(r => ({
        id: r.member.id,
        name: r.user.name ?? r.user.email ?? "Member",
        company: r.member.company,
        tier: r.member.tier,
        status: r.member.status,
        hasMentor: menteeIds.has(r.member.id),
      })),
      mentorPairs: chapterPairs.map(p => ({
        id: p.id,
        menteeId: p.newMemberId,
        mentorId: p.buddyMemberId,
        checkedIn: !!p.checkinAt,
      })),
      learnings: learnings.map(l => ({
        ...l.post,
        authorName: l.name ?? "Officer",
      })),
    };
  }),

  /* Role Onboarding Playbook — the holder ticks off their own first-90-days
     steps. Only the officer who holds the appointment can update it. */
  updateRoleOnboarding: authedQuery
    .input(
      z.object({ roleId: z.number(), mask: z.number().int().min(0).max(1023) })
    )
    .mutation(async ({ ctx, input }) => {
      const { member } = await requireOfficer(ctx.user.id);
      const db = getDb();
      const row = (
        await db
          .select()
          .from(schema.chapterRoles)
          .where(eq(schema.chapterRoles.id, input.roleId))
          .limit(1)
      ).at(0);
      if (!row || row.memberId !== member.id || row.status !== "active")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That isn't one of your active roles.",
        });
      const ALL = (1 << ROLE_ONBOARDING_STEPS.length) - 1;
      await db
        .update(schema.chapterRoles)
        .set({ onboardingMask: input.mask & ALL })
        .where(eq(schema.chapterRoles.id, input.roleId));
      await audit(ctx.user, "role.onboarding.update", {
        type: "chapterRole",
        id: input.roleId,
        detail: `${row.role} onboarding`,
      });
      return { ok: true };
    }),

  /* Unassigned active members the officer can sign up into their chapter. */
  signupCandidates: authedQuery
    .input(z.object({ q: z.string().max(120).optional() }))
    .query(async ({ ctx, input }) => {
      await requireOfficer(ctx.user.id);
      const db = getDb();
      const conds = [
        eq(schema.members.status, "active"),
        isNull(schema.members.homeChapterId),
      ];
      if (input.q) {
        const like = `%${input.q}%`;
        conds.push(
          sql`(${schema.users.name} like ${like} or ${schema.users.email} like ${like} or ${schema.members.company} like ${like})`
        );
      }
      const rows = await db
        .select({
          id: schema.members.id,
          name: schema.users.name,
          email: schema.users.email,
          company: schema.members.company,
        })
        .from(schema.members)
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(and(...conds))
        .orderBy(asc(schema.users.name))
        .limit(40);
      return rows;
    }),

  /* Sign an unassigned member up into the chapter (onboarding). Members who
     already have a chapter must go through a transfer request, not this. */
  signupMember: authedQuery
    .input(z.object({ memberId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { chapterId } = await requireOfficer(ctx.user.id);
      const db = getDb();
      const m = (
        await db
          .select()
          .from(schema.members)
          .where(eq(schema.members.id, input.memberId))
          .limit(1)
      ).at(0);
      if (!m)
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      if (m.homeChapterId && m.homeChapterId !== chapterId)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "They belong to another chapter — they must request a transfer.",
        });
      await db
        .update(schema.members)
        .set({ homeChapterId: chapterId })
        .where(eq(schema.members.id, m.id));
      await notify(
        m.id,
        "You've been added to a chapter. Welcome — say hello to your chapter leadership.",
        "connect"
      );
      return { ok: true };
    }),

  /* Assign a mentor to a member — both must be in the officer's chapter. */
  assignMentor: authedQuery
    .input(z.object({ menteeId: z.number(), mentorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { chapterId } = await requireOfficer(ctx.user.id);
      if (input.menteeId === input.mentorId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A member can't mentor themselves.",
        });
      const db = getDb();
      await inChapter(input.menteeId, chapterId);
      await inChapter(input.mentorId, chapterId);
      const existing = await db
        .select()
        .from(schema.buddies)
        .where(
          and(
            eq(schema.buddies.newMemberId, input.menteeId),
            isNull(schema.buddies.checkinAt)
          )
        )
        .limit(1);
      if (existing.length) {
        await db
          .update(schema.buddies)
          .set({ buddyMemberId: input.mentorId, pairedAt: new Date() })
          .where(eq(schema.buddies.id, existing[0].id));
      } else {
        await db.insert(schema.buddies).values({
          newMemberId: input.menteeId,
          buddyMemberId: input.mentorId,
        });
      }
      await notify(
        input.menteeId,
        "A mentor has been assigned to you in your chapter.",
        "connect"
      );
      await notify(
        input.mentorId,
        "You've been assigned as a mentor for a chapter member.",
        "connect"
      );
      return { ok: true };
    }),

  /* Post a learning / resource for the chapter (all members can read it). */
  postLearning: authedQuery
    .input(
      z.object({
        title: z.string().min(3).max(255),
        body: z.string().max(8000).optional(),
        url: safeUrl,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { member, chapterId } = await requireOfficer(ctx.user.id);
      await getDb().insert(schema.chapterPosts).values({
        chapterId,
        authorMemberId: member.id,
        title: input.title,
        body: input.body,
        url: input.url,
      });
      return { ok: true };
    }),

  deleteLearning: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { chapterId } = await requireOfficer(ctx.user.id);
      await getDb()
        .delete(schema.chapterPosts)
        .where(
          and(
            eq(schema.chapterPosts.id, input.id),
            eq(schema.chapterPosts.chapterId, chapterId)
          )
        );
      return { ok: true };
    }),

  /* Set the chapter's operating rhythm up to standard (the recurring cadences). */
  setupCadences: authedQuery.mutation(async ({ ctx }) => {
    const { chapterId } = await requireOfficer(ctx.user.id);
    const added = await ensureCadenceTemplates(chapterId);
    return { ok: true, added };
  }),

  /* One-tap "cadence kept / rescheduled" for the current period (§A2). */
  markCadence: authedQuery
    .input(
      z.object({
        cadenceId: z.number(),
        status: z.enum(CADENCE_STATUSES),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { member, chapterId } = await requireOfficer(ctx.user.id);
      const cad = (
        await getDb()
          .select()
          .from(schema.cadences)
          .where(eq(schema.cadences.id, input.cadenceId))
          .limit(1)
      ).at(0);
      if (!cad || cad.chapterId !== chapterId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not your chapter's cadence.",
        });
      await recordCadence(input.cadenceId, input.status, input.note, member.id);
      await audit(ctx.user, "cadence.mark", {
        type: "cadence",
        id: input.cadenceId,
        detail: `${cad.type ?? "cadence"} → ${input.status}`,
      });
      return { ok: true };
    }),

  /* Reverse a cadence mark — clears this period so it can be marked again. */
  reopenCadence: authedQuery
    .input(z.object({ cadenceId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { chapterId } = await requireOfficer(ctx.user.id);
      const cad = (
        await getDb()
          .select()
          .from(schema.cadences)
          .where(eq(schema.cadences.id, input.cadenceId))
          .limit(1)
      ).at(0);
      if (!cad || cad.chapterId !== chapterId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not your chapter's cadence.",
        });
      await reopenCadence(input.cadenceId);
      await audit(ctx.user, "cadence.reopen", {
        type: "cadence",
        id: input.cadenceId,
        detail: `${cad.type ?? "cadence"} reopened`,
      });
      return { ok: true };
    }),

  /* -------- ERP: chapter-lead member management for their own chapter -------- */

  /** Immediate profile-field edit for a member of the officer's chapter. */
  editChapterMemberProfile: authedQuery
    .input(
      z.object({
        memberId: z.number().int().positive(),
        name: z.string().max(255).optional(),
        email: z.string().email().max(320).optional(),
        phone: z.string().max(64).optional(),
        title: z.string().max(255).optional(),
        company: z.string().max(255).optional(),
        sector: z.string().max(128).optional(),
        stage: z.string().max(64).optional(),
        goals: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { chapterId } = await requireOfficer(ctx.user.id);
      const { memberId, ...patch } = input;
      await inChapter(memberId, chapterId);
      return applyProfileEdit(ctx.user, memberId, patch, "officer");
    }),

  /** Propose a high-impact change for a chapter member — enters the queue. */
  proposeChapterMemberChange: authedQuery
    .input(
      z.object({
        memberId: z.number().int().positive(),
        category: z.enum(["tier", "status", "lifecycle"]),
        changes: z
          .array(
            z.object({
              field: z.string().max(64),
              label: z.string().max(64),
              from: z.string().nullable(),
              to: z.string().nullable(),
            })
          )
          .min(1),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { chapterId } = await requireOfficer(ctx.user.id);
      await inChapter(input.memberId, chapterId);
      return proposeChange(ctx.user, input.memberId, {
        category: input.category,
        changes: input.changes,
        reason: input.reason,
        source: "officer",
      });
    }),

  /** Pending change requests for members of the officer's chapter. */
  chapterChangeRequests: authedQuery.query(async ({ ctx }) => {
    const { chapterId } = await requireOfficer(ctx.user.id);
    return listChangeRequests({ chapterId });
  }),

  /** Approve/reject a request for a chapter member (four-eyes enforced). */
  decideChapterMemberChange: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        decision: z.enum(["approve", "reject"]),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOfficer(ctx.user.id);
      return decideChange(ctx.user, input.id, input.decision, input.note);
    }),
});

export const officerRouter = mergeRouters(
  officerCoreRouter,
  officerGovernanceRouter,
  officerFinanceRouter,
  officerEventsRouter,
  officerRegionalRouter
);
