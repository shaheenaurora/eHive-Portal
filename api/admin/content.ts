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

  /* -------------------------------- offers -------------------------------- */
});
