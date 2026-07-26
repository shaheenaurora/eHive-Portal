import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { authRouter } from "./auth-router";
import { circleRouter } from "./circle-router";
import { adminRouter } from "./admin-router";
import { engageRouter } from "./engage-router";
import { adminEngageRouter } from "./admin-engage-router";
import { officerRouter } from "./officer-router";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  circle: circleRouter,
  admin: adminRouter,
  engage: engageRouter,
  adminEngage: adminEngageRouter,
  officer: officerRouter,

  /* ---- public content (marketing site): published insights + newsletter archive ---- */
  insightsPublic: publicQuery.query(async () => {
    const rows = await getDb().select({
      id: schema.insights.id, title: schema.insights.title, slug: schema.insights.slug,
      excerpt: schema.insights.excerpt, tag: schema.insights.tag, publishedAt: schema.insights.publishedAt,
    }).from(schema.insights)
      .where(sql`${schema.insights.publishedAt} is not null`)
      .orderBy(desc(schema.insights.publishedAt)).limit(30);
    return rows;
  }),

  insightBySlug: publicQuery
    .input(z.object({ slug: z.string().max(255) }))
    .query(async ({ input }) => {
      const rows = await getDb().select().from(schema.insights)
        .where(eq(schema.insights.slug, input.slug)).limit(1);
      const row = rows.at(0);
      if (!row || !row.publishedAt) return null;
      return row;
    }),

  newslettersPublic: publicQuery.query(async () => {
    return getDb().select().from(schema.newsletters)
      .orderBy(desc(schema.newsletters.publishedAt)).limit(24);
  }),
});

export type AppRouter = typeof appRouter;
