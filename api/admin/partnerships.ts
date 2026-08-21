import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, scopedAdmin } from "../middleware";
import { idInput, TIER, safeUrl } from "./shared";

export const partnershipsRouter = createRouter({
  offersAdmin: scopedAdmin("partnerships").query(async () => {
    return getDb()
      .select()
      .from(schema.offers)
      .orderBy(desc(schema.offers.createdAt))
      .limit(100);
  }),

  saveOffer: scopedAdmin("partnerships")
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        vertical: z.enum(["setup", "consulting"]),
        title: z.string().min(2).max(255),
        description: z.string().max(4000).optional(),
        ctaUrl: safeUrl,
        tierGate: TIER.default("horizon"),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      if (id) {
        await db
          .update(schema.offers)
          .set(data)
          .where(eq(schema.offers.id, id));
        return { ok: true, id };
      }
      const res = await db.insert(schema.offers).values(data);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  deleteOffer: scopedAdmin("partnerships")
    .input(idInput)
    .mutation(async ({ input }) => {
      await getDb().delete(schema.offers).where(eq(schema.offers.id, input.id));
      return { ok: true };
    }),

  /* --------------------------------- leads -------------------------------- */
});
