import { z } from "zod";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, scopedAdmin } from "../middleware";
import { chapterScorecards } from "../queries/reports";
import { idInput } from "./shared";
import {
  evaluateFranchiseReadiness,
  readinessScore,
} from "../lib/franchise-readiness";
import { notify } from "../queries/circle";
import { audit } from "../lib/audit";
import {
  listFranchiseOnboarding,
  updateFranchiseOnboardingItem,
} from "../queries/franchise-onboarding";

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
      const db = getDb();
      // Prevent the same member holding overlapping terms or one seat being
      // double-booked in the same governance body.
      const existing = await db
        .select()
        .from(schema.govRoles)
        .where(
          and(
            eq(schema.govRoles.bodyId, input.bodyId),
            or(
              eq(schema.govRoles.memberId, input.memberId),
              eq(schema.govRoles.seat, input.seat)
            )
          )
        );
      const newStart = input.termStart?.getTime() ?? -Infinity;
      const newEnd = input.termEnd?.getTime() ?? Infinity;
      for (const r of existing) {
        const exStart = r.termStart ? new Date(r.termStart).getTime() : -Infinity;
        const exEnd = r.termEnd ? new Date(r.termEnd).getTime() : Infinity;
        if (newStart < exEnd && newEnd > exStart) {
          if (r.memberId === input.memberId) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This member already holds an overlapping term in this body.",
            });
          }
          throw new TRPCError({
            code: "CONFLICT",
            message: `The seat "${input.seat}" is already filled for the requested term.`,
          });
        }
      }
      const res = await db.insert(schema.govRoles).values(input);
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
        scope: z
          .enum(["global", "chapter", "zone", "region", "country"])
          .default("global"),
        scopeId: z.number().int().positive().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const scopeId = input.scope === "global" ? null : (input.scopeId ?? null);
      const values = {
        title: input.title,
        body: input.body,
        version: input.version,
        scope: input.scope,
        scopeId,
      };
      if (input.id) {
        await db
          .update(schema.policies)
          .set(values)
          .where(eq(schema.policies.id, input.id));
        await audit(ctx.user, "policy.update", {
          type: "policy",
          id: input.id,
          detail: `${input.title} (${input.scope}${scopeId ? ` #${scopeId}` : ""})`,
        });
        return { ok: true, id: input.id };
      }
      const res = await db.insert(schema.policies).values(values);
      const id = Number((res as unknown as [{ insertId: number }])[0].insertId);
      await audit(ctx.user, "policy.create", {
        type: "policy",
        id,
        detail: `${input.title} (${input.scope}${scopeId ? ` #${scopeId}` : ""})`,
      });
      return { ok: true, id };
    }),

  /* ------------------------------- library -------------------------------- */
  reportsChapterScorecards: scopedAdmin("chapters").query(() =>
    chapterScorecards()
  ),

  /* ------------------------- franchise readiness -------------------------- */
  franchiseReadiness: scopedAdmin("chapters")
    .input(z.object({ chapterId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const chapter = (
        await db
          .select({
            id: schema.chapters.id,
            name: schema.chapters.name,
            status: schema.chapters.status,
            charterDate: schema.chapters.charterDate,
            zoneId: schema.chapters.zoneId,
          })
          .from(schema.chapters)
          .where(eq(schema.chapters.id, input.chapterId))
          .limit(1)
      ).at(0);
      if (!chapter) throw new TRPCError({ code: "NOT_FOUND" });

      const [[memberRow], roles, budgetRows, cadenceRows] = await Promise.all([
        db
          .select({ n: sql<number>`count(*)` })
          .from(schema.members)
          .where(eq(schema.members.homeChapterId, input.chapterId)),
        db
          .select({ role: schema.chapterRoles.role })
          .from(schema.chapterRoles)
          .where(
            and(
              eq(schema.chapterRoles.chapterId, input.chapterId),
              eq(schema.chapterRoles.status, "active")
            )
          ),
        db
          .select({ amount: schema.chapterBudgets.amount })
          .from(schema.chapterBudgets)
          .where(
            and(
              eq(schema.chapterBudgets.chapterId, input.chapterId),
              eq(schema.chapterBudgets.status, "approved"),
              eq(schema.chapterBudgets.kind, "allocation")
            )
          ),
        db
          .select({ id: schema.cadences.id })
          .from(schema.cadences)
          .where(
            and(
              eq(schema.cadences.chapterId, input.chapterId),
              eq(schema.cadences.active, 1)
            )
          ),
      ]);

      const items = evaluateFranchiseReadiness({
        status: chapter.status,
        charterDate: chapter.charterDate,
        zoneId: chapter.zoneId,
        memberCount: Number(memberRow?.n ?? 0),
        activeRoleKeys: roles.map(r => r.role),
        approvedBudgetAed: budgetRows.reduce(
          (sum, r) => sum + (r.amount ?? 0),
          0
        ),
        activeCadenceCount: cadenceRows.length,
      });

      return {
        chapterId: input.chapterId,
        name: chapter.name,
        status: chapter.status,
        items,
        score: readinessScore(items),
      };
    }),

  franchiseOnboarding: scopedAdmin("chapters")
    .input(z.object({ chapterId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await listFranchiseOnboarding(input.chapterId);
      return { chapterId: input.chapterId, rows };
    }),

  updateFranchiseOnboardingItem: scopedAdmin("chapters")
    .input(
      z.object({
        chapterId: z.number().int().positive(),
        itemKey: z.string().min(1).max(64),
        status: z.enum(["pending", "in_progress", "done", "skipped"]).optional(),
        assignedMemberId: z.number().int().positive().nullable().optional(),
        dueAt: z.coerce.date().nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { chapterId, itemKey, ...patch } = input;
      await updateFranchiseOnboardingItem(chapterId, itemKey, {
        ...patch,
        dueAt: patch.dueAt === null ? null : patch.dueAt,
      });
      await audit(ctx.user, "franchise.onboarding.update", {
        type: "chapter",
        id: chapterId,
        detail: `${itemKey} → ${patch.status ?? "updated"}`,
      });
      return { ok: true };
    }),

  /* Grant charter to a provisional chapter once it passes the franchise
     readiness checklist. Sets charter date, promotes status, and notifies the
     country / national directors who oversee the chapter. */
  grantCharter: scopedAdmin("chapters")
    .input(z.object({ chapterId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const chapter = (
        await db
          .select()
          .from(schema.chapters)
          .where(eq(schema.chapters.id, input.chapterId))
          .limit(1)
      ).at(0);
      if (!chapter) throw new TRPCError({ code: "NOT_FOUND" });
      if (chapter.status !== "provisional")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only provisional chapters can be granted a charter.",
        });

      const [[memberRow], roles, budgetRows, cadenceRows] = await Promise.all([
        db
          .select({ n: sql<number>`count(*)` })
          .from(schema.members)
          .where(eq(schema.members.homeChapterId, input.chapterId)),
        db
          .select({ role: schema.chapterRoles.role })
          .from(schema.chapterRoles)
          .where(
            and(
              eq(schema.chapterRoles.chapterId, input.chapterId),
              eq(schema.chapterRoles.status, "active")
            )
          ),
        db
          .select({ amount: schema.chapterBudgets.amount })
          .from(schema.chapterBudgets)
          .where(
            and(
              eq(schema.chapterBudgets.chapterId, input.chapterId),
              eq(schema.chapterBudgets.status, "approved"),
              eq(schema.chapterBudgets.kind, "allocation")
            )
          ),
        db
          .select({ id: schema.cadences.id })
          .from(schema.cadences)
          .where(
            and(
              eq(schema.cadences.chapterId, input.chapterId),
              eq(schema.cadences.active, 1)
            )
          ),
      ]);

      const items = evaluateFranchiseReadiness({
        status: chapter.status,
        charterDate: chapter.charterDate,
        zoneId: chapter.zoneId,
        memberCount: Number(memberRow?.n ?? 0),
        activeRoleKeys: roles.map(r => r.role),
        approvedBudgetAed: budgetRows.reduce(
          (sum, r) => sum + (r.amount ?? 0),
          0
        ),
        activeCadenceCount: cadenceRows.length,
      });
      const score = readinessScore(items);
      if (!score.ready)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Franchise readiness is ${score.percent}%. All requirements must pass before granting a charter.`,
        });

      const now = new Date();
      await db
        .update(schema.chapters)
        .set({
          status: "chartered",
          charterDate: chapter.charterDate ?? now,
        })
        .where(eq(schema.chapters.id, input.chapterId));

      await audit(ctx.user, "chapter.charter.grant", {
        type: "chapter",
        id: input.chapterId,
        detail: `${chapter.name} → chartered`,
      });

      // Notify country / national directors responsible for this chapter.
      let countryId: number | null = null;
      if (chapter.zoneId) {
        const zone = (
          await db
            .select()
            .from(schema.orgUnits)
            .where(eq(schema.orgUnits.id, chapter.zoneId))
            .limit(1)
        ).at(0);
        if (zone?.parentId) {
          const region = (
            await db
              .select()
              .from(schema.orgUnits)
              .where(eq(schema.orgUnits.id, zone.parentId))
              .limit(1)
          ).at(0);
          if (region?.parentId) countryId = region.parentId;
        }
      }
      const directors = countryId
        ? await db
            .select({ memberId: schema.unitRoles.memberId, role: schema.unitRoles.role })
            .from(schema.unitRoles)
            .where(
              and(
                eq(schema.unitRoles.level, "country"),
                eq(schema.unitRoles.unitId, countryId),
                sql`${schema.unitRoles.role} in ('country_director','national_director','National Director','Country Director')`
              )
            )
        : [];
      const msg = `${chapter.name} has met all franchise readiness requirements and been granted a charter.`;
      for (const d of directors) {
        notify(d.memberId, msg, "governance").catch(() => {});
      }

      return { ok: true, chapterId: input.chapterId, charterDate: chapter.charterDate ?? now };
    }),
});
