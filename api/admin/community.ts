import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, scopedAdmin } from "../middleware";
import { computePodHealth, suggestPods } from "../queries/pods";
import { awardRulePoints } from "../queries/circle";
import { audit } from "../lib/audit";
import { EVENT_CHECKIN_OPENS_BEFORE_MS } from "@contracts/constants";
import { TIER, idInput, safeUrl } from "./shared";

export const communityRouter = createRouter({
  pods: scopedAdmin("community").query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.pods)
      .where(isNull(schema.pods.deletedAt))
      .orderBy(desc(schema.pods.createdAt));
    const out = [];
    for (const p of rows) {
      const [mc] = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.podMembers)
        .where(eq(schema.podMembers.podId, p.id));
      const next = await db
        .select()
        .from(schema.sessions)
        .where(
          and(
            eq(schema.sessions.podId, p.id),
            eq(schema.sessions.status, "scheduled")
          )
        )
        .orderBy(schema.sessions.startsAt)
        .limit(1);
      out.push({
        ...p,
        memberCount: mc?.n ?? 0,
        nextSession: next.at(0) ?? null,
      });
    }
    return out;
  }),

  createPod: scopedAdmin("community")
    .input(
      z.object({
        name: z.string().min(2).max(255),
        kind: z.enum(["pod", "mastermind"]).default("pod"),
        facilitator: z.string().max(255).optional(),
        capacity: z.number().int().min(2).max(50).default(8),
        cadence: z.string().max(128).optional(),
        tierGate: TIER.default("horizon"),
        description: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.pods).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  updatePod: scopedAdmin("community")
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(2).max(255).optional(),
        facilitator: z.string().max(255).optional(),
        capacity: z.number().int().min(2).max(50).optional(),
        cadence: z.string().max(128).optional(),
        tierGate: TIER.optional(),
        description: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      await getDb()
        .update(schema.pods)
        .set(patch)
        .where(eq(schema.pods.id, id));
      return { ok: true };
    }),

  archivePod: scopedAdmin("community")
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const pod = (
        await db
          .select()
          .from(schema.pods)
          .where(
            and(eq(schema.pods.id, input.id), isNull(schema.pods.deletedAt))
          )
          .limit(1)
      ).at(0);
      if (!pod)
        throw new TRPCError({ code: "NOT_FOUND", message: "Pod not found" });
      const [members] = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.podMembers)
        .where(eq(schema.podMembers.podId, input.id));
      if ((members?.n ?? 0) > 0)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Archive failed: pod still has members. Remove them first.",
        });
      await db
        .update(schema.pods)
        .set({ deletedAt: new Date() })
        .where(eq(schema.pods.id, input.id));
      await audit(ctx.user, "pod.archive", {
        type: "pod",
        id: input.id,
        detail: pod.name,
      });
      return { ok: true };
    }),

  podAdmin: scopedAdmin("community")
    .input(idInput)
    .query(async ({ input }) => {
      const db = getDb();
      const podRows = await db
        .select()
        .from(schema.pods)
        .where(and(eq(schema.pods.id, input.id), isNull(schema.pods.deletedAt)))
        .limit(1);
      const pod = podRows.at(0);
      if (!pod)
        throw new TRPCError({ code: "NOT_FOUND", message: "Pod not found" });
      const [roster, sess, allMembers] = await Promise.all([
        db
          .select({
            pm: schema.podMembers,
            member: schema.members,
            userName: schema.users.name,
            userEmail: schema.users.email,
          })
          .from(schema.podMembers)
          .innerJoin(
            schema.members,
            eq(schema.members.id, schema.podMembers.memberId)
          )
          .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
          .where(eq(schema.podMembers.podId, input.id)),
        db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.podId, input.id))
          .orderBy(desc(schema.sessions.startsAt))
          .limit(30),
        db
          .select({
            id: schema.members.id,
            tier: schema.members.tier,
            company: schema.members.company,
            userName: schema.users.name,
            userEmail: schema.users.email,
          })
          .from(schema.members)
          .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
          .where(eq(schema.members.status, "active"))
          .orderBy(schema.users.name),
      ]);
      // Attach notes + attendance to sessions
      const sessionIds = sess.map(s => s.id);
      const notes = sessionIds.length
        ? await db
            .select()
            .from(schema.sessionNotes)
            .where(
              sql`${schema.sessionNotes.sessionId} in (${sql.join(
                sessionIds.map(i => sql`${i}`),
                sql`, `
              )})`
            )
        : [];
      const att = sessionIds.length
        ? await db
            .select()
            .from(schema.attendance)
            .where(
              sql`${schema.attendance.sessionId} in (${sql.join(
                sessionIds.map(i => sql`${i}`),
                sql`, `
              )})`
            )
        : [];
      const items = await db
        .select({
          ai: schema.actionItems,
          userName: schema.users.name,
        })
        .from(schema.actionItems)
        .innerJoin(
          schema.members,
          eq(schema.members.id, schema.actionItems.memberId)
        )
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(eq(schema.actionItems.podId, input.id))
        .orderBy(desc(schema.actionItems.createdAt))
        .limit(50);
      const health = await computePodHealth(input.id);
      return {
        pod,
        roster,
        sessions: sess,
        notes,
        attendance: att,
        actionItems: items,
        allMembers,
        health,
      };
    }),

  /* PD-01 matching engine — ranked pod suggestions for placing a member. */
  suggestPodPlacement: scopedAdmin("community")
    .input(idInput)
    .query(async ({ input }) => {
      return suggestPods(input.id);
    }),

  addToPod: scopedAdmin("community")
    .input(
      z.object({
        podId: z.number().int().positive(),
        memberId: z.number().int().positive(),
        role: z.string().max(32).default("member"),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const dup = await db
        .select()
        .from(schema.podMembers)
        .where(
          and(
            eq(schema.podMembers.podId, input.podId),
            eq(schema.podMembers.memberId, input.memberId)
          )
        )
        .limit(1);
      if (dup.length)
        throw new TRPCError({ code: "CONFLICT", message: "Already in pod" });
      await db.insert(schema.podMembers).values(input);
      return { ok: true };
    }),

  removeFromPod: scopedAdmin("community")
    .input(
      z.object({
        podId: z.number().int().positive(),
        memberId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      await getDb()
        .delete(schema.podMembers)
        .where(
          and(
            eq(schema.podMembers.podId, input.podId),
            eq(schema.podMembers.memberId, input.memberId)
          )
        );
      return { ok: true };
    }),

  /* ------------------------------- sessions ------------------------------- */
  createSession: scopedAdmin("community")
    .input(
      z.object({
        podId: z.number().int().positive(),
        startsAt: z.coerce.date(),
        durationMin: z.number().int().min(15).max(480).default(90),
        topic: z.string().max(255).optional(),
        videoLink: safeUrl,
        location: z.string().max(255).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.sessions).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  setSessionStatus: scopedAdmin("community")
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["scheduled", "done", "cancelled"]),
      })
    )
    .mutation(async ({ input }) => {
      await getDb()
        .update(schema.sessions)
        .set({ status: input.status })
        .where(eq(schema.sessions.id, input.id));
      return { ok: true };
    }),

  saveSessionNotes: scopedAdmin("community")
    .input(
      z.object({
        sessionId: z.number().int().positive(),
        summary: z.string().max(8000),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db
        .select()
        .from(schema.sessionNotes)
        .where(eq(schema.sessionNotes.sessionId, input.sessionId))
        .limit(1);
      if (existing.length) {
        await db
          .update(schema.sessionNotes)
          .set({ summary: input.summary })
          .where(eq(schema.sessionNotes.sessionId, input.sessionId));
      } else {
        await db
          .insert(schema.sessionNotes)
          .values({ sessionId: input.sessionId, summary: input.summary });
      }
      return { ok: true };
    }),

  markAttendance: scopedAdmin("community")
    .input(
      z.object({
        sessionId: z.number().int().positive(),
        memberId: z.number().int().positive(),
        status: z.enum(["attended", "absent", "excused"]),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      // Temporal integrity: attendance can't be recorded for a session that
      // hasn't happened yet (opens 2h before it starts).
      if (input.status === "attended") {
        const s = (
          await db
            .select()
            .from(schema.sessions)
            .where(eq(schema.sessions.id, input.sessionId))
            .limit(1)
        ).at(0);
        if (
          s &&
          Date.now() <
            new Date(s.startsAt).getTime() - EVENT_CHECKIN_OPENS_BEFORE_MS
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "This session hasn't started — you can't mark attendance yet.",
          });
      }
      const existing = await db
        .select()
        .from(schema.attendance)
        .where(
          and(
            eq(schema.attendance.sessionId, input.sessionId),
            eq(schema.attendance.memberId, input.memberId)
          )
        )
        .limit(1);
      const prev = existing.at(0);
      if (prev) {
        await db
          .update(schema.attendance)
          .set({ status: input.status, markedAt: new Date() })
          .where(eq(schema.attendance.id, prev.id));
        // award points only on transition to attended
        if (input.status === "attended" && prev.status !== "attended") {
          await awardRulePoints(input.memberId, "session_attend");
        }
      } else {
        await db.insert(schema.attendance).values(input);
        if (input.status === "attended") {
          await awardRulePoints(input.memberId, "session_attend");
        }
      }
      return { ok: true };
    }),

  assignActionItem: scopedAdmin("community")
    .input(
      z.object({
        podId: z.number().int().positive(),
        memberId: z.number().int().positive(),
        sessionId: z.number().int().positive().optional(),
        text: z.string().min(2).max(512),
        dueAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const res = await getDb().insert(schema.actionItems).values(input);
      return { ok: true, id: Number(res[0].insertId) };
    }),

  reopenActionItem: scopedAdmin("community")
    .input(idInput)
    .mutation(async ({ input }) => {
      await getDb()
        .update(schema.actionItems)
        .set({ status: "open", doneAt: null })
        .where(eq(schema.actionItems.id, input.id));
      return { ok: true };
    }),

  /* -------------------------------- events -------------------------------- */
});
