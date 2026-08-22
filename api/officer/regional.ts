import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, inArray, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, authedQuery } from "../middleware";
import { getMemberByUserId } from "../queries/circle";
import { computeChapterHealth } from "../queries/health";

export type RegionalScope = {
  member: typeof schema.members.$inferSelect;
  unitId: number;
  level: "zone" | "region" | "country";
  role: string;
};

/**
 * Resolve the caller's regional/zone officer context from unit_roles.
 * A member may hold multiple regional hats; we return the first active one.
 */
export async function requireRegionalOfficer(
  userId: number
): Promise<RegionalScope> {
  const member = await getMemberByUserId(userId);
  if (!member)
    throw new TRPCError({ code: "FORBIDDEN", message: "No membership" });
  const row = (
    await getDb()
      .select()
      .from(schema.unitRoles)
      .where(eq(schema.unitRoles.memberId, member.id))
      .limit(1)
  ).at(0);
  if (!row)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You don't hold a regional role.",
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
  overview: authedQuery.query(async ({ ctx }) => {
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
});
