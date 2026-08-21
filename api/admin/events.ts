import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, scopedAdmin } from "../middleware";
import {
  awardPoints,
  awardRulePoints,
  promoteWaitlist,
} from "../queries/circle";
import { audit } from "../lib/audit";
import { EVENT_CHECKIN_OPENS_BEFORE_MS } from "@contracts/constants";
import { TIER, idInput, EVENT_KIND, AUDIENCE, resolveAudience } from "./shared";

export const eventsRouter = createRouter({
  eventsAdmin: scopedAdmin("events").query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.events)
      .where(isNull(schema.events.deletedAt))
      .orderBy(desc(schema.events.startsAt))
      .limit(100);
    // Batch the per-event registration counts into one grouped query (was N+1).
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
              eq(schema.eventRegs.status, "registered")
            )
          )
          .groupBy(schema.eventRegs.eventId)
      : [];
    const countMap = new Map(counts.map(c => [c.eventId, Number(c.n)]));
    return rows.map(e => ({ ...e, regCount: countMap.get(e.id) ?? 0 }));
  }),

  createEvent: scopedAdmin("events")
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
      const { audience, audienceTiers, ...rest } = input;
      const scope = resolveAudience(audience, audienceTiers);
      const res = await getDb()
        .insert(schema.events)
        .values({ ...rest, ...scope });
      const id = Number(res[0].insertId);
      await audit(ctx.user, "event.create", {
        type: "event",
        id,
        detail: `${input.kind} · ${audience}`,
      });
      return { ok: true, id };
    }),

  updateEvent: scopedAdmin("events")
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
    .mutation(async ({ input }) => {
      const { id, audience, audienceTiers, ...patch } = input;
      const scope = audience ? resolveAudience(audience, audienceTiers) : {};
      await getDb()
        .update(schema.events)
        .set({ ...patch, ...scope })
        .where(eq(schema.events.id, id));
      return { ok: true };
    }),

  archiveEvent: scopedAdmin("events")
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const ev = (
        await db
          .select()
          .from(schema.events)
          .where(
            and(eq(schema.events.id, input.id), isNull(schema.events.deletedAt))
          )
          .limit(1)
      ).at(0);
      if (!ev)
        throw new TRPCError({ code: "NOT_FOUND", message: "Event not found" });
      await db
        .update(schema.events)
        .set({ deletedAt: new Date() })
        .where(eq(schema.events.id, input.id));
      await audit(ctx.user, "event.archive", {
        type: "event",
        id: input.id,
        detail: ev.title,
      });
      return { ok: true };
    }),

  eventRegs: scopedAdmin("events")
    .input(idInput)
    .query(async ({ input }) => {
      return getDb()
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

  markEventAttendance: scopedAdmin("events")
    .input(
      z.object({
        eventId: z.number().int().positive(),
        memberId: z.number().int().positive(),
        status: z.enum(["registered", "attended", "cancelled"]),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
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
      // Temporal integrity: attendance can't be recorded before the event runs,
      // even by an admin (opens 2h before it starts). Register/cancel/undo are fine.
      if (input.status === "attended") {
        const ev = (
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
        ).at(0);
        if (
          ev &&
          Date.now() <
            new Date(ev.startsAt).getTime() - EVENT_CHECKIN_OPENS_BEFORE_MS
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "This event hasn't started — attendance can't be marked until it begins.",
          });
      }
      await db
        .update(schema.eventRegs)
        .set({ status: input.status })
        .where(eq(schema.eventRegs.id, reg.id));
      if (input.status === "attended" && reg.status !== "attended") {
        await awardRulePoints(
          input.memberId,
          "event_attend",
          "Event attendance"
        );
      }
      // freed seat auto-promotes the waitlist (BRD 6.4)
      if (input.status === "cancelled" && reg.status === "registered") {
        await promoteWaitlist(input.eventId);
      }
      return { ok: true };
    }),

  /* ----------------------------- hive score ------------------------------- */
  frpCohortsAdmin: scopedAdmin("events").query(async () => {
    const db = getDb();
    const cohorts = await db
      .select()
      .from(schema.frpCohorts)
      .orderBy(desc(schema.frpCohorts.createdAt));
    const out = [];
    for (const c of cohorts) {
      const enrols = await db
        .select({
          en: schema.frpEnrolments,
          member: schema.members,
          userName: schema.users.name,
          userEmail: schema.users.email,
        })
        .from(schema.frpEnrolments)
        .innerJoin(
          schema.members,
          eq(schema.members.id, schema.frpEnrolments.memberId)
        )
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(eq(schema.frpEnrolments.cohortId, c.id));
      out.push({ ...c, enrolments: enrols });
    }
    return out;
  }),

  createCohort: scopedAdmin("events")
    .input(
      z.object({
        name: z.string().min(2).max(255),
        tierGate: TIER.default("vanguard"),
        startsAt: z.coerce.date().optional(),
        status: z.enum(["open", "running", "closed"]).default("open"),
      })
    )
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.frpCohorts).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  updateCohort: scopedAdmin("events")
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(2).max(255).optional(),
        tierGate: TIER.optional(),
        startsAt: z.coerce.date().optional(),
        status: z.enum(["open", "running", "closed"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      await getDb()
        .update(schema.frpCohorts)
        .set(patch)
        .where(eq(schema.frpCohorts.id, id));
      return { ok: true };
    }),

  setEnrolmentStatus: scopedAdmin("events")
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["enrolled", "active", "completed", "withdrawn"]),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(schema.frpEnrolments)
        .set({ status: input.status })
        .where(eq(schema.frpEnrolments.id, input.id));
      if (input.status === "completed") {
        const rows = await db
          .select()
          .from(schema.frpEnrolments)
          .where(eq(schema.frpEnrolments.id, input.id))
          .limit(1);
        const en = rows.at(0);
        if (en)
          await awardPoints(
            en.memberId,
            "frp",
            15,
            "Completed Fundraising Readiness Programme"
          );
      }
      return { ok: true };
    }),

  reviewMilestone: scopedAdmin("events")
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["not_started", "in_progress", "submitted", "reviewed"]),
        note: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.frpMilestones)
        .where(eq(schema.frpMilestones.id, input.id))
        .limit(1);
      const ms = rows.at(0);
      if (!ms)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Milestone not found",
        });
      await db
        .update(schema.frpMilestones)
        .set({ status: input.status, note: input.note ?? ms.note })
        .where(eq(schema.frpMilestones.id, input.id));
      if (input.status === "reviewed" && ms.status !== "reviewed") {
        const en = await db
          .select()
          .from(schema.frpEnrolments)
          .where(eq(schema.frpEnrolments.id, ms.enrolmentId))
          .limit(1);
        if (en.at(0))
          await awardPoints(en.at(0)!.memberId, "frp", 5, `${ms.key} reviewed`);
      }
      return { ok: true };
    }),

  enrolmentDetail: scopedAdmin("events")
    .input(idInput)
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({
          en: schema.frpEnrolments,
          cohort: schema.frpCohorts,
          member: schema.members,
          userName: schema.users.name,
          userEmail: schema.users.email,
        })
        .from(schema.frpEnrolments)
        .innerJoin(
          schema.frpCohorts,
          eq(schema.frpCohorts.id, schema.frpEnrolments.cohortId)
        )
        .innerJoin(
          schema.members,
          eq(schema.members.id, schema.frpEnrolments.memberId)
        )
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(eq(schema.frpEnrolments.id, input.id))
        .limit(1);
      const row = rows.at(0);
      if (!row)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Enrolment not found",
        });
      const [assessment, milestones] = await Promise.all([
        db
          .select()
          .from(schema.readinessAssessments)
          .where(eq(schema.readinessAssessments.enrolmentId, input.id))
          .limit(1),
        db
          .select()
          .from(schema.frpMilestones)
          .where(eq(schema.frpMilestones.enrolmentId, input.id)),
      ]);
      return { ...row, assessment: assessment.at(0) ?? null, milestones };
    }),

  /* ------------------------------ governance ------------------------------ */
});
