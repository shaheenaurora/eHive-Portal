import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull, desc, asc, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { createRouter, authedQuery } from "./middleware";
import { getMemberByUserId, notify } from "./queries/circle";
import { computeChapterHealth } from "./queries/health";
import { computeOnboarding } from "./queries/onboarding";

/**
 * Resolve the caller's chapter-officer context: the member must hold an active
 * leadership role in their home chapter. Everything an officer does is scoped to
 * that one chapter — never another. Throws FORBIDDEN if they're not an officer.
 */
async function requireOfficer(userId: number) {
  const member = await getMemberByUserId(userId);
  if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "No membership" });
  if (!member.homeChapterId)
    throw new TRPCError({ code: "FORBIDDEN", message: "You don't lead a chapter." });
  const roles = await getDb().select().from(schema.chapterRoles)
    .where(and(eq(schema.chapterRoles.memberId, member.id),
               eq(schema.chapterRoles.chapterId, member.homeChapterId),
               eq(schema.chapterRoles.status, "active")));
  if (!roles.length)
    throw new TRPCError({ code: "FORBIDDEN", message: "You don't hold a chapter leadership role." });
  return { member, chapterId: member.homeChapterId, roleKeys: roles.map((r) => r.role) };
}

/** A member of the officer's chapter — used to validate every target. */
async function inChapter(memberId: number, chapterId: number) {
  const m = (await getDb().select().from(schema.members).where(eq(schema.members.id, memberId)).limit(1)).at(0);
  if (!m || m.homeChapterId !== chapterId)
    throw new TRPCError({ code: "BAD_REQUEST", message: "That member isn't in your chapter." });
  return m;
}

