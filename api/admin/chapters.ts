import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, scopedAdmin } from "../middleware";
import { chapterScorecards } from "../queries/reports";
import { idInput } from "./shared";

export const chaptersRouter = createRouter({
  govAdmin: scopedAdmin("chapters").query(async () => {
    const db = getDb();
    const bodies = await db
      .select()
      .from(schema.govBodies)
      .orderBy(schema.govBodies.name);
    const out = [];
    for (const b of bodies) {
      const [roles, minutes] = await Promise.all([
        db
          .select({
            role: schema.govRoles,
            userName: schema.users.name,
            memberId: schema.members.id,
          })
          .from(schema.govRoles)
          .innerJoin(
            schema.members,
            eq(schema.members.id, schema.govRoles.memberId)
          )
          .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
          .where(eq(schema.govRoles.bodyId, b.id)),
        db
          .select()
          .from(schema.govMinutes)
          .where(eq(schema.govMinutes.bodyId, b.id))
          .orderBy(desc(schema.govMinutes.date)),
      ]);
      out.push({ ...b, roles, minutes });
    }
    const pols = await db
      .select()
      .from(schema.policies)
      .orderBy(desc(schema.policies.createdAt));
    const polOut = [];
    for (const p of pols) {
      const [acks] = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.policyAcks)
        .where(eq(schema.policyAcks.policyId, p.id));
      polOut.push({ ...p, ackCount: acks?.n ?? 0 });
    }
    return { bodies: out, policies: polOut };
  }),

  createBody: scopedAdmin("chapters")
    .input(
      z.object({
        name: z.string().min(2).max(255),
        description: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.govBodies).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  assignSeat: scopedAdmin("chapters")
    .input(
      z.object({
        bodyId: z.number().int().positive(),
        memberId: z.number().int().positive(),
        seat: z.string().min(2).max(128),
        termStart: z.coerce.date().optional(),
        termEnd: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.govRoles).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  removeSeat: scopedAdmin("chapters")
    .input(idInput)
    .mutation(async ({ input }) => {
      await getDb()
        .delete(schema.govRoles)
        .where(eq(schema.govRoles.id, input.id));
      return { ok: true };
    }),

  publishMinutes: scopedAdmin("chapters")
    .input(
      z.object({
        bodyId: z.number().int().positive(),
        title: z.string().min(2).max(255),
        date: z.coerce.date().optional(),
        text: z.string().max(20000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.govMinutes).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  savePolicy: scopedAdmin("chapters")
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        title: z.string().min(2).max(255),
        body: z.string().max(50000),
        version: z.number().int().min(1).max(99).default(1),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      if (input.id) {
        await db
          .update(schema.policies)
          .set({ title: input.title, body: input.body, version: input.version })
          .where(eq(schema.policies.id, input.id));
        return { ok: true, id: input.id };
      }
      const res = await db.insert(schema.policies).values({
        title: input.title,
        body: input.body,
        version: input.version,
      });
      return { ok: true, id: Number(res[0].insertId) };
    }),

  /* ------------------------------- library -------------------------------- */
  reportsChapterScorecards: scopedAdmin("chapters").query(() =>
    chapterScorecards()
  ),
});
