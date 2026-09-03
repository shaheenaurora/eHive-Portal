import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, scopedAdmin, fullAdmin } from "../middleware";
import {
  awardPoints,
  recomputeScore,
  autoPairBuddy,
  notify,
} from "../queries/circle";
import { applyLifecycleTransition } from "../lib/lifecycle";
import {
  applyProfileEdit,
  proposeChange,
  applyChangeNow,
  decideChange,
  listChangeRequests,
  memberActivity,
  canChangeTier,
  tierChangeHistory,
} from "../queries/member-admin";
import { kycQueue, getKyc, reviewKyc } from "../queries/kyc";
import { pipelineReport } from "../queries/reports";
import { audit } from "../lib/audit";
import { recordAnalyticsEvent } from "../queries/analytics";
import { sendMail } from "../lib/mailer";
import { logger } from "../lib/log";
import {
  tierRank,
  type MemberLifecycle,
  type Tier,
} from "@contracts/constants";
import {
  TIER,
  idInput,
  CHANGE_CATEGORY,
  FIELD_CHANGE,
  mustMember,
} from "./shared";

export const membershipRouter = createRouter({
  applications: scopedAdmin("membership")
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const base = db
        .select({
          app: schema.applications,
          userEmail: schema.users.email,
          userName: schema.users.name,
        })
        .from(schema.applications)
        .leftJoin(schema.users, eq(schema.users.id, schema.applications.userId))
        .orderBy(desc(schema.applications.createdAt))
        .limit(200);
      if (input?.status) {
        base.where(eq(schema.applications.status, input.status as never));
      }
      return base;
    }),

  membershipGateMode: scopedAdmin("membership").query(async () => {
    const row = await getDb()
      .select({ value: schema.appConfig.value })
      .from(schema.appConfig)
      .where(eq(schema.appConfig.key, "membership_gate_mode"))
      .limit(1);
    const value = row.at(0)?.value;
    return {
      mode: ["open", "muslim_only", "values_gated"].includes(value ?? "")
        ? value
        : "open",
    };
  }),

  setMembershipGateMode: scopedAdmin("membership")
    .input(z.object({ mode: z.enum(["open", "muslim_only", "values_gated"]) }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .insert(schema.appConfig)
        .values({ key: "membership_gate_mode", value: input.mode })
        .onDuplicateKeyUpdate({ set: { value: input.mode } });
      await audit(ctx.user, "membership_gate_mode.set", {
        type: "app_config",
        detail: input.mode,
      });
      return { ok: true };
    }),

  setApplicationStatus: scopedAdmin("membership")
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum([
          "received",
          "screening",
          "interview",
          "approved",
          "rejected",
        ]),
        note: z.string().max(2000).optional(),
        tier: TIER.optional(),
        chapterId: z.number().int().positive().optional(), // home chapter at admission
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.id, input.id))
        .limit(1);
      const app = rows.at(0);
      if (!app)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });

      const decided =
        input.status === "approved" || input.status === "rejected";

      if (input.chapterId) {
        const chapter = await db
          .select({
            id: schema.chapters.id,
            deletedAt: schema.chapters.deletedAt,
          })
          .from(schema.chapters)
          .where(eq(schema.chapters.id, input.chapterId))
          .limit(1);
        if (chapter.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected chapter does not exist.",
          });
        }
        if (chapter[0].deletedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot admit a member into a deleted chapter.",
          });
        }
      }

      await db
        .update(schema.applications)
        .set({
          status: input.status,
          note: input.note ?? app.note,
          decidedAt: decided ? new Date() : null,
        })
        .where(eq(schema.applications.id, input.id));

      if (input.status === "approved") {
        // Create membership if none exists yet
        const existing = await db
          .select()
          .from(schema.members)
          .where(eq(schema.members.userId, app.userId))
          .limit(1);
        if (existing.length === 0) {
          const tier = input.tier ?? app.tierRequested;
          const renewal = new Date();
          renewal.setFullYear(renewal.getFullYear() + 1);
          const res = await db.insert(schema.members).values({
            userId: app.userId,
            tier,
            status: "active",
            company: app.company,
            renewalAt: renewal,
            homeChapterId: input.chapterId ?? null, // admitted into a chapter
            lifecycleState: "applicant", // admitted below via the executor
          });
          const memberId = Number(res[0].insertId);
          await db.insert(schema.membershipEvents).values({
            memberId,
            type: "approved",
            toTier: tier,
            note: input.note ?? "Application approved",
          });
          // Admit through the lifecycle executor (applicant → onboarding, ML-03:
          // first 30/60/90 days) so the applicant gets the onboarding welcome
          // notification and a lifecycle audit entry, and status stays coherent.
          await applyLifecycleTransition(memberId, "onboarding", {
            actor: ctx.user,
            reason: input.note ?? "Application approved",
          });
          await awardPoints(memberId, "tenure", 5, "Joined eHive Circle");
          // Onboarding automation: auto-pair a buddy (never block approval on it).
          try {
            await autoPairBuddy(memberId);
          } catch (e) {
            logger.error("buddy auto-pair failed", { error: e });
          }
          await audit(ctx.user, "application.approve", {
            type: "application",
            id: input.id,
            detail: `→ member #${memberId} (${tier})`,
          });
          void recordAnalyticsEvent("application_approved", {
            userId: app.userId,
            properties: { applicationId: input.id, memberId, tier },
          });
          return { ok: true, memberId };
        }
      }
      await audit(ctx.user, `application.${input.status}`, {
        type: "application",
        id: input.id,
      });

      if (input.status === "rejected" && app.email) {
        const firstName = (app.name ?? "").split(" ")[0];
        try {
          await sendMail({
            to: app.email,
            subject: "An update on your eHive application",
            html: `<div style="margin:0;padding:24px;background:#F3F1EA;font-family:'Hanken Grotesk',Arial,sans-serif">
              <div style="max-width:520px;margin:0 auto;background:#FBFAF6;border:1px solid #D8D2C4;border-radius:6px;overflow:hidden">
                <div style="background:#16264C;padding:18px 24px">
                  <span style="color:#FBFAF6;font-family:Archivo,Arial,sans-serif;font-weight:800;font-size:19px;letter-spacing:-.01em">eHive</span>
                  <span style="color:#DA3A22;font-weight:800">.</span>
                </div>
                <div style="padding:26px 24px;color:#141312">
                  <p style="margin:0 0 14px;font-size:17px;color:#141312">Hi ${firstName || "there"},</p>
                  <p style="margin:0 0 22px;font-size:16px;line-height:1.55;color:#141312">Thank you for your interest in eHive Circle. After careful review, we won't be able to offer you membership at this time.</p>
                  ${input.note ? `<p style="margin:0 0 22px;font-size:16px;line-height:1.55;color:#141312"><strong>Note:</strong> ${input.note.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string)}</p>` : ""}
                  <p style="margin:0 0 22px;font-size:16px;line-height:1.55;color:#141312">We genuinely appreciate the time you took to apply, and we welcome you to stay connected through our public events and insights.</p>
                </div>
                <div style="padding:16px 24px;border-top:1px solid #E4DECF;color:#8A8578;font-size:12px;line-height:1.5">
                  eHive · Dubai, UAE · <a href="https://ehiveglobal.com" style="color:#DA3A22;text-decoration:none">ehiveglobal.com</a>
                </div>
              </div>
            </div>`,
          });
        } catch {
          /* email failure is non-fatal */
        }
      }

      return { ok: true };
    }),

  /* ------------------------------- members -------------------------------- */
  members: scopedAdmin("membership")
    .input(
      z
        .object({
          q: z.string().max(120).optional(),
          tier: TIER.optional(),
          status: z.enum(["active", "paused", "cancelled"]).optional(),
          lifecycle: z.string().max(24).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input?.tier) conds.push(eq(schema.members.tier, input.tier));
      if (input?.status) conds.push(eq(schema.members.status, input.status));
      if (input?.lifecycle)
        conds.push(eq(schema.members.lifecycleState, input.lifecycle as never));
      if (input?.q) {
        const q = `%${input.q}%`;
        conds.push(
          or(
            like(schema.users.name, q),
            like(schema.users.email, q),
            like(schema.members.company, q)
          )
        );
      }
      return db
        .select({
          member: schema.members,
          userName: schema.users.name,
          userEmail: schema.users.email,
          userAvatar: schema.users.avatar,
        })
        .from(schema.members)
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(schema.members.hiveScore))
        .limit(300);
    }),

  /* Member directory as a CSV for analysis / compliance. Same filters as the
     members list; capped higher than the on-screen view. */
  membersCsv: scopedAdmin("membership")
    .input(
      z
        .object({
          q: z.string().max(120).optional(),
          tier: TIER.optional(),
          status: z.enum(["active", "paused", "cancelled"]).optional(),
          lifecycle: z.string().max(24).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input?.tier) conds.push(eq(schema.members.tier, input.tier));
      if (input?.status) conds.push(eq(schema.members.status, input.status));
      if (input?.lifecycle)
        conds.push(eq(schema.members.lifecycleState, input.lifecycle as never));
      if (input?.q) {
        const term = `%${input.q}%`;
        conds.push(
          or(
            like(schema.users.name, term),
            like(schema.users.email, term),
            like(schema.members.company, term)
          )
        );
      }
      const rows = await db
        .select({
          id: schema.members.id,
          name: schema.users.name,
          email: schema.users.email,
          company: schema.members.company,
          tier: schema.members.tier,
          status: schema.members.status,
          lifecycle: schema.members.lifecycleState,
          hiveScore: schema.members.hiveScore,
          homeChapterId: schema.members.homeChapterId,
          joinedAt: schema.members.joinedAt,
          renewalAt: schema.members.renewalAt,
        })
        .from(schema.members)
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(schema.members.hiveScore))
        .limit(5000);
      const cell = (v: unknown) => {
        const s =
          v == null
            ? ""
            : v instanceof Date
              ? v.toISOString().slice(0, 10)
              : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const headers = [
        "id",
        "name",
        "email",
        "company",
        "tier",
        "status",
        "lifecycle",
        "hiveScore",
        "homeChapterId",
        "joinedAt",
        "renewalAt",
      ];
      const lines = [
        headers.join(","),
        ...rows.map(r =>
          [
            r.id,
            r.name,
            r.email,
            r.company,
            r.tier,
            r.status,
            r.lifecycle,
            r.hiveScore,
            r.homeChapterId,
            r.joinedAt,
            r.renewalAt,
          ]
            .map(cell)
            .join(",")
        ),
      ];
      return {
        filename: `ehive-members-${new Date().toISOString().slice(0, 10)}.csv`,
        csv: lines.join("\n") + "\n",
      };
    }),

  /* Member Lifecycle CRM board — count of members in each state (M1 / Figure 2). */
  lifecycleCounts: scopedAdmin("membership").query(async () => {
    const rows = await getDb()
      .select({
        state: schema.members.lifecycleState,
        n: sql<number>`count(*)`,
      })
      .from(schema.members)
      .groupBy(schema.members.lifecycleState);
    return Object.fromEntries(rows.map(r => [r.state, Number(r.n)]));
  }),

  /* Drive a member along the lifecycle state machine. Every transition is an SOP
     with an owner (the acting admin), a trigger and a notification (ML-01–06). */
  setLifecycleState: scopedAdmin("membership")
    .input(
      z.object({
        memberId: z.number().int().positive(),
        state: z.enum([
          "prospect",
          "guest",
          "applicant",
          "onboarding",
          "active",
          "at_risk",
          "renewal",
          "lapsed",
          "alumni",
          "suspended",
        ]),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await applyLifecycleTransition(input.memberId, input.state, {
        actor: ctx.user,
        reason: input.note,
      });
      return { ok: true };
    }),

  /* Bulk lifecycle transition over a selected set. Each transition is validated
     individually (invalid ones are skipped, not fatal) so one bad member can't
     abort the batch; returns how many actually changed. */
  bulkSetLifecycle: scopedAdmin("membership")
    .input(
      z.object({
        memberIds: z.array(z.number().int().positive()).min(1).max(500),
        state: z.enum([
          "onboarding",
          "active",
          "at_risk",
          "renewal",
          "lapsed",
          "alumni",
          "suspended",
        ]),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let changed = 0;
      for (const id of input.memberIds) {
        try {
          const r = await applyLifecycleTransition(id, input.state, {
            actor: ctx.user,
            reason: input.note,
          });
          if (r.changed) changed++;
        } catch {
          /* skip invalid transition for this member */
        }
      }
      return { ok: true, changed, total: input.memberIds.length };
    }),

  /* Bulk in-app notification to a selected set of members. */
  bulkNotifyMembers: scopedAdmin("membership")
    .input(
      z.object({
        memberIds: z.array(z.number().int().positive()).min(1).max(500),
        text: z.string().min(3).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let sent = 0;
      for (const id of input.memberIds) {
        try {
          await notify(id, input.text, "admin");
          sent++;
        } catch {
          /* non-fatal */
        }
      }
      await audit(ctx.user, "member.bulk.notify", {
        detail: `${sent}/${input.memberIds.length} notified`,
      });
      return { ok: true, sent };
    }),

  memberDetail: scopedAdmin("membership")
    .input(idInput)
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({
          member: schema.members,
          userName: schema.users.name,
          userEmail: schema.users.email,
          userAvatar: schema.users.avatar,
        })
        .from(schema.members)
        .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(eq(schema.members.id, input.id))
        .limit(1);
      const row = rows.at(0);
      if (!row)
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      const mid = row.member.id;
      const [hist, podRows, apps, actions, scoreHist, regs] = await Promise.all(
        [
          db
            .select()
            .from(schema.membershipEvents)
            .where(eq(schema.membershipEvents.memberId, mid))
            .orderBy(desc(schema.membershipEvents.createdAt)),
          db
            .select({ pod: schema.pods, role: schema.podMembers.role })
            .from(schema.podMembers)
            .innerJoin(schema.pods, eq(schema.pods.id, schema.podMembers.podId))
            .where(eq(schema.podMembers.memberId, mid)),
          db
            .select()
            .from(schema.applications)
            .where(eq(schema.applications.userId, row.member.userId))
            .orderBy(desc(schema.applications.createdAt)),
          db
            .select()
            .from(schema.actionItems)
            .where(eq(schema.actionItems.memberId, mid))
            .orderBy(desc(schema.actionItems.createdAt))
            .limit(20),
          db
            .select()
            .from(schema.hiveScoreHistory)
            .where(eq(schema.hiveScoreHistory.memberId, mid))
            .orderBy(desc(schema.hiveScoreHistory.computedAt))
            .limit(12),
          db
            .select({ ev: schema.events, status: schema.eventRegs.status })
            .from(schema.eventRegs)
            .innerJoin(
              schema.events,
              eq(schema.events.id, schema.eventRegs.eventId)
            )
            .where(eq(schema.eventRegs.memberId, mid))
            .orderBy(desc(schema.events.startsAt))
            .limit(20),
        ]
      );
      return {
        ...row,
        history: hist,
        pods: podRows,
        applications: apps,
        actionItems: actions,
        scoreHistory: scoreHist,
        eventRegs: regs,
      };
    }),

  /* -------- ERP member management: profile edits, change requests, ledger -------- */

  /** Immediate profile-field edit (name/email/phone/title/company/sector/stage/goals). */
  editMemberProfile: scopedAdmin("membership")
    .input(
      z.object({
        memberId: z.number().int().positive(),
        name: z.string().max(255).optional(),
        email: z.string().email().max(320).optional(),
        phone: z.string().max(64).optional(),
        title: z.string().max(255).optional(),
        company: z.string().max(255).optional(),
        sector: z.string().max(128).optional(),
        stage: z.string().max(64).optional(),
        goals: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { memberId, ...patch } = input;
      return applyProfileEdit(ctx.user, memberId, patch, "admin");
    }),

  /** Propose a high-impact change (tier/status/lifecycle) — enters the queue. */
  proposeMemberChange: scopedAdmin("membership")
    .input(
      z.object({
        memberId: z.number().int().positive(),
        category: CHANGE_CATEGORY,
        changes: z.array(FIELD_CHANGE).min(1),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      proposeChange(ctx.user, input.memberId, {
        category: input.category,
        changes: input.changes,
        reason: input.reason,
        source: "admin",
      })
    ),

  /** Management discretion: a full admin applies a high-impact change immediately. */
  applyMemberChangeNow: fullAdmin
    .input(
      z.object({
        memberId: z.number().int().positive(),
        category: CHANGE_CATEGORY,
        changes: z.array(FIELD_CHANGE).min(1),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      applyChangeNow(ctx.user, input.memberId, {
        category: input.category,
        changes: input.changes,
        reason: input.reason,
      })
    ),

  /** Corporate approval queue (all pending member change requests). */
  memberChangeRequests: scopedAdmin("membership")
    .input(
      z
        .object({
          includeDecided: z.boolean().optional(),
          memberId: z.number().int().positive().optional(),
        })
        .optional()
    )
    .query(({ input }) =>
      listChangeRequests({
        includeDecided: input?.includeDecided,
        memberId: input?.memberId,
      })
    ),

  /* ---- Member KYC (identity verification) review ---- */
  kycQueue: scopedAdmin("membership").query(() => kycQueue()),

  memberKyc: scopedAdmin("membership")
    .input(z.object({ memberId: z.number().int().positive() }))
    .query(({ input }) => getKyc(input.memberId)),

  reviewKyc: scopedAdmin("membership")
    .input(
      z.object({
        memberId: z.number().int().positive(),
        decision: z.enum(["verified", "rejected"]),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      reviewKyc(ctx.user, input.memberId, input.decision, input.note)
    ),

  /** Approve/reject a pending request (four-eyes enforced in the service). */
  decideMemberChange: scopedAdmin("membership")
    .input(
      z.object({
        id: z.number().int().positive(),
        decision: z.enum(["approve", "reject"]),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      decideChange(ctx.user, input.id, input.decision, input.note)
    ),

  /** Unified activity ledger for one member. */
  memberActivity: scopedAdmin("membership")
    .input(idInput)
    .query(({ input }) => memberActivity(input.id)),

  setMemberTier: scopedAdmin("membership")
    .input(
      z.object({
        memberId: z.number().int().positive(),
        tier: TIER,
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const m = await mustMember(input.memberId);
      if (m.tier === input.tier) return { ok: true };
      const history = await tierChangeHistory(m.id);
      const check = canChangeTier(m, input.tier, history);
      if (!check.ok) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: check.reason,
        });
      }
      const type =
        tierRank(input.tier) > tierRank(m.tier) ? "upgrade" : "downgrade";
      await db
        .update(schema.members)
        .set({ tier: input.tier })
        .where(eq(schema.members.id, m.id));
      await db.insert(schema.membershipEvents).values({
        memberId: m.id,
        type,
        fromTier: m.tier,
        toTier: input.tier,
        note: input.note,
        status: "approved",
        actorEmail: ctx.user.email,
        decidedAt: new Date(),
      });
      await audit(ctx.user, `member.${type}`, {
        type: "member",
        id: m.id,
        detail: `${m.tier} → ${input.tier}`,
      });
      return { ok: true, type };
    }),

  /* Tier-change requests members have submitted, awaiting management approval. */
  pendingTierRequests: scopedAdmin("membership").query(async () => {
    const db = getDb();
    return db
      .select({
        req: schema.membershipEvents,
        member: schema.members,
        userName: schema.users.name,
        userEmail: schema.users.email,
      })
      .from(schema.membershipEvents)
      .innerJoin(
        schema.members,
        eq(schema.members.id, schema.membershipEvents.memberId)
      )
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.membershipEvents.status, "pending"))
      .orderBy(desc(schema.membershipEvents.createdAt))
      .limit(100);
  }),

  /* Approve or reject a member's pending tier change. The member's tier moves
     only on approval — this is the sole path a member-requested change applies. */
  decideTierRequest: scopedAdmin("membership")
    .input(
      z.object({
        id: z.number().int().positive(),
        decision: z.enum(["approve", "reject"]),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const req = (
        await db
          .select()
          .from(schema.membershipEvents)
          .where(eq(schema.membershipEvents.id, input.id))
          .limit(1)
      ).at(0);
      if (!req)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Request not found",
        });
      if (req.status !== "pending")
        throw new TRPCError({
          code: "CONFLICT",
          message: "This request was already decided.",
        });
      const m = await mustMember(req.memberId);

      if (input.decision === "approve") {
        if (!req.toTier) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Request has no target tier.",
          });
        }
        const history = await tierChangeHistory(m.id);
        const check = canChangeTier(m, req.toTier, history);
        if (!check.ok) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: check.reason,
          });
        }
        await db
          .update(schema.members)
          .set({ tier: req.toTier as Tier })
          .where(eq(schema.members.id, m.id));
      }
      await db
        .update(schema.membershipEvents)
        .set({
          status: input.decision === "approve" ? "approved" : "rejected",
          actorEmail: ctx.user.email,
          decidedAt: new Date(),
          note: input.note ?? req.note,
        })
        .where(eq(schema.membershipEvents.id, req.id));
      await audit(ctx.user, `member.tier_request.${input.decision}`, {
        type: "member",
        id: m.id,
        detail: `${req.fromTier ?? m.tier} → ${req.toTier ?? "?"}`,
      });
      const decisionText =
        input.decision === "approve"
          ? `approved — your tier is now ${req.toTier ?? m.tier}.`
          : `not approved at this time${input.note ? `: ${input.note}` : ""}.`;
      await notify(
        m.id,
        `Your tier change request has been ${decisionText}`,
        "membership"
      );
      return { ok: true };
    }),

  setMemberStatus: scopedAdmin("membership")
    .input(
      z.object({
        memberId: z.number().int().positive(),
        status: z.enum(["active", "paused", "cancelled"]),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const m = await mustMember(input.memberId);

      // Map the billing/access status to the canonical lifecycle state so the
      // two cannot drift. Prefer the lifecycle executor (notifications, save
      // cases, audit) when the transition is valid; fall back to a direct
      // coherent update for edge states the executor doesn't allow.
      const lifecycleForStatus: Record<string, MemberLifecycle> = {
        active: "active",
        paused: "suspended",
        cancelled: "lapsed",
      };
      const targetLifecycle = lifecycleForStatus[input.status];

      try {
        await applyLifecycleTransition(input.memberId, targetLifecycle, {
          actor: ctx.user,
          reason: input.note ?? `Admin set status → ${input.status}`,
        });
      } catch {
        // If the lifecycle executor rejects the transition (e.g. alumni →
        // suspended), still keep status/lifecycle coherent with a direct update
        // and log an explicit status event.
        await db
          .update(schema.members)
          .set({ status: input.status, lifecycleState: targetLifecycle })
          .where(eq(schema.members.id, m.id));
      }

      if (input.status !== "active") {
        await db.insert(schema.membershipEvents).values({
          memberId: m.id,
          type: input.status === "paused" ? "pause" : "cancel",
          note: input.note,
        });
      }
      await audit(ctx.user, "member.status", {
        type: "member",
        id: m.id,
        detail: `status → ${input.status} (${targetLifecycle})`,
      });
      return { ok: true };
    }),

  adjustScore: scopedAdmin("membership")
    .input(
      z.object({
        memberId: z.number().int().positive(),
        factor: z.string().max(64),
        points: z.number().int().min(-50).max(50),
        note: z.string().max(255).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await mustMember(input.memberId);
      await awardPoints(
        input.memberId,
        input.factor,
        input.points,
        input.note ?? "Admin adjustment"
      );
      await audit(ctx.user, "member.score.adjust", {
        type: "member",
        id: input.memberId,
        detail: `${input.factor}: ${input.points > 0 ? "+" : ""}${input.points}`,
      });
      return { ok: true };
    }),

  /* --------------------------------- pods --------------------------------- */
  scoreConfig: scopedAdmin("membership").query(async () => {
    const db = getDb();
    const config = await db
      .select()
      .from(schema.hiveScoreConfig)
      .orderBy(schema.hiveScoreConfig.factor);
    const top = await db
      .select({
        member: schema.members,
        userName: schema.users.name,
      })
      .from(schema.members)
      .leftJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.members.status, "active"))
      .orderBy(desc(schema.members.hiveScore))
      .limit(10);
    return { config, top };
  }),

  setScoreWeights: scopedAdmin("membership")
    .input(
      z
        .array(
          z.object({
            factor: z.string().max(64),
            weight: z.number().int().min(0).max(100),
          })
        )
        .min(1)
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      for (const c of input) {
        const existing = await db
          .select()
          .from(schema.hiveScoreConfig)
          .where(eq(schema.hiveScoreConfig.factor, c.factor))
          .limit(1);
        if (existing.length) {
          await db
            .update(schema.hiveScoreConfig)
            .set({ weight: c.weight })
            .where(eq(schema.hiveScoreConfig.factor, c.factor));
        } else {
          await db.insert(schema.hiveScoreConfig).values(c);
        }
      }
      await audit(ctx.user, "member.score.weights", {
        type: "hiveScoreConfig",
        detail: input.map(c => `${c.factor}=${c.weight}`).join(","),
      });
      return { ok: true };
    }),

  recomputeAll: scopedAdmin("membership").mutation(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select({ id: schema.members.id })
      .from(schema.members);
    let n = 0;
    for (const r of rows) {
      await recomputeScore(r.id);
      n++;
    }
    await audit(ctx.user, "member.score.recompute", {
      type: "member",
      detail: `recomputed ${n} members`,
    });
    return { ok: true, recomputed: n };
  }),

  /* --------------------------------- FRP ---------------------------------- */
  reportsPipeline: scopedAdmin("membership").query(() => pipelineReport()),
});
