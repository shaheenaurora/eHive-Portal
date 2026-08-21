import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
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
import { sendScorecardFollowUp } from "./lib/lead-mail";

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
});

export type AppRouter = typeof appRouter;
