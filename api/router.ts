import { z } from "zod";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import * as schema from "@db/schema";
import { escapeHtml } from "./lib/html";
import { authRouter } from "./auth-router";
import { circleRouter } from "./circle-router";
import { adminRouter } from "./admin-router";
import { engageRouter } from "./engage-router";
import { adminEngageRouter } from "./admin-engage-router";
import { officerRouter } from "./officer-router";
import { conductRouter } from "./conduct-router";
import { createRouter, publicQuery, scopedAdmin } from "./middleware";
import { getDb } from "./queries/connection";
import {
  sendScorecardFollowUp,
  sendBookingConfirmation,
} from "./lib/lead-mail";
import {
  formatGstDate,
  formatGstTime,
  isSlotAvailable,
  toGstTimestamp,
  BOOKING_SLOTS,
} from "./lib/booking";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  circle: circleRouter,
  admin: adminRouter,
  engage: engageRouter,
  adminEngage: adminEngageRouter,
  officer: officerRouter,
  conduct: conductRouter,

  /* ---- public content (marketing site): published insights + newsletter archive ---- */
  insightsPublic: publicQuery.query(async () => {
    const rows = await getDb()
      .select({
        id: schema.insights.id,
        title: schema.insights.title,
        slug: schema.insights.slug,
        excerpt: schema.insights.excerpt,
        tag: schema.insights.tag,
        publishedAt: schema.insights.publishedAt,
      })
      .from(schema.insights)
      .where(sql`${schema.insights.publishedAt} is not null`)
      .orderBy(desc(schema.insights.publishedAt))
      .limit(30);
    return rows;
  }),

  insightBySlug: publicQuery
    .input(z.object({ slug: z.string().max(255) }))
    .query(async ({ input }) => {
      const rows = await getDb()
        .select()
        .from(schema.insights)
        .where(eq(schema.insights.slug, input.slug))
        .limit(1);
      const row = rows.at(0);
      if (!row || !row.publishedAt) return null;
      return { ...row, body: escapeHtml(row.body) };
    }),

  newslettersPublic: publicQuery.query(async () => {
    return getDb()
      .select()
      .from(schema.newsletters)
      .orderBy(desc(schema.newsletters.publishedAt))
      .limit(24);
  }),

  /* ---- scorecard results admin (leads scope) ---- */
  scorecardsAdmin: scopedAdmin("leads").query(async () => {
    const rows = await getDb()
      .select()
      .from(schema.scorecardResults)
      .orderBy(desc(schema.scorecardResults.createdAt))
      .limit(200);
    return rows;
  }),

  updateScorecardStage: scopedAdmin("leads")
    .input(
      z.object({
        id: z.number().int().positive(),
        stage: z.enum([
          "new",
          "emailed",
          "follow_up_1",
          "follow_up_2",
          "replied",
          "booked",
          "disqualified",
        ]),
      })
    )
    .mutation(async ({ input }) => {
      await getDb()
        .update(schema.scorecardResults)
        .set({ nurtureStage: input.stage })
        .where(eq(schema.scorecardResults.id, input.id));
      return { ok: true };
    }),

  sendScorecardFollowUp: scopedAdmin("leads")
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const row = (
        await getDb()
          .select()
          .from(schema.scorecardResults)
          .where(eq(schema.scorecardResults.id, input.id))
          .limit(1)
      ).at(0);
      if (!row) throw new Error("Scorecard result not found");
      const nextStage: typeof row.nurtureStage =
        row.nurtureStage === "new" || row.nurtureStage === "emailed"
          ? "follow_up_1"
          : "follow_up_2";
      const emailResult = await sendScorecardFollowUp({
        email: row.email,
        name: row.name,
        total: row.total,
        recommendationProduct: row.recommendationProduct,
        recommendationWhy: row.recommendationWhy,
        stage: nextStage,
      });
      if (emailResult.ok) {
        await getDb()
          .update(schema.scorecardResults)
          .set({ nurtureStage: nextStage, emailedAt: new Date() })
          .where(eq(schema.scorecardResults.id, input.id));
      }
      return emailResult;
    }),

  /* ---- appointment admin (leads scope) ---- */
  appointmentsAdmin: scopedAdmin("leads").query(async () => {
    const rows = await getDb()
      .select()
      .from(schema.appointments)
      .orderBy(desc(schema.appointments.scheduledAt))
      .limit(200);
    return rows;
  }),

  confirmAppointment: scopedAdmin("leads")
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const row = (
        await getDb()
          .select()
          .from(schema.appointments)
          .where(eq(schema.appointments.id, input.id))
          .limit(1)
      ).at(0);
      if (!row) throw new Error("Appointment not found");
      const when = `${formatGstDate(row.scheduledAt)} · ${formatGstTime(row.scheduledAt)} GST`;
      const emailResult = await sendBookingConfirmation({
        name: row.name,
        email: row.email,
        product: row.product,
        when,
        format: `${row.durationMin}-minute session`,
        phone: row.phone,
        notes: row.notes,
        confirmed: true,
      });
      await getDb()
        .update(schema.appointments)
        .set({ status: "confirmed", confirmedAt: new Date() })
        .where(eq(schema.appointments.id, input.id));
      return { ok: true, emailSent: emailResult.confirmSent };
    }),

  cancelAppointment: scopedAdmin("leads")
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      await getDb()
        .update(schema.appointments)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(schema.appointments.id, input.id));
      return { ok: true };
    }),

  rescheduleAppointment: scopedAdmin("leads")
    .input(
      z.object({
        id: z.number().int().positive(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.enum(BOOKING_SLOTS),
      })
    )
    .mutation(async ({ input }) => {
      const row = (
        await getDb()
          .select()
          .from(schema.appointments)
          .where(eq(schema.appointments.id, input.id))
          .limit(1)
      ).at(0);
      if (!row) throw new Error("Appointment not found");

      const scheduledAt = toGstTimestamp(input.date, input.time);
      const windowStart = new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(scheduledAt.getTime() + 24 * 60 * 60 * 1000);
      const existing = await getDb()
        .select({
          scheduledAt: schema.appointments.scheduledAt,
          durationMin: schema.appointments.durationMin,
          status: schema.appointments.status,
        })
        .from(schema.appointments)
        .where(
          and(
            gte(schema.appointments.scheduledAt, windowStart),
            lte(schema.appointments.scheduledAt, windowEnd),
            sql`${schema.appointments.id} <> ${input.id}`
          )
        );
      if (!isSlotAvailable(existing, input.date, input.time, row.durationMin)) {
        throw new Error("That slot is no longer available.");
      }

      const when = `${formatGstDate(scheduledAt)} · ${formatGstTime(scheduledAt)} GST`;
      const emailResult = await sendBookingConfirmation({
        name: row.name,
        email: row.email,
        product: row.product,
        when,
        format: `${row.durationMin}-minute session`,
        phone: row.phone,
        notes: row.notes,
        confirmed: true,
      });

      await getDb()
        .update(schema.appointments)
        .set({
          scheduledAt,
          status: "confirmed",
          confirmedAt: row.confirmedAt ?? new Date(),
        })
        .where(eq(schema.appointments.id, input.id));
      return { ok: true, emailSent: emailResult.confirmSent };
    }),

  markNoShow: scopedAdmin("leads")
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(schema.appointments)
        .set({ status: "no_show" })
        .where(eq(schema.appointments.id, input.id));
      return { ok: true };
    }),
});

export type AppRouter = typeof appRouter;
