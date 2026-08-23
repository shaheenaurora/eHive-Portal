import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, inArray, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, authedQuery } from "../middleware";
import { getMemberByUserId } from "../queries/circle";
import { computeChapterHealth } from "../queries/health";
import { audit } from "../lib/audit";
import {
  listCouncil,
  createCouncilMeeting,
  updateCouncilMeeting,
  logDecision,
  updateDecision,
} from "../queries/councils";
import { financeReport, listExpenses } from "../queries/finance";

export type RegionalScope = {
  member: typeof schema.members.$inferSelect;
  unitId: number;
  level: "zone" | "region" | "country";
  role: string;
};

/** Regional director roles that grant access to the regional officer router. */
export const REGIONAL_DIRECTOR_ROLES = [
  "zone_director",
  "region_director",
  "country_director",
  "national_director",
] as const;

/**
 * Resolve the caller's regional/zone officer context from unit_roles.
 * A member may hold multiple regional hats; we return the first active one.
 * Access is granted only when the held role is a recognised regional director role.
 */
export async function requireRegionalOfficer(
  userId: number
): Promise<RegionalScope> {
  const member = await getMemberByUserId(userId);
  if (!member)
    throw new TRPCError({ code: "FORBIDDEN", message: "No membership" });
  const rows = await getDb()
    .select()
    .from(schema.unitRoles)
    .where(eq(schema.unitRoles.memberId, member.id));
  const row = rows.find(r =>
    (REGIONAL_DIRECTOR_ROLES as readonly string[]).includes(r.role)
  );
  if (!row)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't hold a regional director role.",
    });
  return {
    member,
    unitId: row.unitId,
    level: row.level,
    role: row.role,
  };
}

/** Recursively collect all org-unit IDs under the given unit (inclusive). */
async function descendantUnitIds(unitId: number): Promise<number[]> {
  const db = getDb();
  const units = await db.select().from(schema.orgUnits);
  const byParent = new Map<number | null, number[]>();
  for (const u of units) {
    const arr = byParent.get(u.parentId ?? null) ?? [];
    arr.push(u.id);
    byParent.set(u.parentId ?? null, arr);
  }
  const out = new Set<number>();
  const walk = (id: number) => {
    out.add(id);
    for (const child of byParent.get(id) ?? []) walk(child);
  };
  walk(unitId);
  return [...out];
}

/** Chapter IDs visible to a regional officer. */
export async function regionalChapterIds(scope: RegionalScope) {
  const ids = await descendantUnitIds(scope.unitId);
  const rows = await getDb()
    .select({ id: schema.chapters.id })
    .from(schema.chapters)
    .where(inArray(schema.chapters.zoneId, ids));
  return rows.map(r => r.id);
}

