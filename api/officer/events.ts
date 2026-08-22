import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, authedQuery } from "../middleware";
import { audit } from "../lib/audit";
import { EVENT_KIND, AUDIENCE, TIER, resolveAudience } from "../admin/shared";
import { requireOfficer, assertChapterOwner, assertRoles } from "./shared";

export const officerEventsRouter = createRouter({
  events: authedQuery.query(async ({ ctx }) => {
    const { chapterId } = await requireOfficer(ctx.user.id);
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.chapterId, chapterId),
          isNull(schema.events.deletedAt)
        )
      )
      .orderBy(desc(schema.events.startsAt))
      .limit(50);
    const ids = rows.map(e => e.id);
    const counts = ids.length
      ? await db
          .select({
            eventId: schema.eventRegs.eventId,
            n: sql<number>`count(*)`,
          })
          .from(schema.eventRegs)
          .where(
            and(
              sql`${schema.eventRegs.eventId} in (${sql.join(
                ids.map(i => sql`${i}`),
                sql`, `
              )})`,
              sql`${schema.eventRegs.status} in ('registered','attended')`
            )
          )
          .groupBy(schema.eventRegs.eventId)
      : [];
    const countMap = new Map(counts.map(c => [c.eventId, Number(c.n)]));
    return rows.map(e => ({ ...e, regCount: countMap.get(e.id) ?? 0 }));
  }),

  createEvent: authedQuery
    .input(
      z.object({
        title: z.string().min(2).max(255),
        kind: EVENT_KIND.default("meetup"),
        description: z.string().max(4000).optional(),
        startsAt: z.coerce.date(),
        location: z.string().max(255).optional(),
        audience: AUDIENCE.default("members"),
        audienceTiers: z.array(TIER).optional(),
        capacity: z.number().int().min(1).max(2000).default(40),
        cpdCredits: z.number().int().min(0).max(100).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { chapterId, roleKeys } = await requireOfficer(ctx.user.id);
      assertRoles(
        roleKeys,
        ["vp_programming", "president"],
        "Event management requires VP Programming or President."
      );
      const { audience, audienceTiers, ...rest } = input;
      const scope = resolveAudience(audience, audienceTiers);
      const res = await getDb()
        .insert(schema.events)
        .values({ ...rest, ...scope, chapterId });
      const id = Number(res[0].insertId);
      await audit(ctx.user, "officer.event.create", {
        type: "event",
        id,
        detail: `${input.kind} · ${audience}`,
      });
      return { ok: true, id };
    }),

  updateEvent: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        title: z.string().min(2).max(255).optional(),
        kind: EVENT_KIND.optional(),
        description: z.string().max(4000).optional(),
        startsAt: z.coerce.date().optional(),
        location: z.string().max(255).optional(),
        audience: AUDIENCE.optional(),
        audienceTiers: z.array(TIER).optional(),
        capacity: z.number().int().min(1).max(2000).optional(),
        cpdCredits: z.number().int().min(0).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { chapterId, roleKeys } = await requireOfficer(ctx.user.id);
      assertRoles(
        roleKeys,
        ["vp_programming", "president"],
        "Event management requires VP Programming or President."
      );
      const db = getDb();
      const { id, audience, audienceTiers, ...patch } = input;
      await assertChapterOwner(
        (
          await db
            .select()
            .from(schema.events)
            .where(
              and(eq(schema.events.id, id), isNull(schema.events.deletedAt))
            )
            .limit(1)
        ).at(0),
        chapterId,
        "event"
      );
      const scope = audience ? resolveAudience(audience, audienceTiers) : {};
      await db
        .update(schema.events)
        .set({ ...patch, ...scope })
        .where(eq(schema.events.id, id));
      await audit(ctx.user, "officer.event.update", {
        type: "event",
        id,
        detail: input.title ?? `event #${id}`,
      });
      return { ok: true };
    }),

  archiveEvent: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { chapterId, roleKeys } = await requireOfficer(ctx.user.id);
      assertRoles(
        roleKeys,
        ["vp_programming", "president"],
        "Event management requires VP Programming or President."
      );
      const db = getDb();
      const ev = await assertChapterOwner(
        (
          await db
            .select()
            .from(schema.events)
            .where(
              and(
                eq(schema.events.id, input.id),
                isNull(schema.events.deletedAt)
              )
            )
            .limit(1)
        ).at(0),
        chapterId,
        "event"
      );
      await db
        .update(schema.events)
        .set({ deletedAt: new Date() })
        .where(eq(schema.events.id, input.id));
      await audit(ctx.user, "officer.event.archive", {
        type: "event",
        id: input.id,
        detail: ev.title,
      });
      return { ok: true };
    }),

  eventRegs: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const { chapterId } = await requireOfficer(ctx.user.id);
      const db = getDb();
      await assertChapterOwner(
        (
          await db
            .select()
            .from(schema.events)
            .where(
              and(
                eq(schema.events.id, input.id),
                isNull(schema.events.deletedAt)
              )
            )
            .limit(1)
        ).at(0),
        chapterId,
        "event"
      );
      return db
        .select({
          reg: schema.eventRegs,
          member: schema.members,
          userName: schema.users.name,
          userEmail: schema.users.email,
        })
        .from(schema.eventRegs)
        .innerJoin(
          schema.members,
          eq(schema.members.id, schema.eventRegs.memberId)
        )
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(eq(schema.eventRegs.eventId, input.id))
        .orderBy(desc(schema.eventRegs.createdAt));
    }),

  markAttendance: authedQuery
    .input(
      z.object({
        eventId: z.number().int().positive(),
        memberId: z.number().int().positive(),
        status: z.enum(["registered", "attended", "cancelled"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { chapterId, roleKeys } = await requireOfficer(ctx.user.id);
      assertRoles(
        roleKeys,
        ["vp_programming", "president"],
        "Event management requires VP Programming or President."
      );
      const db = getDb();
      await assertChapterOwner(
        (
          await db
            .select()
            .from(schema.events)
            .where(
              and(
                eq(schema.events.id, input.eventId),
                isNull(schema.events.deletedAt)
              )
            )
            .limit(1)
        ).at(0),
        chapterId,
        "event"
      );
      const rows = await db
        .select()
        .from(schema.eventRegs)
        .where(
          and(
            eq(schema.eventRegs.eventId, input.eventId),
            eq(schema.eventRegs.memberId, input.memberId)
          )
        )
        .limit(1);
      const reg = rows.at(0);
      if (!reg)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Registration not found",
        });
      await db
        .update(schema.eventRegs)
        .set({ status: input.status })
        .where(eq(schema.eventRegs.id, reg.id));
      return { ok: true };
    }),
});
