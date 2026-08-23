import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc, or, sql, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, scopedAdmin } from "../middleware";
import { audit } from "../lib/audit";
import { notify } from "../queries/circle";

const requestIdInput = z.object({ requestId: z.number().int().positive() });

/** Strip fields that must never leave the system in a member export. */
function exportUser(user: typeof schema.users.$inferSelect) {
  return {
    id: user.id,
    unionId: user.unionId,
    name: user.name,
    email: user.email,
    consentAt: user.consentAt,
    avatar: user.avatar,
    role: user.role,
    adminScopes: user.adminScopes,
    emailVerifiedAt: user.emailVerifiedAt,
    totpEnabled: user.totpEnabled,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastSignInAt: user.lastSignInAt,
  };
}

export const adminDataRequestsRouter = createRouter({
  list: scopedAdmin("finance").query(async () => {
    const db = getDb();
    const rows = await db
      .select({ req: schema.dataRequests, user: schema.users })
      .from(schema.dataRequests)
      .innerJoin(
        schema.members,
        eq(schema.dataRequests.memberId, schema.members.id)
      )
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
      .orderBy(desc(schema.dataRequests.createdAt))
      .limit(100);
    return rows.map(r => ({
      id: r.req.id,
      memberId: r.req.memberId,
      kind: r.req.kind,
      status: r.req.status,
      createdAt: r.req.createdAt,
      memberName: r.user.name ?? r.user.email ?? "Member",
    }));
  }),

  exportData: scopedAdmin("finance")
    .input(requestIdInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const payload = await db.transaction(async tx => {
        const found = (
          await tx
            .select({
              req: schema.dataRequests,
              member: schema.members,
              user: schema.users,
            })
            .from(schema.dataRequests)
            .innerJoin(
              schema.members,
              eq(schema.dataRequests.memberId, schema.members.id)
            )
            .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
            .where(eq(schema.dataRequests.id, input.requestId))
            .limit(1)
        ).at(0);
        if (!found) throw new TRPCError({ code: "NOT_FOUND" });
        const { req, member, user } = found;
        const memberId = member.id;
        const userId = user.id;

        const [
          users,
          members,
          memberKyc,
          membershipEvents,
          memberChangeRequests,
          applications,
          eventRegs,
          eventFeedback,
          referrals,
          oneToOnes,
          buddies,
          scoreEvents,
          scorecardResults,
          notifications,
          pushSubscriptions,
          conductCases,
          memberSaveCases,
          chapterTransfers,
          dataRequests,
          prospects,
          followUps,
          appointments,
        ] = await Promise.all([
          tx.select().from(schema.users).where(eq(schema.users.id, userId)),
          tx
            .select()
            .from(schema.members)
            .where(eq(schema.members.id, memberId)),
          tx
            .select()
            .from(schema.memberKyc)
            .where(eq(schema.memberKyc.memberId, memberId)),
          tx
            .select()
            .from(schema.membershipEvents)
            .where(eq(schema.membershipEvents.memberId, memberId)),
          tx
            .select()
            .from(schema.memberChangeRequests)
            .where(eq(schema.memberChangeRequests.memberId, memberId)),
          tx
            .select()
            .from(schema.applications)
            .where(eq(schema.applications.userId, userId)),
          tx
            .select({ reg: schema.eventRegs, eventTitle: schema.events.title })
            .from(schema.eventRegs)
            .innerJoin(
              schema.events,
              eq(schema.eventRegs.eventId, schema.events.id)
            )
            .where(eq(schema.eventRegs.memberId, memberId)),
          tx
            .select()
            .from(schema.eventFeedback)
            .where(eq(schema.eventFeedback.memberId, memberId)),
          tx
            .select()
            .from(schema.referrals)
            .where(eq(schema.referrals.memberId, memberId)),
          tx
            .select()
            .from(schema.oneToOnes)
            .where(
              or(
                eq(schema.oneToOnes.aMemberId, memberId),
                eq(schema.oneToOnes.bMemberId, memberId)
              )
            ),
          tx
            .select()
            .from(schema.buddies)
            .where(
              or(
                eq(schema.buddies.newMemberId, memberId),
                eq(schema.buddies.buddyMemberId, memberId)
              )
            ),
          tx
            .select()
            .from(schema.scoreEvents)
            .where(eq(schema.scoreEvents.memberId, memberId)),
          tx
            .select()
            .from(schema.scorecardResults)
            .where(eq(schema.scorecardResults.email, user.email)),
          tx
            .select()
            .from(schema.notifications)
            .where(eq(schema.notifications.memberId, memberId)),
          tx
            .select()
            .from(schema.pushSubscriptions)
            .where(eq(schema.pushSubscriptions.memberId, memberId)),
          tx
            .select()
            .from(schema.conductCases)
            .where(
              or(
                eq(schema.conductCases.reporterMemberId, memberId),
                eq(schema.conductCases.subjectMemberId, memberId)
              )
            ),
          tx
            .select()
            .from(schema.memberSaveCases)
            .where(eq(schema.memberSaveCases.memberId, memberId)),
          tx
            .select()
            .from(schema.chapterTransfers)
            .where(eq(schema.chapterTransfers.memberId, memberId)),
          tx
            .select()
            .from(schema.dataRequests)
            .where(eq(schema.dataRequests.memberId, memberId)),
          tx
            .select()
            .from(schema.prospects)
            .where(eq(schema.prospects.email, user.email)),
          tx
            .select()
            .from(schema.followUps)
            .where(eq(schema.followUps.ownerUserId, userId)),
          tx
            .select()
            .from(schema.appointments)
            .where(eq(schema.appointments.email, user.email)),
        ]);

        const tables: Record<string, unknown[]> = {
          users: users.map(exportUser),
          members,
          memberKyc,
          membershipEvents,
          memberChangeRequests,
          applications,
          eventRegs: eventRegs.map(r => ({
            ...r.reg,
            eventTitle: r.eventTitle,
          })),
          eventFeedback,
          referrals,
          oneToOnes,
          buddies,
          scoreEvents,
          scorecardResults,
          notifications,
          pushSubscriptions,
          conductCases,
          memberSaveCases,
          chapterTransfers,
          dataRequests,
          prospects,
          followUps,
          appointments,
        };

        await tx
          .update(schema.dataRequests)
          .set({ status: "done" })
          .where(eq(schema.dataRequests.id, req.id));

        return {
          exportedAt: new Date().toISOString(),
          memberId,
          userId,
          tables,
        };
      });

      try {
        await notify(
          payload.memberId,
          "Your data export is ready in the admin console.",
          "info"
        );
      } catch {
        /* non-fatal */
      }
      await audit(ctx.user, "data_request.export", {
        type: "dataRequest",
        id: input.requestId,
        detail: `member ${payload.memberId}`,
      });

      return { ok: true, payload };
    }),

  deleteData: scopedAdmin("finance")
    .input(requestIdInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const result = await db.transaction(async tx => {
        const found = (
          await tx
            .select({
              req: schema.dataRequests,
              member: schema.members,
              user: schema.users,
            })
            .from(schema.dataRequests)
            .innerJoin(
              schema.members,
              eq(schema.dataRequests.memberId, schema.members.id)
            )
            .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
            .where(eq(schema.dataRequests.id, input.requestId))
            .limit(1)
        ).at(0);
        if (!found) throw new TRPCError({ code: "NOT_FOUND" });
        const { req, member, user } = found;
        const memberId = member.id;
        const userId = user.id;

        // 1. Anonymise the user row (login identity is unusable; id is preserved).
        await tx
          .update(schema.users)
          .set({
            name: "Deleted User",
            email: sql`concat('deleted-', ${schema.users.id}, '@anon.ehive')`,
            avatar: null,
            passwordHash: null,
            totpEnabled: 0,
            totpSecret: null,
            adminScopes: "",
            tokenVersion: sql`tokenVersion + 1`,
          })
          .where(eq(schema.users.id, userId));

        // 2. Anonymise the member row, keeping only roll-up / billing state.
        await tx
          .update(schema.members)
          .set({
            company: null,
            title: null,
            phone: null,
            sector: null,
            stage: null,
            goals: null,
            emailNotify: 0,
          })
          .where(eq(schema.members.id, memberId));

        // 3. Mark the current request done before deleting the dataRequests block.
        await tx
          .update(schema.dataRequests)
          .set({ status: "done" })
          .where(eq(schema.dataRequests.id, req.id));

        // 4. Invalidate credentials and sessions.
        await tx
          .delete(schema.authTokens)
          .where(eq(schema.authTokens.userId, userId));
        await tx
          .delete(schema.pushSubscriptions)
          .where(eq(schema.pushSubscriptions.memberId, memberId));

        // 5. Delete personal-content rows.
        await tx
          .delete(schema.memberKyc)
          .where(eq(schema.memberKyc.memberId, memberId));
        await tx
          .delete(schema.onboardingMilestones)
          .where(eq(schema.onboardingMilestones.memberId, memberId));
        await tx
          .delete(schema.applications)
          .where(eq(schema.applications.userId, userId));
        await tx
          .delete(schema.membershipEvents)
          .where(eq(schema.membershipEvents.memberId, memberId));
        await tx
          .delete(schema.memberChangeRequests)
          .where(eq(schema.memberChangeRequests.memberId, memberId));
        await tx
          .delete(schema.zenithApps)
          .where(eq(schema.zenithApps.userId, userId));
        await tx
          .delete(schema.podMembers)
          .where(eq(schema.podMembers.memberId, memberId));
        await tx
          .delete(schema.attendance)
          .where(eq(schema.attendance.memberId, memberId));
        await tx
          .delete(schema.actionItems)
          .where(eq(schema.actionItems.memberId, memberId));
        await tx
          .delete(schema.eventRegs)
          .where(eq(schema.eventRegs.memberId, memberId));
        await tx
          .delete(schema.eventFeedback)
          .where(eq(schema.eventFeedback.memberId, memberId));
        await tx
          .delete(schema.scoreEvents)
          .where(eq(schema.scoreEvents.memberId, memberId));
        await tx
          .delete(schema.hiveScoreHistory)
          .where(eq(schema.hiveScoreHistory.memberId, memberId));
        await tx
          .delete(schema.referrals)
          .where(eq(schema.referrals.memberId, memberId));
        await tx
          .delete(schema.oneToOnes)
          .where(
            or(
              eq(schema.oneToOnes.aMemberId, memberId),
              eq(schema.oneToOnes.bMemberId, memberId)
            )
          );
        await tx
          .delete(schema.buddies)
          .where(
            or(
              eq(schema.buddies.newMemberId, memberId),
              eq(schema.buddies.buddyMemberId, memberId)
            )
          );
        await tx
          .delete(schema.deals)
          .where(eq(schema.deals.postedBy, memberId));
        await tx
          .delete(schema.endorsements)
          .where(eq(schema.endorsements.memberId, memberId));
        await tx
          .delete(schema.investorIntros)
          .where(eq(schema.investorIntros.memberId, memberId));
        await tx
          .delete(schema.notifications)
          .where(eq(schema.notifications.memberId, memberId));
        // Legal / governance records are retained but reference the now
        // anonymised member/user rows. Deleting them would destroy election
        // outcomes, safeguarding cases, and officer-appointment history.
        // chapterTransfers are personal administrative history and can be removed.
        await tx
          .delete(schema.chapterTransfers)
          .where(eq(schema.chapterTransfers.memberId, memberId));

        // 6. FRP clean-up via enrolment ids.
        const enrolmentRows = await tx
          .select({ id: schema.frpEnrolments.id })
          .from(schema.frpEnrolments)
          .where(eq(schema.frpEnrolments.memberId, memberId));
        const enrolmentIds = enrolmentRows.map(r => r.id);
        if (enrolmentIds.length > 0) {
          await tx
            .delete(schema.readinessAssessments)
            .where(
              inArray(schema.readinessAssessments.enrolmentId, enrolmentIds)
            );
          await tx
            .delete(schema.frpMilestones)
            .where(inArray(schema.frpMilestones.enrolmentId, enrolmentIds));
          await tx
            .delete(schema.frpEnrolments)
            .where(inArray(schema.frpEnrolments.id, enrolmentIds));
        }

        // 7. Awards clean-up.
        await tx
          .update(schema.awardNominations)
          .set({ nominatedByMemberId: null })
          .where(eq(schema.awardNominations.nominatedByMemberId, memberId));
        await tx
          .delete(schema.awardNominations)
          .where(eq(schema.awardNominations.nomineeMemberId, memberId));
        await tx
          .delete(schema.awardRecords)
          .where(eq(schema.awardRecords.memberId, memberId));
        await tx
          .delete(schema.awardVotes)
          .where(eq(schema.awardVotes.voterMemberId, memberId));
        await tx
          .delete(schema.awardIntegrityFlags)
          .where(eq(schema.awardIntegrityFlags.memberId, memberId));
        await tx
          .delete(schema.awardScores)
          .where(eq(schema.awardScores.judgeUserId, userId));
        await tx
          .delete(schema.awardJudges)
          .where(eq(schema.awardJudges.userId, userId));

        // 8. Prospect/lead, appointment and follow-up traces.
        await tx
          .delete(schema.prospects)
          .where(eq(schema.prospects.email, user.email));
        await tx.delete(schema.leads).where(eq(schema.leads.email, user.email));
        await tx
          .delete(schema.appointments)
          .where(eq(schema.appointments.email, user.email));
        await tx
          .delete(schema.followUps)
          .where(eq(schema.followUps.ownerUserId, userId));
        await tx
          .delete(schema.scorecardResults)
          .where(eq(schema.scorecardResults.email, user.email));

        // 9. Finally remove any outstanding data requests for this member.
        await tx
          .delete(schema.dataRequests)
          .where(eq(schema.dataRequests.memberId, memberId));

        return { memberId, userId, kind: req.kind };
      });

      try {
        await notify(
          result.memberId,
          "Your data deletion request has been fulfilled.",
          "info"
        );
      } catch {
        /* non-fatal */
      }
      await audit(ctx.user, "data_request.delete", {
        type: "dataRequest",
        id: input.requestId,
        detail: `member ${result.memberId}`,
      });

      return { ok: true };
    }),

  markDone: scopedAdmin("finance")
    .input(requestIdInput)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const req = (
        await db
          .select()
          .from(schema.dataRequests)
          .where(eq(schema.dataRequests.id, input.requestId))
          .limit(1)
      ).at(0);
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      await db
        .update(schema.dataRequests)
        .set({ status: "done" })
        .where(eq(schema.dataRequests.id, req.id));
      await audit(ctx.user, "data_request.mark_done", {
        type: "dataRequest",
        id: req.id,
        detail: req.kind,
      });
      return { ok: true };
    }),
});