export const officerRouter = createRouter({
  /* Console overview: roster with mentor/onboarding status + learnings. */
  overview: authedQuery.query(async ({ ctx }) => {
    const { chapterId, roleKeys } = await requireOfficer(ctx.user.id);
    const db = getDb();
    const chapter = (await db.select().from(schema.chapters).where(eq(schema.chapters.id, chapterId)).limit(1)).at(0);
    const roster = await db.select({ member: schema.members, user: schema.users })
      .from(schema.members).innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.members.homeChapterId, chapterId)).orderBy(asc(schema.users.name)).limit(300);
    // Mentor pairings inside the chapter (buddy = mentor, newMember = mentee).
    const pairs = await db.select().from(schema.buddies);
    const menteeIds = new Set(pairs.map((p) => p.newMemberId));
    const rosterIds = new Set(roster.map((r) => r.member.id));
    const chapterPairs = pairs.filter((p) => rosterIds.has(p.newMemberId) && rosterIds.has(p.buddyMemberId));
    const learnings = await db.select({ post: schema.chapterPosts, name: schema.users.name })
      .from(schema.chapterPosts)
      .leftJoin(schema.members, eq(schema.members.id, schema.chapterPosts.authorMemberId))
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.chapterPosts.chapterId, chapterId))
      .orderBy(desc(schema.chapterPosts.createdAt)).limit(50);
    const health = await computeChapterHealth(chapterId);
    // Onboarding cohort — members still in their first 90 days (ML-03).
    const onboardingMembers = roster.filter((r) => r.member.lifecycleState === "onboarding");
    const onboarding = await Promise.all(onboardingMembers.map(async (r) => {
      const p = await computeOnboarding(r.member);
      return { id: r.member.id, name: r.user.name ?? r.user.email ?? "Member", percent: p.percent, doneCount: p.doneCount, total: p.total, dayCount: p.dayCount, stage: p.stage };
    }));
    return {
      chapter, roleKeys, health, onboarding,
      roster: roster.map((r) => ({
        id: r.member.id, name: r.user.name ?? r.user.email ?? "Member",
        company: r.member.company, tier: r.member.tier, status: r.member.status,
        hasMentor: menteeIds.has(r.member.id),
      })),
      mentorPairs: chapterPairs.map((p) => ({ id: p.id, menteeId: p.newMemberId, mentorId: p.buddyMemberId, checkedIn: !!p.checkinAt })),
      learnings: learnings.map((l) => ({ ...l.post, authorName: l.name ?? "Officer" })),
    };
  }),

  /* Unassigned active members the officer can sign up into their chapter. */
  signupCandidates: authedQuery
    .input(z.object({ q: z.string().max(120).optional() }))
    .query(async ({ ctx, input }) => {
      await requireOfficer(ctx.user.id);
      const db = getDb();
      const conds = [eq(schema.members.status, "active"), isNull(schema.members.homeChapterId)];
      if (input.q) {
        const like = `%${input.q}%`;
        conds.push(sql`(${schema.users.name} like ${like} or ${schema.users.email} like ${like} or ${schema.members.company} like ${like})`);
      }
      const rows = await db.select({ id: schema.members.id, name: schema.users.name, email: schema.users.email, company: schema.members.company })
        .from(schema.members).leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(and(...conds)).orderBy(asc(schema.users.name)).limit(40);
      return rows;
    }),

  /* Sign an unassigned member up into the chapter (onboarding). Members who
     already have a chapter must go through a transfer request, not this. */
  signupMember: authedQuery
    .input(z.object({ memberId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { chapterId } = await requireOfficer(ctx.user.id);
      const db = getDb();
      const m = (await db.select().from(schema.members).where(eq(schema.members.id, input.memberId)).limit(1)).at(0);
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      if (m.homeChapterId && m.homeChapterId !== chapterId)
        throw new TRPCError({ code: "CONFLICT", message: "They belong to another chapter — they must request a transfer." });
      await db.update(schema.members).set({ homeChapterId: chapterId }).where(eq(schema.members.id, m.id));
      await notify(m.id, "You've been added to a chapter. Welcome — say hello to your chapter leadership.", "connect");
      return { ok: true };
    }),

  /* Assign a mentor to a member — both must be in the officer's chapter. */
  assignMentor: authedQuery
    .input(z.object({ menteeId: z.number(), mentorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { chapterId } = await requireOfficer(ctx.user.id);
      if (input.menteeId === input.mentorId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "A member can't mentor themselves." });
      const db = getDb();
      await inChapter(input.menteeId, chapterId);
      await inChapter(input.mentorId, chapterId);
      const existing = await db.select().from(schema.buddies)
        .where(and(eq(schema.buddies.newMemberId, input.menteeId), isNull(schema.buddies.checkinAt))).limit(1);
      if (existing.length) {
        await db.update(schema.buddies).set({ buddyMemberId: input.mentorId, pairedAt: new Date() })
          .where(eq(schema.buddies.id, existing[0].id));
      } else {
        await db.insert(schema.buddies).values({ newMemberId: input.menteeId, buddyMemberId: input.mentorId });
      }
      await notify(input.menteeId, "A mentor has been assigned to you in your chapter.", "connect");
      await notify(input.mentorId, "You've been assigned as a mentor for a chapter member.", "connect");
      return { ok: true };
    }),

  /* Post a learning / resource for the chapter (all members can read it). */
  postLearning: authedQuery
    .input(z.object({ title: z.string().min(3).max(255), body: z.string().max(8000).optional(), url: z.string().max(512).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { member, chapterId } = await requireOfficer(ctx.user.id);
      await getDb().insert(schema.chapterPosts).values({
        chapterId, authorMemberId: member.id, title: input.title, body: input.body, url: input.url,
      });
      return { ok: true };
    }),

  deleteLearning: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { chapterId } = await requireOfficer(ctx.user.id);
      await getDb().delete(schema.chapterPosts)
        .where(and(eq(schema.chapterPosts.id, input.id), eq(schema.chapterPosts.chapterId, chapterId)));
      return { ok: true };
    }),
});
