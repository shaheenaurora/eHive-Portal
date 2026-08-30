import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { createHash } from "crypto";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, authedQuery } from "../middleware";
import { audit } from "../lib/audit";
import { notify } from "../queries/circle";
import {
  MEETING_AGENDA_TEMPLATES,
  seatToChapterRole,
  CHAPTER_TERM_LIMIT_CONSECUTIVE,
} from "@contracts/constants";
import { requireOfficer, assertChapterOwner, assertRoles } from "./shared";

export const officerGovernanceRouter = createRouter({
  /* ------------------------------- elections ------------------------------- */
  elections: authedQuery.query(async ({ ctx }) => {
    const { chapterId } = await requireOfficer(ctx.user.id);
    const db = getDb();
    const els = await db
      .select()
      .from(schema.elections)
      .where(eq(schema.elections.chapterId, chapterId))
      .orderBy(desc(schema.elections.createdAt))
      .limit(50);
    const electionIds = els.map(e => e.id);
    const [allCands, allRoll] = await Promise.all([
      electionIds.length
        ? db
            .select({ candidate: schema.candidates, user: schema.users })
            .from(schema.candidates)
            .innerJoin(
              schema.members,
              eq(schema.candidates.memberId, schema.members.id)
            )
            .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
            .where(inArray(schema.candidates.electionId, electionIds))
        : Promise.resolve(
            [] as {
              candidate: typeof schema.candidates.$inferSelect;
              user: typeof schema.users.$inferSelect;
            }[]
          ),
      electionIds.length
        ? db
            .select({
              electionId: schema.ballotRoll.electionId,
              memberId: schema.ballotRoll.memberId,
            })
            .from(schema.ballotRoll)
            .where(inArray(schema.ballotRoll.electionId, electionIds))
        : Promise.resolve([] as { electionId: number; memberId: number }[]),
    ]);
    const candsByElection = new Map<number, typeof allCands>();
    for (const c of allCands) {
      const arr = candsByElection.get(c.candidate.electionId) ?? [];
      arr.push(c);
      candsByElection.set(c.candidate.electionId, arr);
    }
    const turnoutByElection = new Map<number, number>();
    for (const r of allRoll) {
      turnoutByElection.set(
        r.electionId,
        (turnoutByElection.get(r.electionId) ?? 0) + 1
      );
    }
    return els.map(e => ({
      ...e,
      turnout: turnoutByElection.get(e.id) ?? 0,
      candidates:
        candsByElection.get(e.id)?.map(c => ({
          id: c.candidate.id,
          memberId: c.candidate.memberId,
          name: c.user.name ?? c.user.email ?? "Member",
          statement: c.candidate.statement,
        })) ?? [],
    }));
  }),

  saveElection: authedQuery
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        title: z.string().min(3).max(255),
        seat: z.string().min(2).max(128),
        quorumPct: z.number().int().min(1).max(100).default(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { chapterId, roleKeys } = await requireOfficer(ctx.user.id);
      assertRoles(
        roleKeys,
        ["secretary", "president"],
        "Governance actions require Secretary or President."
      );
      const db = getDb();
      const { id: inputId, ...vals } = input;
      let id = inputId;
      if (id) {
        const existing = await assertChapterOwner(
          (
            await db
              .select()
              .from(schema.elections)
              .where(eq(schema.elections.id, id))
              .limit(1)
          ).at(0),
          chapterId,
          "election"
        );
        if (existing.status !== "open") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Only draft/open elections can be edited.",
          });
        }
        await db
          .update(schema.elections)
          .set(vals)
          .where(eq(schema.elections.id, id));
      } else {
        const res = await db
          .insert(schema.elections)
          .values({ ...vals, chapterId, status: "open" });
        id = Number(res[0].insertId);
      }
      await audit(ctx.user, "officer.election.save", {
        type: "election",
        id,
        detail: `${input.seat} · ${input.title}`,
      });
      return { ok: true, id };
    }),

  setElectionStatus: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["open", "voting", "closed"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { chapterId, roleKeys } = await requireOfficer(ctx.user.id);
      assertRoles(
        roleKeys,
        ["secretary", "president"],
        "Governance actions require Secretary or President."
      );
      const db = getDb();
      const e = await assertChapterOwner(
        (
          await db
            .select()
            .from(schema.elections)
            .where(eq(schema.elections.id, input.id))
            .limit(1)
        ).at(0),
        chapterId,
        "election"
      );
      if (input.status === "voting") {
        await db
          .update(schema.elections)
          .set({ status: "voting", opensAt: new Date() })
          .where(eq(schema.elections.id, e.id));
        const chapterMembers = await db
          .select({ id: schema.members.id })
          .from(schema.members)
          .where(
            and(
              eq(schema.members.homeChapterId, e.chapterId),
              eq(schema.members.status, "active")
            )
          );
        for (const m of chapterMembers) {
          void notify(
            m.id,
            `Voting is now open for ${e.seat}. Cast your ballot before the election closes. 🗳️`,
            "governance"
          ).catch(() => {});
        }
        return { ok: true };
      }
      if (input.status === "closed") {
        const memberCount =
          (
            await db
              .select({ n: sql<number>`count(*)` })
              .from(schema.members)
              .where(
                and(
                  eq(schema.members.homeChapterId, e.chapterId),
                  eq(schema.members.status, "active")
                )
              )
          ).at(0)?.n ?? 0;
        const turnout =
          (
            await db
              .select({ n: sql<number>`count(*)` })
              .from(schema.ballotRoll)
              .where(eq(schema.ballotRoll.electionId, e.id))
          ).at(0)?.n ?? 0;
        const tally = await db
          .select({
            candidateId: schema.ballots.candidateId,
            n: sql<number>`count(*)`,
          })
          .from(schema.ballots)
          .where(eq(schema.ballots.electionId, e.id))
          .groupBy(schema.ballots.candidateId);
        const quorumMet =
          memberCount > 0 && (turnout / memberCount) * 100 >= e.quorumPct;
        const hash = createHash("sha256")
          .update(
            JSON.stringify({
              electionId: e.id,
              tally,
              turnout,
              quorumMet,
              closedAt: Date.now(),
            })
          )
          .digest("hex");
        await db
          .update(schema.elections)
          .set({ status: "closed", closesAt: new Date(), resultHash: hash })
          .where(eq(schema.elections.id, e.id));
        let winner: { memberId: number; name: string; votes: number } | null =
          null;
        const sorted = [...tally].sort((a, b) => Number(b.n) - Number(a.n));
        const top = sorted[0];
        const tied =
          sorted.length > 1 && Number(sorted[1].n) === Number(top?.n ?? 0);
        if (quorumMet && top && Number(top.n) > 0 && !tied) {
          const cand = (
            await db
              .select({
                memberId: schema.candidates.memberId,
                name: schema.users.name,
              })
              .from(schema.candidates)
              .leftJoin(
                schema.members,
                eq(schema.members.id, schema.candidates.memberId)
              )
              .leftJoin(
                schema.users,
                eq(schema.users.id, schema.members.userId)
              )
              .where(eq(schema.candidates.id, top.candidateId))
              .limit(1)
          ).at(0);
          if (cand)
            winner = {
              memberId: cand.memberId,
              name: cand.name ?? "Member",
              votes: Number(top.n),
            };
        }
        let assigned = false;
        let termLimited = false;
        if (winner) {
          const { role, title } = seatToChapterRole(e.seat);
          const priorTerms =
            Number(
              (
                await db
                  .select({ n: sql<number>`count(*)` })
                  .from(schema.chapterRoles)
                  .where(
                    and(
                      eq(schema.chapterRoles.chapterId, e.chapterId),
                      eq(schema.chapterRoles.role, role),
                      eq(schema.chapterRoles.memberId, winner.memberId)
                    )
                  )
              ).at(0)?.n
            ) || 0;
          termLimited =
            role !== "other" && priorTerms >= CHAPTER_TERM_LIMIT_CONSECUTIVE;
          if (!termLimited) {
            await db
              .update(schema.chapterRoles)
              .set({ status: "ended", termEnd: new Date() })
              .where(
                and(
                  eq(schema.chapterRoles.chapterId, e.chapterId),
                  eq(schema.chapterRoles.role, role),
                  eq(schema.chapterRoles.status, "active")
                )
              );
            await db.insert(schema.chapterRoles).values({
              chapterId: e.chapterId,
              memberId: winner.memberId,
              role,
              title,
              electionId: e.id,
              termStart: new Date(),
              status: "active",
              appointedBy: `Election #${e.id}`,
            });
            assigned = true;
            try {
              await notify(
                winner.memberId,
                `You've been elected ${e.seat} — congratulations. Your term starts now. 🗳️`,
                "governance"
              );
            } catch {
              /* non-fatal */
            }
            await audit(ctx.user, "officer.election.seat.filled", {
              type: "member",
              id: winner.memberId,
              detail: `${e.seat} (${role}) @ chapter #${e.chapterId} · election #${e.id}`,
            });
          }
        }
        const resultMsg = tied
          ? `Election for ${e.seat} closed in a tie. The board will schedule a run-off.`
          : termLimited
            ? `Election for ${e.seat} closed, but the winner has reached the term limit — the board will decide the next step.`
            : winner
              ? `Election for ${e.seat} closed — ${winner.name} was elected.`
              : `Election for ${e.seat} closed with no winner.`;
        const chapterMembers = await db
          .select({ id: schema.members.id })
          .from(schema.members)
          .where(
            and(
              eq(schema.members.homeChapterId, e.chapterId),
              eq(schema.members.status, "active")
            )
          );
        for (const m of chapterMembers) {
          void notify(m.id, resultMsg, "governance").catch(() => {});
        }
        return {
          ok: true,
          turnout,
          memberCount,
          quorumMet,
          resultHash: hash,
          seat: e.seat,
          winner,
          assigned,
          tied,
          termLimited,
        };
      }
      await db
        .update(schema.elections)
        .set({ status: "open" })
        .where(eq(schema.elections.id, e.id));
      return { ok: true };
    }),

  /* --------------------------------- motions -------------------------------- */
  motions: authedQuery.query(async ({ ctx }) => {
    const { chapterId } = await requireOfficer(ctx.user.id);
    const db = getDb();
    const mos = await db
      .select()
      .from(schema.motions)
      .where(eq(schema.motions.chapterId, chapterId))
      .orderBy(desc(schema.motions.createdAt))
      .limit(50);
    const motionIds = mos.map(m => m.id);
    const allMotionVotes = motionIds.length
      ? await db
          .select({
            motionId: schema.motionVotes.motionId,
            choice: schema.motionVotes.choice,
            n: sql<number>`count(*)`,
          })
          .from(schema.motionVotes)
          .where(inArray(schema.motionVotes.motionId, motionIds))
          .groupBy(schema.motionVotes.motionId, schema.motionVotes.choice)
      : [];
    const votesByMotion = new Map<number, { choice: string; n: number }[]>();
    for (const v of allMotionVotes) {
      const arr = votesByMotion.get(v.motionId) ?? [];
      arr.push({ choice: v.choice, n: v.n });
      votesByMotion.set(v.motionId, arr);
    }
    return mos.map(m => ({
      ...m,
      votes: votesByMotion.get(m.id) ?? [],
    }));
  }),

  saveMotion: authedQuery
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        title: z.string().min(3).max(255),
        body: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { chapterId, roleKeys } = await requireOfficer(ctx.user.id);
      assertRoles(
        roleKeys,
        ["secretary", "president"],
        "Governance actions require Secretary or President."
      );
      const db = getDb();
      const { id: inputId, ...vals } = input;
      let id = inputId;
      if (id) {
        const existing = await assertChapterOwner(
          (
            await db
              .select()
              .from(schema.motions)
              .where(eq(schema.motions.id, id))
              .limit(1)
          ).at(0),
          chapterId,
          "motion"
        );
        if (existing.status !== "open") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Only open motions can be edited.",
          });
        }
        await db
          .update(schema.motions)
          .set(vals)
          .where(eq(schema.motions.id, id));
      } else {
        const res = await db
          .insert(schema.motions)
          .values({ ...vals, chapterId, status: "open" });
        id = Number(res[0].insertId);
      }
      await audit(ctx.user, "officer.motion.save", {
        type: "motion",
        id,
        detail: input.title,
      });
      return { ok: true, id };
    }),

  closeMotion: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { chapterId, roleKeys } = await requireOfficer(ctx.user.id);
      assertRoles(
        roleKeys,
        ["secretary", "president"],
        "Governance actions require Secretary or President."
      );
      const db = getDb();
      const mo = await assertChapterOwner(
        (
          await db
            .select()
            .from(schema.motions)
            .where(eq(schema.motions.id, input.id))
            .limit(1)
        ).at(0),
        chapterId,
        "motion"
      );
      if (mo.status !== "open")
        throw new TRPCError({
          code: "CONFLICT",
          message: "Motion is not open",
        });
      const votes = await db
        .select({ choice: schema.motionVotes.choice, n: sql<number>`count(*)` })
        .from(schema.motionVotes)
        .where(eq(schema.motionVotes.motionId, mo.id))
        .groupBy(schema.motionVotes.choice);
      const yes = votes.find(v => v.choice === "yes")?.n ?? 0;
      const no = votes.find(v => v.choice === "no")?.n ?? 0;
      const status = yes > no ? "passed" : "rejected";
      await db
        .update(schema.motions)
        .set({ status, closesAt: new Date() })
        .where(eq(schema.motions.id, mo.id));
      await audit(ctx.user, "officer.motion.close", {
        type: "motion",
        id: mo.id,
        detail: `${status} · yes ${yes} · no ${no}`,
      });
      const chapterMembers = await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(
          and(
            eq(schema.members.homeChapterId, chapterId),
            eq(schema.members.status, "active")
          )
        );
      const msg = `Motion "${mo.title}" has closed — ${status} (yes ${yes}, no ${no}).`;
      for (const m of chapterMembers) {
        void notify(m.id, msg, "governance").catch(() => {});
      }
      return { ok: true, status, yes, no };
    }),

  /* -------------------------------- meetings -------------------------------- */
  meetings: authedQuery.query(async ({ ctx }) => {
    const { chapterId } = await requireOfficer(ctx.user.id);
    return getDb()
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.chapterId, chapterId))
      .orderBy(desc(schema.meetings.scheduledAt))
      .limit(50);
  }),

  meetingAttendance: authedQuery
    .input(z.object({ meetingId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const { chapterId } = await requireOfficer(ctx.user.id);
      const db = getDb();
      await assertChapterOwner(
        (
          await db
            .select()
            .from(schema.meetings)
            .where(eq(schema.meetings.id, input.meetingId))
            .limit(1)
        ).at(0),
        chapterId,
        "meeting"
      );
      return db
        .select()
        .from(schema.meetingAttendance)
        .where(eq(schema.meetingAttendance.meetingId, input.meetingId));
    }),

  createMeeting: authedQuery
    .input(
      z.object({
        kind: z.enum(["chapter_meeting", "board_meeting", "huddle", "other"]),
        title: z.string().min(3).max(255),
        scheduledAt: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { chapterId, roleKeys } = await requireOfficer(ctx.user.id);
      assertRoles(
        roleKeys,
        ["secretary", "president"],
        "Governance actions require Secretary or President."
      );
      const db = getDb();
      const res = await db.insert(schema.meetings).values({
        chapterId,
        kind: input.kind,
        title: input.title,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        agenda: MEETING_AGENDA_TEMPLATES[input.kind] ?? "",
      });
      const id = Number(res[0].insertId);
      await audit(ctx.user, "officer.meeting.create", {
        type: "chapter",
        id: chapterId,
        detail: `${input.kind} · ${input.title}`,
      });
      return { ok: true, id };
    }),

  saveMeeting: authedQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        title: z.string().min(3).max(255).optional(),
        agenda: z.string().max(10000).optional(),
        minutes: z.string().max(20000).optional(),
        status: z.enum(["scheduled", "held", "cancelled"]).optional(),
        scheduledAt: z.string().datetime().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { chapterId, roleKeys } = await requireOfficer(ctx.user.id);
      assertRoles(
        roleKeys,
        ["secretary", "president"],
        "Governance actions require Secretary or President."
      );
      const db = getDb();
      const { id, scheduledAt, ...rest } = input;
      await assertChapterOwner(
        (
          await db
            .select()
            .from(schema.meetings)
            .where(eq(schema.meetings.id, id))
            .limit(1)
        ).at(0),
        chapterId,
        "meeting"
      );
      const patch: Partial<typeof schema.meetings.$inferInsert> = { ...rest };
      if (scheduledAt !== undefined)
        patch.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
      await db
        .update(schema.meetings)
        .set(patch)
        .where(eq(schema.meetings.id, id));
      await audit(ctx.user, "officer.meeting.save", {
        type: "meeting",
        id,
        detail: input.title ?? `status → ${input.status}`,
      });
      return { ok: true };
    }),

  setMeetingAttendance: authedQuery
    .input(
      z.object({
        meetingId: z.number().int().positive(),
        entries: z.array(
          z.object({
            memberId: z.number().int().positive(),
            status: z.enum(["present", "absent", "excused"]),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { chapterId, roleKeys } = await requireOfficer(ctx.user.id);
      assertRoles(
        roleKeys,
        ["secretary", "president"],
        "Governance actions require Secretary or President."
      );
      const db = getDb();
      await assertChapterOwner(
        (
          await db
            .select()
            .from(schema.meetings)
            .where(eq(schema.meetings.id, input.meetingId))
            .limit(1)
        ).at(0),
        chapterId,
        "meeting"
      );
      await db
        .delete(schema.meetingAttendance)
        .where(eq(schema.meetingAttendance.meetingId, input.meetingId));
      if (input.entries.length) {
        await db.insert(schema.meetingAttendance).values(
          input.entries.map(e => ({
            meetingId: input.meetingId,
            memberId: e.memberId,
            status: e.status,
          }))
        );
      }
      await audit(ctx.user, "officer.meeting.attendance", {
        type: "meeting",
        id: input.meetingId,
        detail: `${input.entries.filter(e => e.status === "present").length} present`,
      });
      return {
        ok: true,
        count: input.entries.filter(e => e.status === "present").length,
      };
    }),
});

// Re-exported helper for the parent router if needed.
export { requireOfficer };