export const officerRegionalRouter = createRouter({
  regionalOverview: authedQuery.query(async ({ ctx }) => {
    const scope = await requireRegionalOfficer(ctx.user.id);
    const chapterIds = await regionalChapterIds(scope);
    const db = getDb();
    const [chapters, atRisk, members] = await Promise.all([
      db
        .select({
          id: schema.chapters.id,
          name: schema.chapters.name,
          status: schema.chapters.status,
          city: schema.chapters.city,
          zoneId: schema.chapters.zoneId,
        })
        .from(schema.chapters)
        .where(inArray(schema.chapters.id, chapterIds))
        .orderBy(schema.chapters.name),
      db
        .select({
          chapterId: schema.members.homeChapterId,
          n: sql<number>`count(*)`,
        })
        .from(schema.members)
        .where(
          and(
            inArray(schema.members.homeChapterId, chapterIds),
            eq(schema.members.lifecycleState, "at_risk")
          )
        )
        .groupBy(schema.members.homeChapterId),
      db
        .select({
          chapterId: schema.members.homeChapterId,
          n: sql<number>`count(*)`,
        })
        .from(schema.members)
        .where(inArray(schema.members.homeChapterId, chapterIds))
        .groupBy(schema.members.homeChapterId),
    ]);
    const health = await Promise.all(
      chapters.map(c => computeChapterHealth(c.id).catch(() => null))
    );
    const atRiskMap = new Map(atRisk.map(r => [r.chapterId, Number(r.n)]));
    const memberMap = new Map(members.map(r => [r.chapterId, Number(r.n)]));
    return {
      scope: {
        unitId: scope.unitId,
        level: scope.level,
        role: scope.role,
      },
      chapterCount: chapters.length,
      memberCount: members.reduce((a, r) => a + Number(r.n), 0),
      atRiskCount: atRisk.reduce((a, r) => a + Number(r.n), 0),
      chapters: chapters.map((c, i) => ({
        ...c,
        members: memberMap.get(c.id) ?? 0,
        atRisk: atRiskMap.get(c.id) ?? 0,
        health: health[i]?.total ?? null,
      })),
    };
  }),

  chapterDetail: authedQuery
    .input(z.object({ chapterId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const scope = await requireRegionalOfficer(ctx.user.id);
      const allowed = await regionalChapterIds(scope);
      if (!allowed.includes(input.chapterId))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That chapter isn't in your region.",
        });
      const db = getDb();
      const chapter = (
        await db
          .select()
          .from(schema.chapters)
          .where(eq(schema.chapters.id, input.chapterId))
          .limit(1)
      ).at(0);
      if (!chapter) throw new TRPCError({ code: "NOT_FOUND" });
      const [roster, board, cadence, health] = await Promise.all([
        db
          .select({ member: schema.members, user: schema.users })
          .from(schema.members)
          .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
          .where(eq(schema.members.homeChapterId, chapter.id))
          .orderBy(schema.users.name),
        db
          .select({
            role: schema.chapterRoles,
            name: schema.users.name,
          })
          .from(schema.chapterRoles)
          .innerJoin(
            schema.members,
            eq(schema.members.id, schema.chapterRoles.memberId)
          )
          .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
          .where(
            and(
              eq(schema.chapterRoles.chapterId, chapter.id),
              eq(schema.chapterRoles.status, "active")
            )
          ),
        import("../queries/cadence").then(m => m.listCadences(chapter.id)),
        computeChapterHealth(chapter.id).catch(() => null),
      ]);
      return {
        chapter,
        health,
        roster: roster.map(r => ({
          id: r.member.id,
          name: r.user.name ?? r.user.email ?? "Member",
          status: r.member.status,
          lifecycleState: r.member.lifecycleState,
        })),
        board: board.map(b => ({
          ...b.role,
          memberName: b.name ?? "Member",
        })),
        cadence,
      };
    }),

  regionalCouncil: authedQuery.query(async ({ ctx }) => {
    const scope = await requireRegionalOfficer(ctx.user.id);
    return listCouncil(scope.unitId);
  }),

  regionalCreateCouncilMeeting: authedQuery
    .input(
      z.object({
        title: z.string().min(3).max(255),
        scheduledAt: z.string().datetime().optional(),
        agenda: z.string().max(10000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await requireRegionalOfficer(ctx.user.id);
      const id = await createCouncilMeeting(scope.unitId, {
        title: input.title,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        agenda: input.agenda ?? null,
      });
      await audit(ctx.user, "regional.council.meeting.create", {
        type: "councilMeeting",
        id,
        detail: input.title,
      });
      return { ok: true, id };
    }),

  regionalUpdateCouncilMeeting: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["scheduled", "held", "cancelled"]).optional(),
        agenda: z.string().max(10000).optional(),
        minutes: z.string().max(20000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await requireRegionalOfficer(ctx.user.id);
      const db = getDb();
      const meeting = (
        await db
          .select()
          .from(schema.councilMeetings)
          .where(eq(schema.councilMeetings.id, input.id))
          .limit(1)
      ).at(0);
      if (!meeting) throw new TRPCError({ code: "NOT_FOUND" });
      if (meeting.unitId !== scope.unitId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That meeting isn't in your regional unit.",
        });
      await updateCouncilMeeting(input.id, {
        status: input.status,
        agenda: input.agenda,
        minutes: input.minutes,
      });
      await audit(ctx.user, "regional.council.meeting.update", {
        type: "councilMeeting",
        id: input.id,
        detail: `${meeting.title}${input.status ? ` → ${input.status}` : ""}`,
      });
      return { ok: true };
    }),

  regionalLogDecision: authedQuery
    .input(
      z.object({
        meetingId: z.number().int().positive().optional(),
        title: z.string().min(3).max(255),
        detail: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await requireRegionalOfficer(ctx.user.id);
      const db = getDb();
      if (input.meetingId) {
        const meeting = (
          await db
            .select()
            .from(schema.councilMeetings)
            .where(eq(schema.councilMeetings.id, input.meetingId))
            .limit(1)
        ).at(0);
        if (!meeting) throw new TRPCError({ code: "NOT_FOUND" });
        if (meeting.unitId !== scope.unitId)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "That meeting isn't in your regional unit.",
          });
      }
      const id = await logDecision(scope.unitId, {
        meetingId: input.meetingId ?? null,
        title: input.title,
        detail: input.detail ?? null,
      });
      await audit(ctx.user, "regional.council.decision.log", {
        type: "councilDecision",
        id,
        detail: input.title,
      });
      return { ok: true, id };
    }),

  regionalDecideDecision: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["proposed", "carried", "failed", "deferred"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await requireRegionalOfficer(ctx.user.id);
      const db = getDb();
      const decision = (
        await db
          .select()
          .from(schema.councilDecisions)
          .where(eq(schema.councilDecisions.id, input.id))
          .limit(1)
      ).at(0);
      if (!decision) throw new TRPCError({ code: "NOT_FOUND" });
      if (decision.unitId !== scope.unitId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That decision isn't in your regional unit.",
        });
      await updateDecision(input.id, input.status);
      await audit(ctx.user, "regional.council.decision.decide", {
        type: "councilDecision",
        id: input.id,
        detail: `${decision.title} → ${input.status}`,
      });
      return { ok: true };
    }),

  regionalFinanceReport: authedQuery.query(async ({ ctx }) => {
    const scope = await requireRegionalOfficer(ctx.user.id);
    const chapterIds = await regionalChapterIds(scope);
    return financeReport(undefined, { chapterIds });
  }),

  regionalExpenses: authedQuery.query(async ({ ctx }) => {
    const scope = await requireRegionalOfficer(ctx.user.id);
    const chapterIds = await regionalChapterIds(scope);
    return listExpenses({ scope: { chapterIds }, limit: 200 });
  }),
});
