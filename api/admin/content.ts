import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, scopedAdmin } from "../middleware";
import { idInput, TIER, safeUrl } from "./shared";

export const contentRouter = createRouter({
  libraryAdmin: scopedAdmin("content").query(async () => {
    return getDb()
      .select()
      .from(schema.libraryItems)
      .orderBy(desc(schema.libraryItems.createdAt))
      .limit(200);
  }),

  saveLibraryItem: scopedAdmin("content")
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        title: z.string().min(2).max(255),
        kind: z
          .enum(["playbook", "template", "recording", "note"])
          .default("playbook"),
        tierGate: TIER.default("horizon"),
        url: safeUrl,
        description: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      if (id) {
        await db
          .update(schema.libraryItems)
          .set(data)
          .where(eq(schema.libraryItems.id, id));
        return { ok: true, id };
      }
      const res = await db.insert(schema.libraryItems).values(data);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  deleteLibraryItem: scopedAdmin("content")
    .input(idInput)
    .mutation(async ({ input }) => {
      await getDb()
        .delete(schema.libraryItems)
        .where(eq(schema.libraryItems.id, input.id));
      return { ok: true };
    }),

  /* ------------------------------ testimonials ---------------------------- */

  testimonialsAdmin: scopedAdmin("content").query(async () => {
    return getDb()
      .select()
      .from(schema.testimonials)
      .orderBy(
        desc(schema.testimonials.sortOrder),
        desc(schema.testimonials.createdAt)
      )
      .limit(200);
  }),

  saveTestimonial: scopedAdmin("content")
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        quote: z.string().min(10).max(2000),
        authorName: z.string().min(2).max(128),
        authorRole: z.string().max(128).optional(),
        authorChapter: z.string().max(128).optional(),
        published: z.boolean().default(false),
        sortOrder: z.number().int().default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { id, ...data } = input;
      if (id) {
        await db
          .update(schema.testimonials)
          .set(data)
          .where(eq(schema.testimonials.id, id));
        return { ok: true, id };
      }
      const res = await db.insert(schema.testimonials).values(data);
      const newId = Number(res[0].insertId);
      const { audit } = await import("../lib/audit");
      await audit(ctx.user, "testimonial.create", {
        type: "testimonial",
        id: newId,
        detail: input.authorName,
      });
      return { ok: true, id: newId };
    }),

  deleteTestimonial: scopedAdmin("content")
    .input(idInput)
    .mutation(async ({ input }) => {
      await getDb()
        .delete(schema.testimonials)
        .where(eq(schema.testimonials.id, input.id));
      return { ok: true };
    }),

  /* -------------------------------- offers -------------------------------- */
});
