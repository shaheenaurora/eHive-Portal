import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, or, desc, asc, gte, lt, isNull, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { createRouter, authedQuery } from "./middleware";
import { env } from "./lib/env";
import { safeUser } from "./auth-router";
import {
  getMemberByUserId,
  awardPoints,
  nextSessionForMember,
  newCheckinCode,
  promoteWaitlist,
  engagementCounts,
  notify,
} from "./queries/circle";
import {
  proposeChange,
  listChangeRequests,
  canChangeTier,
  tierChangeHistory,
  type FieldChange,
} from "./queries/member-admin";
import {
  computeOnboarding,
  requireOnboardingComplete,
} from "./queries/onboarding";
import { recordAnalyticsEvent } from "./queries/analytics";
import { validatePromo, claimPromo, releasePromo } from "./queries/promo-codes";
import { refundPayment } from "./queries/finance";
import { notifyLead } from "./lib/lead-mail";
import { ONBOARDING_MANUAL_KEYS } from "@contracts/constants";
import { paymentsEnabled, getPaymentProvider } from "./lib/payments";
import { vanguardCheckoutPriceAed, activationPriceAed } from "./lib/vanguard";
import { applyLifecycleTransition } from "./lib/lifecycle";
import { audit } from "./lib/audit";
import {
  tierRank,
  TIER_PRICE_AED,
  SELF_SERVE_TIERS,
  VANGUARD_FOUNDING_APPLICATION_ONLY,
  memberCanAccessEvent,
  eventEligibleTiers,
  TIER_LABEL,
} from "@contracts/constants";
import {
  membershipNo,
  cpdTotal,
  membershipValidThrough,
} from "./lib/member-docs";
import { getKyc, submitKyc, requireKycVerified } from "./queries/kyc";
import { KYC_ID_TYPE_KEYS } from "@contracts/constants";
import { hasOpenDataRequest } from "./lib/pdpl";
import { logger } from "./lib/log";

async function requireMember(userId: number) {
  const member = await getMemberByUserId(userId);
  if (!member)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No active membership yet",
    });
  return member;
}

const GATE_MODES = ["open", "muslim_only", "values_gated"] as const;
type GateMode = (typeof GATE_MODES)[number];

async function getMembershipGateMode(): Promise<GateMode> {
  const row = await getDb()
    .select({ value: schema.appConfig.value })
    .from(schema.appConfig)
    .where(eq(schema.appConfig.key, "membership_gate_mode"))
    .limit(1);
  const value = row.at(0)?.value;
  return (GATE_MODES as readonly string[]).includes(value ?? "")
    ? (value as GateMode)
    : "open";
}

function requireVerified(ctx: { user: { emailVerifiedAt?: Date | null } }) {
  if (!ctx.user.emailVerifiedAt) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Please confirm your email address before continuing.",
    });
  }
}

async function memberPolicyScopeIds(memberId: number): Promise<{
  chapterId?: number;
  zoneId?: number;
  regionId?: number;
  countryId?: number;
}> {
  const db = getDb();
  const member = (
    await db
      .select({ homeChapterId: schema.members.homeChapterId })
      .from(schema.members)
      .where(eq(schema.members.id, memberId))
      .limit(1)
  ).at(0);
  if (!member?.homeChapterId) return {};
  const chapter = (
    await db
      .select({ zoneId: schema.chapters.zoneId })
      .from(schema.chapters)
      .where(eq(schema.chapters.id, member.homeChapterId))
      .limit(1)
  ).at(0);
  const ids: {
    chapterId?: number;
    zoneId?: number;
    regionId?: number;
    countryId?: number;
  } = { chapterId: member.homeChapterId };
  if (!chapter?.zoneId) return ids;
  ids.zoneId = chapter.zoneId;
  const zone = (
    await db
      .select({ parentId: schema.orgUnits.parentId })
      .from(schema.orgUnits)
      .where(eq(schema.orgUnits.id, chapter.zoneId))
      .limit(1)
  ).at(0);
  if (!zone?.parentId) return ids;
  ids.regionId = zone.parentId;
  const region = (
    await db
      .select({ parentId: schema.orgUnits.parentId })
      .from(schema.orgUnits)
      .where(eq(schema.orgUnits.id, zone.parentId))
      .limit(1)
  ).at(0);
  if (region?.parentId) ids.countryId = region.parentId;
  return ids;
}

export const circleRouter = createRouter({
  /* ---- self-serve paid join (SRS POR-MEM-03 / INT-01) ---- */
  paymentsEnabled: authedQuery.query(() => ({ enabled: paymentsEnabled() })),

  startCheckout: authedQuery
    .input(
      z.object({
        tier: z.enum(SELF_SERVE_TIERS),
        promoCode: z.string().max(32).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireVerified(ctx);
      if (!paymentsEnabled())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Online payment isn't enabled yet — please apply instead.",
        });
      /* Founding cohort: Vanguard is strictly by application ("forty seats,
       * by application" is the public positioning) — no instant pay-to-join
       * while the founding window holds. Flip VANGUARD_FOUNDING_APPLICATION_ONLY
       * off after the cohort to restore instant payment. */
      if (input.tier === "vanguard" && VANGUARD_FOUNDING_APPLICATION_ONLY)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "During the founding cohort, Vanguard membership is by application — submit your application and we'll be in touch within a few days.",
        });
      const existing = await getMemberByUserId(ctx.user.id);
      if (existing)
        throw new TRPCError({
          code: "CONFLICT",
          message: "You're already a member.",
        });

      // Vanguard uses the founding-cohort charter rate while seats remain and
      // the standard rate once the cohort has filled ("the rate rises"); other
      // tiers use the fixed tier price. (Vanguard self-serve checkout is only
      // reached once VANGUARD_FOUNDING_APPLICATION_ONLY is flipped off — during
      // the founding cohort the application-only gate above blocks it.)
      const priceAed =
        input.tier === "vanguard"
          ? await vanguardCheckoutPriceAed()
          : TIER_PRICE_AED[input.tier];
      const amount = priceAed * 100; // AED → fils
      // Promo code: validate, then atomically claim a use BEFORE creating the
      // provider session so a usage cap can never be oversold. A claim is
      // released again if checkout creation fails.
      let finalAmount = amount;
      let claimedPromoId: number | null = null;
      if (input.promoCode && input.promoCode.trim()) {
        const v = await validatePromo(input.promoCode, input.tier, amount);
        if (!v.ok)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: v.error,
          });
        if (!(await claimPromo(v.promo.id)))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That promo code has been fully used.",
          });
        claimedPromoId = v.promo.id;
        finalAmount = v.discountedFils;
      }
      // Build redirect URLs from the configured public URL — never the request
      // Origin header, which an attacker can set to redirect the member to a
      // phishing domain after checkout.
      const base = env.publicUrl;
      const provider = getPaymentProvider();
      let session;
      try {
        session = await provider.createCheckoutSession({
          tier: input.tier,
          userId: ctx.user.id,
          email: ctx.user.email ?? "",
          amount: finalAmount,
          currency: "aed",
          successUrl: `${base}/portal?paid=1`,
          cancelUrl: `${base}/portal/apply?canceled=1`,
        });
      } catch (err) {
        if (claimedPromoId) await releasePromo(claimedPromoId);
        throw err;
      }
      const { url, providerRef } = session;
      await getDb().insert(schema.paymentRecords).values({
        userId: ctx.user.id,
        provider: provider.name,
        providerRef,
        tier: input.tier,
        amount: finalAmount,
        currency: "aed",
        status: "pending",
        purpose: "membership",
      });
      void recordAnalyticsEvent("payment_started", {
        userId: ctx.user.id,
        properties: {
          tier: input.tier,
          amount: finalAmount,
          fullAmount: amount,
          promo: claimedPromoId != null,
          purpose: "membership",
        },
      });
      return { url };
    }),

  /* ---- ML-05 renewal: pay to renew the current tier for another year ---- */
  startRenewal: authedQuery
    .input(z.object({ promoCode: z.string().max(32).optional() }))
    .mutation(async ({ ctx, input }) => {
      requireVerified(ctx);
      if (!paymentsEnabled())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Online payment isn't enabled yet — the Circle team will help you renew.",
        });
      const m = await getMemberByUserId(ctx.user.id);
      if (!m)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "You don't have a membership to renew.",
        });
      // Only a SUSPENDED membership can't be self-reactivated by paying —
      // reinstatement after a conduct suspension is an admin decision. Lapsed and
      // alumni members CAN self-renew: paid win-back (lapsed → active, alumni →
      // active) is an allowed lifecycle transition, so blocking it here would
      // contradict the lifecycle matrix and lose reactivation revenue.
      if (m.lifecycleState === "suspended")
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Your membership is under review and can't be renewed online. Please contact the Circle team to reinstate it.",
        });
      const tier = m.tier;
      const amount = TIER_PRICE_AED[tier] * 100; // AED → fils
      // Promo codes apply to renewals too (win-back campaigns). Same
      // validate→claim→release discipline as the initial join checkout.
      let finalAmount = amount;
      let claimedPromoId: number | null = null;
      if (input.promoCode && input.promoCode.trim()) {
        const v = await validatePromo(input.promoCode, tier, amount);
        if (!v.ok)
          throw new TRPCError({ code: "BAD_REQUEST", message: v.error });
        if (!(await claimPromo(v.promo.id)))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That promo code has been fully used.",
          });
        claimedPromoId = v.promo.id;
        finalAmount = v.discountedFils;
      }
      // Redirect URLs come from the configured public URL, not the request Origin
      // header (which an attacker could point at a phishing domain).
      const base = env.publicUrl;
      const provider = getPaymentProvider();
      let session;
      try {
        session = await provider.createCheckoutSession({
          tier,
          userId: ctx.user.id,
          email: ctx.user.email ?? "",
          amount: finalAmount,
          currency: "aed",
          successUrl: `${base}/portal/membership?renewed=1`,
          cancelUrl: `${base}/portal/membership?canceled=1`,
        });
      } catch (err) {
        if (claimedPromoId) await releasePromo(claimedPromoId);
        throw err;
      }
      const { url, providerRef } = session;
      await getDb().insert(schema.paymentRecords).values({
        userId: ctx.user.id,
        provider: provider.name,
        providerRef,
        tier,
        amount: finalAmount,
        currency: "aed",
        status: "pending",
        purpose: "renewal",
      });
      void recordAnalyticsEvent("payment_started", {
        userId: ctx.user.id,
        properties: {
          tier,
          amount: finalAmount,
          fullAmount: amount,
          promo: claimedPromoId != null,
          purpose: "renewal",
        },
      });
      return { url };
    }),

  /* ---- Vanguard week-one Clarity Sprint activation (AED 499) ---- */
  activationStatus: authedQuery.query(async ({ ctx }) => {
    const priceAed = await activationPriceAed();
    const paid = await getDb()
      .select({ id: schema.paymentRecords.id })
      .from(schema.paymentRecords)
      .where(
        and(
          eq(schema.paymentRecords.userId, ctx.user.id),
          eq(schema.paymentRecords.purpose, "activation"),
          eq(schema.paymentRecords.status, "paid")
        )
      )
      .limit(1);
    return { priceAed, purchased: paid.length > 0, enabled: paymentsEnabled() };
  }),

  startActivation: authedQuery.mutation(async ({ ctx }) => {
    requireVerified(ctx);
    if (!paymentsEnabled())
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Online payment isn't enabled yet.",
      });
    const member = await getMemberByUserId(ctx.user.id);
    if (!member)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "The activation is for members. Complete your membership first.",
      });
    // One activation per member — don't let someone pay twice.
    const already = await getDb()
      .select({ id: schema.paymentRecords.id })
      .from(schema.paymentRecords)
      .where(
        and(
          eq(schema.paymentRecords.userId, ctx.user.id),
          eq(schema.paymentRecords.purpose, "activation"),
          eq(schema.paymentRecords.status, "paid")
        )
      )
      .limit(1);
    if (already.length)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Your Clarity Sprint activation is already active.",
      });
    const amount = (await activationPriceAed()) * 100; // AED → fils
    const base = env.publicUrl;
    const provider = getPaymentProvider();
    const { url, providerRef } = await provider.createCheckoutSession({
      tier: member.tier,
      userId: ctx.user.id,
      email: ctx.user.email ?? "",
      amount,
      currency: "aed",
      label: "eHive — Clarity Sprint activation",
      successUrl: `${base}/portal?activated=1`,
      cancelUrl: `${base}/portal/membership?canceled=1`,
    });
    // No tier on the record: the webhook only touches membership lifecycle when a
    // tier is present, so an activation payment never renews or re-activates.
    await getDb().insert(schema.paymentRecords).values({
      userId: ctx.user.id,
      provider: provider.name,
      providerRef,
      amount,
      currency: "aed",
      status: "pending",
      purpose: "activation",
    });
    void recordAnalyticsEvent("payment_started", {
      userId: ctx.user.id,
      properties: { amount, purpose: "activation" },
    });
    return { url };
  }),

  /* ---- Tier upgrade: pay the prorated difference to a higher tier now.
   *  The new tier takes effect on payment confirmation (webhook "upgrade"
   *  branch) and starts a fresh year on the higher tier. Downgrades stay on
   *  the admin-approved change-request path. */
  startUpgrade: authedQuery
    .input(
      z.object({
        toTier: z.enum(["horizon", "ascent", "vanguard", "zenith"]),
        promoCode: z.string().max(32).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireVerified(ctx);
      if (!paymentsEnabled())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Online payment isn't enabled yet — the Circle team will help you upgrade.",
        });
      const m = await getMemberByUserId(ctx.user.id);
      if (!m)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "You don't have a membership to upgrade.",
        });
      if (m.lifecycleState === "suspended")
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Your membership is under review and can't be changed online. Please contact the Circle team.",
        });
      if (tierRank(input.toTier) <= tierRank(m.tier))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Upgrades must be to a higher tier.",
        });
      const renewalAt = m.renewalAt ? new Date(m.renewalAt) : null;
      if (!renewalAt || renewalAt <= new Date())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Renew your membership first, then upgrade.",
        });
      // Prorate the tier difference across the remaining days of the term:
      // delta = (priceTo - priceFrom) × remainingDays / 365.
      const remainingDays = Math.min(
        365,
        Math.max(
          0,
          Math.ceil((renewalAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        )
      );
      const deltaFils = Math.max(
        1,
        Math.round(
          ((TIER_PRICE_AED[input.toTier] - TIER_PRICE_AED[m.tier]) *
            100 *
            remainingDays) /
            365
        )
      );
      let finalAmount = deltaFils;
      let claimedPromoId: number | null = null;
      if (input.promoCode && input.promoCode.trim()) {
        const v = await validatePromo(input.promoCode, input.toTier, deltaFils);
        if (!v.ok)
          throw new TRPCError({ code: "BAD_REQUEST", message: v.error });
        if (!(await claimPromo(v.promo.id)))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That promo code has been fully used.",
          });
        claimedPromoId = v.promo.id;
        finalAmount = v.discountedFils;
      }
      const base = env.publicUrl;
      const provider = getPaymentProvider();
      let session;
      try {
        session = await provider.createCheckoutSession({
          tier: input.toTier,
          userId: ctx.user.id,
          email: ctx.user.email ?? "",
          amount: finalAmount,
          currency: "aed",
          successUrl: `${base}/portal/membership?upgraded=1`,
          cancelUrl: `${base}/portal/membership?canceled=1`,
        });
      } catch (err) {
        if (claimedPromoId) await releasePromo(claimedPromoId);
        throw err;
      }
      const { url, providerRef } = session;
      await getDb().insert(schema.paymentRecords).values({
        userId: ctx.user.id,
        provider: provider.name,
        providerRef,
        tier: input.toTier,
        amount: finalAmount,
        currency: "aed",
        status: "pending",
        purpose: "upgrade",
      });
      void recordAnalyticsEvent("payment_started", {
        userId: ctx.user.id,
        properties: {
          tier: input.toTier,
          fromTier: m.tier,
          amount: finalAmount,
          purpose: "upgrade",
        },
      });
      return { url, amount: finalAmount };
    }),

  /* ---- B5 value tracker: "used & saved this year" ---- */
  valueSummary: authedQuery.query(async ({ ctx }) => {
    const member = await getMemberByUserId(ctx.user.id);
    if (!member)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No active membership yet",
      });
    const now = new Date();
    const year = now.getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const rows = await getDb()
      .select({
        id: schema.benefitRedemptions.id,
        kind: schema.benefitRedemptions.kind,
        label: schema.benefitRedemptions.label,
        valueSavedAed: schema.benefitRedemptions.valueSavedAed,
        occurredAt: schema.benefitRedemptions.occurredAt,
      })
      .from(schema.benefitRedemptions)
      .where(
        and(
          eq(schema.benefitRedemptions.memberId, member.id),
          gte(schema.benefitRedemptions.occurredAt, yearStart),
          lt(schema.benefitRedemptions.occurredAt, yearEnd)
        )
      )
      .orderBy(desc(schema.benefitRedemptions.occurredAt));
    const totalSavedAed = rows.reduce((s, r) => s + (r.valueSavedAed || 0), 0);
    // What the member paid for the year — the yardstick the savings are measured
    // against ("saved X against the Y you invested").
    const membershipPaidAed = TIER_PRICE_AED[member.tier];
    return {
      year,
      totalSavedAed,
      membershipPaidAed,
      brokeEven: membershipPaidAed > 0 && totalSavedAed >= membershipPaidAed,
      count: rows.length,
      breakdown: rows,
    };
  }),

  /* ---- ML-05 year-in-review: the member's year, shown at the renewal moment ---- */
  yearInReview: authedQuery.query(async ({ ctx }) => {
    const m = await getMemberByUserId(ctx.user.id);
    if (!m) return null;
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const counts = await engagementCounts(m.id, yearStart);
    const pods =
      (
        await getDb()
          .select({ n: sql<number>`count(*)` })
          .from(schema.podMembers)
          .where(eq(schema.podMembers.memberId, m.id))
      ).at(0)?.n ?? 0;
    return {
      tier: m.tier,
      hiveScore: m.hiveScore,
      memberSince: m.createdAt,
      renewalAt: m.renewalAt,
      lifecycleState:
        (m as { lifecycleState?: string }).lifecycleState ?? "active",
      sessions: counts.sessions,
      oneToOnes: counts.oneToOnes,
      giveBack: counts.giveBack,
      pods,
    };
  }),

  /* ---- identity: user + member + latest application ---- */
  me: authedQuery.query(async ({ ctx }) => {
    const member = await getMemberByUserId(ctx.user.id);
    let application: schema.Application | null = null;
    if (!member) {
      const apps = await getDb()
        .select()
        .from(schema.applications)
        .where(eq(schema.applications.userId, ctx.user.id))
        .orderBy(desc(schema.applications.createdAt))
        .limit(1);
      application = apps.at(0) ?? null;
    }
    return { user: safeUser(ctx.user), member, application };
  }),

  /* ---- membership gate mode (read-only; shown on the apply form) ---- */
  membershipGateMode: authedQuery.query(async () => {
    return { mode: await getMembershipGateMode() };
  }),

  /* ---- Member documents: membership + attendance certificates, CPD credits.
     Everything here is derived from the member's own records. ---- */
  myDocuments: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();

    // Events the member actually attended, newest first, with CPD credits.
    const attended = await db
      .select({
        eventId: schema.events.id,
        title: schema.events.title,
        startsAt: schema.events.startsAt,
        location: schema.events.location,
        kind: schema.events.kind,
        cpdCredits: schema.events.cpdCredits,
      })
      .from(schema.eventRegs)
      .innerJoin(schema.events, eq(schema.events.id, schema.eventRegs.eventId))
      .where(
        and(
          eq(schema.eventRegs.memberId, member.id),
          eq(schema.eventRegs.status, "attended")
        )
      )
      .orderBy(desc(schema.events.startsAt));

    let chapterName: string | null = null;
    if (member.homeChapterId) {
      const ch = (
        await db
          .select({ name: schema.chapters.name })
          .from(schema.chapters)
          .where(eq(schema.chapters.id, member.homeChapterId))
          .limit(1)
      ).at(0);
      chapterName = ch?.name ?? null;
    }

    return {
      membership: {
        memberNo: membershipNo(member.id),
        name: ctx.user.name ?? "Member",
        tier: member.tier,
        tierLabel: TIER_LABEL[member.tier],
        status: member.status,
        chapterName,
        joinedAt: member.joinedAt,
        validThrough: membershipValidThrough(member.joinedAt),
        inGoodStanding: member.status === "active",
      },
      attended,
      cpdTotal: cpdTotal(attended),
    };
  }),

  /* ---- Member KYC (identity verification) ---- */
  myKyc: authedQuery.query(async ({ ctx }) => {
    const m = await requireMember(ctx.user.id);
    return getKyc(m.id);
  }),

  submitKyc: authedQuery
    .input(
      z.object({
        idType: z.enum(KYC_ID_TYPE_KEYS as [string, ...string[]]),
        idNumber: z.string().min(3).max(64),
        nationality: z.string().max(96).optional(),
        idExpiry: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const m = await requireMember(ctx.user.id);
      return submitKyc(m.id, {
        idType: input.idType as never,
        idNumber: input.idNumber,
        nationality: input.nationality ?? null,
        idExpiry: input.idExpiry ?? null,
      });
    }),

  /* ---- application (BRD 9.1: public interest -> screening workflow) ---- */
  submitApplication: authedQuery
    .input(
      z.object({
        name: z.string().min(2),
        company: z.string().optional(),
        stage: z.string().optional(),
        revenue: z.string().optional(),
        why: z.string().max(2000).optional(),
        tierRequested: z.enum(["horizon", "ascent", "vanguard", "zenith"]),
        proofPoint: z.string().max(4000).optional(), // BRD 6.2 — Vanguard proof point
        muslimIdentity: z.boolean().default(false),
        valuesAligned: z.boolean().default(false),
        affirmationNote: z.string().max(500).optional(),
        consent: z.boolean(), // BRD 8.4 — PDPL consent capture
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireVerified(ctx);
      if (!input.consent)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "PDPL consent is required to apply",
        });
      const gateMode = await getMembershipGateMode();
      if (gateMode === "muslim_only" && !input.muslimIdentity) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "At this stage, membership is open to Muslim entrepreneurs so we can build an unambiguous founding culture.",
        });
      }
      if (gateMode === "values_gated" && !input.valuesAligned) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Membership is open to those who share our code of integrity, generosity and accountability.",
        });
      }
      const existing = await getMemberByUserId(ctx.user.id);
      if (existing)
        throw new TRPCError({ code: "CONFLICT", message: "Already a member" });
      const pending = await getDb()
        .select()
        .from(schema.applications)
        .where(
          and(
            eq(schema.applications.userId, ctx.user.id),
            sql`${schema.applications.status} in ('received','screening','interview')`
          )
        )
        .limit(1);
      if (pending.length)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Application already in screening",
        });
      await getDb()
        .insert(schema.applications)
        .values({
          userId: ctx.user.id,
          name: input.name,
          email: ctx.user.email ?? "",
          company: input.company,
          stage: input.stage,
          revenue: input.revenue,
          why: input.why,
          tierRequested: input.tierRequested,
          proofPoint: input.proofPoint,
          muslimIdentity: input.muslimIdentity ? 1 : 0,
          valuesAligned: input.valuesAligned ? 1 : 0,
          affirmationNote: input.affirmationNote,
          consentAt: new Date(),
        });
      void recordAnalyticsEvent("application_submitted", {
        userId: ctx.user.id,
        properties: { tierRequested: input.tierRequested, gateMode },
      });
      // Confirm to the applicant and notify the admissions inbox (best-effort:
      // email failure must never fail the application itself).
      void notifyLead({
        form: "membership-application",
        email: ctx.user.email ?? null,
        payload: {
          name: input.name,
          company: input.company,
          tier: input.tierRequested,
          stage: input.stage,
          revenue: input.revenue,
        },
        sourcePage: "portal/apply",
      }).catch(err =>
        logger.error("application confirmation email failed", { error: err })
      );
      return { ok: true };
    }),

  /* ---- dashboard aggregate ----
     All independent lookups are run in parallel to avoid cascading DB latency. */
  dashboard: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const now = new Date();
    const [
      nextSess,
      openItems,
      myRegs,
      podCount,
      buddyRow,
      eventRow,
      oneToOneRow,
    ] = await Promise.all([
      nextSessionForMember(member.id),
      db
        .select({ id: schema.actionItems.id })
        .from(schema.actionItems)
        .where(
          and(
            eq(schema.actionItems.memberId, member.id),
            eq(schema.actionItems.status, "open")
          )
        ),
      db
        .select({ event: schema.events, reg: schema.eventRegs })
        .from(schema.eventRegs)
        .innerJoin(
          schema.events,
          eq(schema.eventRegs.eventId, schema.events.id)
        )
        .where(
          and(
            eq(schema.eventRegs.memberId, member.id),
            sql`${schema.eventRegs.status} in ('registered','attended')`,
            gte(schema.events.startsAt, now)
          )
        )
        .orderBy(asc(schema.events.startsAt))
        .limit(4),
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.podMembers)
        .where(eq(schema.podMembers.memberId, member.id)),
      db
        .select({ id: schema.buddies.id })
        .from(schema.buddies)
        .where(
          sql`${schema.buddies.newMemberId} = ${member.id} or ${schema.buddies.buddyMemberId} = ${member.id}`
        )
        .limit(1),
      db
        .select({ id: schema.eventRegs.id })
        .from(schema.eventRegs)
        .where(eq(schema.eventRegs.memberId, member.id))
        .limit(1),
      db
        .select({ id: schema.oneToOnes.id })
        .from(schema.oneToOnes)
        .where(
          sql`${schema.oneToOnes.aMemberId} = ${member.id} or ${schema.oneToOnes.bMemberId} = ${member.id}`
        )
        .limit(1),
    ]);

    // Onboarding activation checklist (SRS 5.3 / 13.3).
    const nPods = podCount.at(0)?.n ?? 0;
    const onboarding = {
      profile: !!(member.company && member.phone),
      buddy: buddyRow.length > 0,
      pod: nPods > 0,
      event: eventRow.length > 0,
      oneToOne: oneToOneRow.length > 0,
    };
    const onboardingDone = Object.values(onboarding).every(Boolean);

    return {
      member,
      nextSession: nextSess,
      openActionItems: openItems.length,
      upcomingEvents: myRegs,
      podCount: nPods,
      onboarding,
      onboardingDone,
    };
  }),

  updateProfile: authedQuery
    .input(
      z.object({
        company: z.string().max(255).optional(),
        title: z.string().max(255).optional(),
        phone: z.string().max(64).optional(),
        // POD profile (PD-01) — feeds the matching engine.
        sector: z.string().max(128).optional(),
        stage: z.string().max(64).optional(),
        goals: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      await getDb()
        .update(schema.members)
        .set(input)
        .where(eq(schema.members.id, member.id));
      return { ok: true };
    }),

  /* ---- ERP: member requests a correction to their identity details (name/email).
     These are approval-gated (identity data) — the request enters the change queue
     and a corporate approver or the member's chapter lead decides. ---- */
  requestProfileCorrection: authedQuery
    .input(
      z.object({
        name: z.string().max(255).optional(),
        email: z.string().email().max(320).optional(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const user = (
        await getDb()
          .select({ name: schema.users.name, email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, member.userId))
          .limit(1)
      ).at(0);
      const changes: FieldChange[] = [];
      if (
        input.name !== undefined &&
        input.name.trim() &&
        input.name.trim() !== (user?.name ?? "")
      )
        changes.push({
          field: "name",
          label: "Name",
          from: user?.name ?? "",
          to: input.name.trim(),
        });
      if (
        input.email !== undefined &&
        input.email.trim() &&
        input.email.trim() !== (user?.email ?? "")
      )
        changes.push({
          field: "email",
          label: "Email",
          from: user?.email ?? "",
          to: input.email.trim(),
        });
      if (!changes.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No changes to request.",
        });
      return proposeChange(ctx.user, member.id, {
        category: "profile",
        changes,
        reason: input.note,
        source: "member",
      });
    }),

  /* A member sees the status of change requests they filed. */
  myChangeRequests: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    return listChangeRequests({ memberId: member.id, includeDecided: true });
  }),

  /* ---- membership changes (BRD 9.1: upgrade/downgrade/pause/cancel/renew as events) ---- */
  requestMembershipChange: authedQuery
    .input(
      z.object({
        type: z.enum([
          "upgrade",
          "downgrade",
          "pause",
          "cancel",
          "renew",
          "resume",
        ]),
        toTier: z.enum(["horizon", "ascent", "vanguard", "zenith"]).optional(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();

      // Governance: a tier change is a *request* the member submits — management
      // reviews and approves it. The member's tier is NOT changed here; it moves
      // only when an admin approves the pending request (admin.decideTierRequest).
      if (input.type === "upgrade" || input.type === "downgrade") {
        if (!input.toTier)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Pick a tier to change to.",
          });
        if (input.toTier === member.tier)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That's already your tier.",
          });
        const history = await tierChangeHistory(member.id);
        const check = canChangeTier(member, input.toTier, history, {
          isSelfServe: true,
        });
        if (!check.ok) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: check.reason,
          });
        }
        const existingPending = await db
          .select()
          .from(schema.membershipEvents)
          .where(
            and(
              eq(schema.membershipEvents.memberId, member.id),
              eq(schema.membershipEvents.status, "pending")
            )
          )
          .limit(1);
        if (existingPending.length)
          throw new TRPCError({
            code: "CONFLICT",
            message: "You already have a tier change awaiting approval.",
          });
        // Direction is derived server-side so it always matches the tiers.
        const type =
          tierRank(input.toTier) > tierRank(member.tier)
            ? "upgrade"
            : "downgrade";
        await db.insert(schema.membershipEvents).values({
          memberId: member.id,
          type,
          fromTier: member.tier,
          toTier: input.toTier,
          note: input.note,
          status: "pending",
        });
        return { ok: true, pending: true };
      }

      // Self-serve actions (the member's own right): applied immediately.
      if (
        input.type === "cancel" ||
        input.type === "pause" ||
        input.type === "renew"
      ) {
        await db.insert(schema.membershipEvents).values({
          memberId: member.id,
          type: input.type,
          fromTier: member.tier,
          toTier: member.tier,
          note: input.note,
          status: "applied",
        });
      }
      if (input.type === "cancel") {
        // Route a self-cancel through the lifecycle executor (→ lapsed) so the
        // CRM lifecycle and access status stay coherent (cancelled) instead of
        // drifting to "cancelled status + active lifecycle", and the member is
        // notified. Lapsed keeps the win-back door open.
        await applyLifecycleTransition(member.id, "lapsed", {
          actor: ctx.user,
          reason: input.note || "Member cancelled their membership.",
        });
      } else if (input.type === "pause") {
        // Route a voluntary pause through the lifecycle executor as a suspended
        // state so lifecycleState and access status stay coherent (suspended →
        // paused). The member can self-reinstate later or admin can lift it.
        await applyLifecycleTransition(member.id, "suspended", {
          actor: ctx.user,
          reason: input.note || "Member paused their membership.",
        });
      } else if (input.type === "resume") {
        // Only a voluntary self-pause can be self-resumed. Suspensions from
        // conduct, KYC rejection, or admin action must be lifted by an officer.
        const latestPause = await db
          .select()
          .from(schema.membershipEvents)
          .where(
            and(
              eq(schema.membershipEvents.memberId, member.id),
              eq(schema.membershipEvents.type, "pause"),
              eq(schema.membershipEvents.status, "applied")
            )
          )
          .orderBy(desc(schema.membershipEvents.createdAt))
          .limit(1);
        const isVoluntary =
          latestPause.length &&
          (latestPause[0].note ?? "").startsWith(
            "Member paused their membership"
          );
        if (member.lifecycleState !== "suspended" || !isVoluntary) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Your membership cannot be self-resumed. Please contact chapter leadership.",
          });
        }
        await applyLifecycleTransition(member.id, "active", {
          actor: ctx.user,
          reason: input.note || "Member resumed their membership.",
        });
      } else if (input.type === "renew") {
        // Renewal must be paid for. The only legitimate path is startRenewal
        // (Stripe checkout) followed by webhook confirmation. Reject the free
        // extension here to prevent revenue leakage.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Renewal requires payment. Please complete the renewal checkout.",
        });
      }
      return { ok: true, pending: false };
    }),

  /* Any tier change the member has awaiting management approval (0 or 1). */
  pendingTierRequest: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const row = (
      await getDb()
        .select()
        .from(schema.membershipEvents)
        .where(
          and(
            eq(schema.membershipEvents.memberId, member.id),
            eq(schema.membershipEvents.status, "pending")
          )
        )
        .orderBy(desc(schema.membershipEvents.createdAt))
        .limit(1)
    ).at(0);
    return row ?? null;
  }),

  membershipHistory: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    return getDb()
      .select()
      .from(schema.membershipEvents)
      .where(eq(schema.membershipEvents.memberId, member.id))
      .orderBy(desc(schema.membershipEvents.createdAt))
      .limit(30);
  }),

  /* ---- onboarding: the first 30/60/90 days (ML-03) ---- */
  myOnboarding: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const progress = await computeOnboarding(member);
    return { ...progress, lifecycleState: member.lifecycleState };
  }),

  completeOnboardingStep: authedQuery
    .input(
      z.object({
        milestone: z.string().max(48),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      if (!ONBOARDING_MANUAL_KEYS.includes(input.milestone))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That step is tracked automatically.",
        });
      const db = getDb();
      const existing = await db
        .select({ id: schema.onboardingMilestones.id })
        .from(schema.onboardingMilestones)
        .where(
          and(
            eq(schema.onboardingMilestones.memberId, member.id),
            eq(schema.onboardingMilestones.milestone, input.milestone)
          )
        )
        .limit(1);
      const already = existing.length > 0;
      if (!already) {
        await db.insert(schema.onboardingMilestones).values({
          memberId: member.id,
          milestone: input.milestone,
          note: input.note,
        });
      }
      // Confirm Active once every milestone is met (ML-03 day-90 outcome).
      const progress = await computeOnboarding(member);
      if (progress.complete && member.lifecycleState === "onboarding") {
        await applyLifecycleTransition(member.id, "active", {
          reason: "Completed onboarding milestones",
          audit: false,
        });
        void recordAnalyticsEvent("member_onboarding_complete", {
          userId: ctx.user.id,
          properties: { memberId: member.id },
        });
      }
      return { ok: true, already, complete: progress.complete };
    }),

  /* ---- PDPL data requests: member self-service export / deletion ---- */
  myDataRequests: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    return getDb()
      .select()
      .from(schema.dataRequests)
      .where(eq(schema.dataRequests.memberId, member.id))
      .orderBy(desc(schema.dataRequests.createdAt))
      .limit(20);
  }),

  requestDataExport: authedQuery.mutation(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    if (await hasOpenDataRequest(member.id, "export"))
      throw new TRPCError({
        code: "CONFLICT",
        message: "You already have an open export request.",
      });
    await getDb().insert(schema.dataRequests).values({
      memberId: member.id,
      kind: "export",
    });
    return { ok: true };
  }),

  requestDataDeletion: authedQuery.mutation(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    if (await hasOpenDataRequest(member.id, "deletion"))
      throw new TRPCError({
        code: "CONFLICT",
        message: "You already have an open deletion request.",
      });
    await getDb().insert(schema.dataRequests).values({
      memberId: member.id,
      kind: "deletion",
    });
    return { ok: true };
  }),

  /* ---- chapter transfers (BRD 6.7): member requests, management approves ---- */
  /* The chapters a member can request to move to (all but their current one). */
  chaptersDirectory: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const rows = await getDb()
      .select({
        id: schema.chapters.id,
        name: schema.chapters.name,
        code: schema.chapters.code,
        country: schema.chapters.country,
        region: schema.chapters.region,
        state: schema.chapters.state,
        city: schema.chapters.city,
        zone: schema.chapters.zone,
        status: schema.chapters.status,
      })
      .from(schema.chapters)
      .where(isNull(schema.chapters.deletedAt))
      .orderBy(asc(schema.chapters.country), asc(schema.chapters.name))
      .limit(200);
    return { chapters: rows, homeChapterId: member.homeChapterId ?? null };
  }),

  myChapterTransfer: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    return (
      (
        await getDb()
          .select()
          .from(schema.chapterTransfers)
          .where(
            and(
              eq(schema.chapterTransfers.memberId, member.id),
              eq(schema.chapterTransfers.status, "pending")
            )
          )
          .orderBy(desc(schema.chapterTransfers.createdAt))
          .limit(1)
      ).at(0) ?? null
    );
  }),

  requestChapterTransfer: authedQuery
    .input(
      z.object({
        toChapterId: z.number().int().positive(),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      if (member.homeChapterId === input.toChapterId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That's already your home chapter.",
        });
      const target = (
        await db
          .select()
          .from(schema.chapters)
          .where(
            and(
              eq(schema.chapters.id, input.toChapterId),
              isNull(schema.chapters.deletedAt)
            )
          )
          .limit(1)
      ).at(0);
      if (!target)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chapter not found",
        });
      const existing = await db
        .select()
        .from(schema.chapterTransfers)
        .where(
          and(
            eq(schema.chapterTransfers.memberId, member.id),
            eq(schema.chapterTransfers.status, "pending")
          )
        )
        .limit(1);
      if (existing.length)
        throw new TRPCError({
          code: "CONFLICT",
          message: "You already have a transfer request awaiting approval.",
        });
      await db.insert(schema.chapterTransfers).values({
        memberId: member.id,
        fromChapterId: member.homeChapterId ?? null,
        toChapterId: input.toChapterId,
        note: input.note,
        status: "pending",
      });
      // Notify destination-chapter officers so they can review the request.
      try {
        const officers = await db
          .select({ memberId: schema.chapterRoles.memberId })
          .from(schema.chapterRoles)
          .where(
            and(
              eq(schema.chapterRoles.chapterId, input.toChapterId),
              eq(schema.chapterRoles.status, "active")
            )
          );
        for (const officer of officers) {
          await notify(
            officer.memberId,
            "A member has requested to transfer into your chapter. Review it in the chapter officer console.",
            "membership"
          );
        }
      } catch (err) {
        logger.error("Failed to notify destination officers of transfer", {
          error: err,
        });
      }
      return { ok: true };
    }),

  /* ---- pods & masterminds (BRD 9.2) ---- */
  myPods: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const rows = await getDb()
      .select({ pod: schema.pods, role: schema.podMembers.role })
      .from(schema.podMembers)
      .innerJoin(schema.pods, eq(schema.podMembers.podId, schema.pods.id))
      .where(eq(schema.podMembers.memberId, member.id));
    // Batch the per-pod member counts into one grouped query (was N+1), and
    // fetch the member's next session once (it's the same regardless of pod).
    const podIds = rows.map(r => r.pod.id);
    const counts = podIds.length
      ? await getDb()
          .select({ podId: schema.podMembers.podId, n: sql<number>`count(*)` })
          .from(schema.podMembers)
          .where(
            sql`${schema.podMembers.podId} in (${sql.join(
              podIds.map(i => sql`${i}`),
              sql`, `
            )})`
          )
          .groupBy(schema.podMembers.podId)
      : [];
    const countMap = new Map(counts.map(c => [c.podId, Number(c.n)]));
    const next = await nextSessionForMember(member.id);
    return rows.map(r => ({
      ...r,
      memberCount: countMap.get(r.pod.id) ?? 0,
      nextSession: next && next.pod.id === r.pod.id ? next.session : null,
    }));
  }),

  podDetail: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const inRoster = await db
        .select()
        .from(schema.podMembers)
        .where(
          and(
            eq(schema.podMembers.podId, input.id),
            eq(schema.podMembers.memberId, member.id)
          )
        )
        .limit(1);
      if (!inRoster.length)
        throw new TRPCError({ code: "FORBIDDEN", message: "Not in this pod" });
      const pod = (
        await db
          .select()
          .from(schema.pods)
          .where(
            and(eq(schema.pods.id, input.id), isNull(schema.pods.deletedAt))
          )
          .limit(1)
      ).at(0);
      if (!pod) throw new TRPCError({ code: "NOT_FOUND" });
      const roster = await db
        .select({
          role: schema.podMembers.role,
          member: schema.members,
          user: schema.users,
        })
        .from(schema.podMembers)
        .innerJoin(
          schema.members,
          eq(schema.podMembers.memberId, schema.members.id)
        )
        .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
        .where(eq(schema.podMembers.podId, input.id));
      // PD-03 — POD content (notes, commitments, sessions) is confidential and
      // withheld until the member accepts the confidentiality agreement.
      const confidentialityAccepted = !!inRoster[0].confidentialityAt;
      if (!confidentialityAccepted) {
        return {
          pod,
          roster,
          sessions: [],
          notes: [],
          myAttendance: [],
          actionItems: [],
          me: member,
          confidentialityAccepted: false,
        };
      }
      const sess = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.podId, input.id))
        .orderBy(desc(schema.sessions.startsAt))
        .limit(12);
      const sessIds = sess.map(s => s.id);
      const notes = sessIds.length
        ? await db
            .select()
            .from(schema.sessionNotes)
            .where(
              sql`${schema.sessionNotes.sessionId} in (${sql.join(
                sessIds.map(i => sql`${i}`),
                sql`, `
              )})`
            )
        : [];
      const myAttendance = sessIds.length
        ? await db
            .select()
            .from(schema.attendance)
            .where(
              and(
                eq(schema.attendance.memberId, member.id),
                sql`${schema.attendance.sessionId} in (${sql.join(
                  sessIds.map(i => sql`${i}`),
                  sql`, `
                )})`
              )
            )
        : [];
      const items = await db
        .select({ item: schema.actionItems, user: schema.users })
        .from(schema.actionItems)
        .innerJoin(
          schema.members,
          eq(schema.actionItems.memberId, schema.members.id)
        )
        .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
        .where(eq(schema.actionItems.podId, input.id))
        .orderBy(desc(schema.actionItems.createdAt))
        .limit(40);
      return {
        pod,
        roster,
        sessions: sess,
        notes,
        myAttendance,
        actionItems: items,
        me: member,
        confidentialityAccepted: true,
      };
    }),

  acceptPodConfidentiality: authedQuery
    .input(z.object({ podId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      await requireKycVerified(member.id);
      const db = getDb();
      const row = (
        await db
          .select()
          .from(schema.podMembers)
          .where(
            and(
              eq(schema.podMembers.podId, input.podId),
              eq(schema.podMembers.memberId, member.id)
            )
          )
          .limit(1)
      ).at(0);
      if (!row)
        throw new TRPCError({ code: "FORBIDDEN", message: "Not in this pod" });
      if (!row.confidentialityAt)
        await db
          .update(schema.podMembers)
          .set({ confidentialityAt: new Date() })
          .where(eq(schema.podMembers.id, row.id));
      return { ok: true };
    }),

  /* ---- member: request a mentor from chapter leadership (ML-03) ---- */
  requestMentor: authedQuery
    .input(z.object({ note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      if (!member.homeChapterId)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "You must belong to a chapter to request a mentor.",
        });
      const db = getDb();
      const officers = await db
        .select({
          memberId: schema.chapterRoles.memberId,
          role: schema.chapterRoles.role,
        })
        .from(schema.chapterRoles)
        .where(
          and(
            eq(schema.chapterRoles.chapterId, member.homeChapterId),
            eq(schema.chapterRoles.status, "active"),
            sql`${schema.chapterRoles.role} in ('vp_learning','president')`
          )
        );
      const msg = `${ctx.user.name ?? "A member"} has requested a mentor${input.note ? `: ${input.note}` : "."}`;
      for (const o of officers) {
        notify(o.memberId, msg, "connect").catch(() => {});
      }
      await audit(
        { id: ctx.user.id, email: ctx.user.email },
        "member.mentor.request",
        {
          type: "member",
          id: member.id,
          detail: input.note ?? "Mentor requested",
        }
      );
      return { ok: true, notified: officers.length };
    }),

  completeActionItem: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const item = (
        await db
          .select()
          .from(schema.actionItems)
          .where(eq(schema.actionItems.id, input.id))
          .limit(1)
      ).at(0);
      if (!item || item.memberId !== member.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      if (item.status === "done") return { ok: true, score: member.hiveScore };
      await db
        .update(schema.actionItems)
        .set({ status: "done", doneAt: new Date() })
        .where(eq(schema.actionItems.id, item.id));
      const score = await awardPoints(
        member.id,
        "action_items",
        5,
        "Action item completed"
      );
      return { ok: true, score };
    }),

  /* ---- events (BRD 9.6) ---- */
  events: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const upcoming = await db
      .select()
      .from(schema.events)
      .where(
        and(
          gte(schema.events.startsAt, new Date()),
          isNull(schema.events.deletedAt),
          or(
            isNull(schema.events.chapterId),
            eq(schema.events.chapterId, member.homeChapterId ?? 0)
          )
        )
      )
      .orderBy(asc(schema.events.startsAt))
      .limit(24);
    const regs = await db
      .select()
      .from(schema.eventRegs)
      .where(
        and(
          eq(schema.eventRegs.memberId, member.id),
          sql`${schema.eventRegs.status} in ('registered','waitlisted','attended')`
        )
      );
    const regMap = new Map(regs.map(r => [r.eventId, r]));
    // Batch seat counts for all upcoming events into one grouped query (was N+1).
    const evIds = upcoming.map(e => e.id);
    const counts = evIds.length
      ? await db
          .select({
            eventId: schema.eventRegs.eventId,
            n: sql<number>`count(*)`,
          })
          .from(schema.eventRegs)
          .where(
            and(
              sql`${schema.eventRegs.eventId} in (${sql.join(
                evIds.map(i => sql`${i}`),
                sql`, `
              )})`,
              sql`${schema.eventRegs.status} in ('registered','attended')`
            )
          )
          .groupBy(schema.eventRegs.eventId)
      : [];
    const countMap = new Map(counts.map(c => [c.eventId, Number(c.n)]));
    return upcoming.map(e => {
      const reg = regMap.get(e.id);
      return {
        ...e,
        registered: !!reg,
        regStatus: reg?.status ?? null,
        checkinCode: reg?.status === "registered" ? reg.checkinCode : null,
        seatsLeft: e.capacity - (countMap.get(e.id) ?? 0),
        // Eligibility now follows the activity's audience settings, not just a
        // single tier floor. `eligibleTiers` lets the client explain the gate.
        allowed: memberCanAccessEvent(member.tier, e),
        eligibleTiers: eventEligibleTiers(e),
      };
    });
  }),

  registerEvent: authedQuery
    .input(z.object({ eventId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      await requireOnboardingComplete(member, "registering for events");
      await requireKycVerified(member.id);
      const db = getDb();
      const ev = (
        await db
          .select()
          .from(schema.events)
          .where(
            and(
              eq(schema.events.id, input.eventId),
              isNull(schema.events.deletedAt)
            )
          )
          .limit(1)
      ).at(0);
      if (!ev) throw new TRPCError({ code: "NOT_FOUND" });
      // Temporal integrity: can't register for an event that has already started.
      if (new Date(ev.startsAt).getTime() <= Date.now())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This event has already started — registration is closed.",
        });
      // Paid events sell seats through the checkout flow; free registration
      // would bypass the ticket price.
      if (ev.ticketPriceMinor && ev.ticketPriceMinor > 0)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This is a paid event — buy a ticket to reserve your seat.",
        });
      if (!memberCanAccessEvent(member.tier, ev))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This activity isn't open to your tier.",
        });
      if (ev.chapterId && ev.chapterId !== member.homeChapterId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This event is for another chapter.",
        });
      // Capacity is enforced inside a transaction that locks the event row, so
      // concurrent registrations for the same event serialize — the count and
      // the seat write can't interleave and oversell the last seat. The unique
      // (eventId, memberId) index makes a double-tap idempotent rather than a
      // second row.
      return db.transaction(async tx => {
        await tx
          .select({ id: schema.events.id })
          .from(schema.events)
          .where(eq(schema.events.id, ev.id))
          .for("update");
        const existing = await tx
          .select()
          .from(schema.eventRegs)
          .where(
            and(
              eq(schema.eventRegs.eventId, ev.id),
              eq(schema.eventRegs.memberId, member.id)
            )
          )
          .limit(1);
        if (existing.length && existing[0].status !== "cancelled")
          throw new TRPCError({
            code: "CONFLICT",
            message: "Already registered",
          });
        const count = await tx
          .select({ n: sql<number>`count(*)` })
          .from(schema.eventRegs)
          .where(
            and(
              eq(schema.eventRegs.eventId, ev.id),
              sql`${schema.eventRegs.status} in ('registered','attended')`
            )
          );
        // BRD 6.4 — at capacity: join the waitlist instead of hard-failing
        const full = (count.at(0)?.n ?? 0) >= ev.capacity;
        if (full) {
          if (existing.length) {
            await tx
              .update(schema.eventRegs)
              .set({ status: "waitlisted" })
              .where(eq(schema.eventRegs.id, existing[0].id));
          } else {
            await tx.insert(schema.eventRegs).values({
              eventId: ev.id,
              memberId: member.id,
              status: "waitlisted",
            });
          }
          return { ok: true, waitlisted: true };
        }
        // points are written at QR check-in (BRD 6.4), not at registration
        if (existing.length) {
          await tx
            .update(schema.eventRegs)
            .set({ status: "registered", checkinCode: newCheckinCode() })
            .where(eq(schema.eventRegs.id, existing[0].id));
        } else {
          await tx.insert(schema.eventRegs).values({
            eventId: ev.id,
            memberId: member.id,
            checkinCode: newCheckinCode(),
          });
        }
        return { ok: true, waitlisted: false };
      });
    }),

  /* ---- paid ticketing: buy a seat through the standard checkout. The seat
   *  is only written when the webhook confirms payment (see boot.ts
   *  "event_ticket" branch) — a pending checkout never holds capacity, and a
   *  sold-out event refunds automatically instead of overselling. */
  startEventTicketCheckout: authedQuery
    .input(z.object({ eventId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      await requireOnboardingComplete(member, "buying event tickets");
      await requireKycVerified(member.id);
      const db = getDb();
      const ev = (
        await db
          .select()
          .from(schema.events)
          .where(
            and(
              eq(schema.events.id, input.eventId),
              isNull(schema.events.deletedAt)
            )
          )
          .limit(1)
      ).at(0);
      if (!ev) throw new TRPCError({ code: "NOT_FOUND" });
      if (new Date(ev.startsAt).getTime() <= Date.now())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This event has already started — ticket sales are closed.",
        });
      if (!ev.ticketPriceMinor || ev.ticketPriceMinor <= 0)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This event is free — just register.",
        });
      if (!memberCanAccessEvent(member.tier, ev))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This activity isn't open to your tier.",
        });
      if (ev.chapterId && ev.chapterId !== member.homeChapterId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This event is for another chapter.",
        });
      const existing = (
        await db
          .select()
          .from(schema.eventRegs)
          .where(
            and(
              eq(schema.eventRegs.eventId, ev.id),
              eq(schema.eventRegs.memberId, member.id)
            )
          )
          .limit(1)
      ).at(0);
      if (existing && ["registered", "attended"].includes(existing.status))
        throw new TRPCError({
          code: "CONFLICT",
          message: "You already have a seat for this event.",
        });
      if (existing?.status === "waitlisted")
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "You're on the waitlist — if a seat opens up you'll be registered, then you can pay for it from your events page.",
        });
      const pendingForEvent = (
        await db
          .select({ id: schema.paymentRecords.id })
          .from(schema.paymentRecords)
          .where(
            and(
              eq(schema.paymentRecords.userId, ctx.user.id),
              eq(schema.paymentRecords.purpose, "event_ticket"),
              eq(schema.paymentRecords.eventId, ev.id),
              eq(schema.paymentRecords.status, "pending")
            )
          )
          .limit(1)
      ).at(0);
      if (pendingForEvent)
        throw new TRPCError({
          code: "CONFLICT",
          message: "You already have a pending ticket purchase for this event.",
        });
      // Soft pre-check so we don't send members to pay for a sold-out event.
      // The authoritative check (with the row lock) happens on the webhook.
      const sold = await db
        .select({ n: sql<number>`count(*)` })
        .from(schema.eventRegs)
        .where(
          and(
            eq(schema.eventRegs.eventId, ev.id),
            sql`${schema.eventRegs.status} in ('registered','attended')`
          )
        );
      if ((sold.at(0)?.n ?? 0) >= ev.capacity)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This event is sold out.",
        });
      if (!paymentsEnabled())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Online payment isn't enabled yet — contact the Circle team for a ticket.",
        });
      const base = env.publicUrl;
      const provider = getPaymentProvider();
      const { url, providerRef } = await provider.createCheckoutSession({
        tier: member.tier,
        userId: ctx.user.id,
        email: ctx.user.email ?? "",
        amount: ev.ticketPriceMinor,
        currency: "aed",
        successUrl: `${base}/portal/events?ticket=1`,
        cancelUrl: `${base}/portal/events?canceled=1`,
      });
      await db.insert(schema.paymentRecords).values({
        userId: ctx.user.id,
        provider: provider.name,
        providerRef,
        tier: member.tier,
        amount: ev.ticketPriceMinor,
        currency: "aed",
        status: "pending",
        purpose: "event_ticket",
        eventId: ev.id,
      });
      void recordAnalyticsEvent("payment_started", {
        userId: ctx.user.id,
        properties: {
          purpose: "event_ticket",
          eventId: ev.id,
          amount: ev.ticketPriceMinor,
        },
      });
      return { url };
    }),

  cancelEventReg: authedQuery
    .input(z.object({ eventId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const reg = (
        await db
          .select()
          .from(schema.eventRegs)
          .where(
            and(
              eq(schema.eventRegs.eventId, input.eventId),
              eq(schema.eventRegs.memberId, member.id)
            )
          )
          .limit(1)
      ).at(0);
      const wasRegistered = reg?.status === "registered";
      await db
        .update(schema.eventRegs)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(schema.eventRegs.eventId, input.eventId),
            eq(schema.eventRegs.memberId, member.id)
          )
        );
      /* Paid ticket cancelled: refund automatically within the standard
       * refund window. A stale charge (past the window) stays cancelled
       * without a refund and the member is told to contact the team. */
      if (wasRegistered && reg?.paymentRecordId) {
        try {
          await refundPayment(
            { id: ctx.user.id, email: ctx.user.email ?? "" },
            reg.paymentRecordId,
            `Event ticket cancelled (event #${input.eventId})`
          );
          notify(
            member.id,
            "Your ticket was cancelled and the refund is on its way to your card. 💳",
            "event"
          ).catch(() => {});
        } catch (err) {
          logger.error("event ticket refund failed", {
            error: err,
            regId: reg.id,
          });
          notify(
            member.id,
            "Your ticket was cancelled. The automatic refund didn't go through — the Circle team will sort it out; no action needed from you.",
            "event"
          ).catch(() => {});
        }
      }
      // BRD 6.4 — freed seat auto-promotes the waitlist
      if (wasRegistered) await promoteWaitlist(input.eventId);
      return { ok: true };
    }),

  /* ---- hive score (BRD 9.3) ---- */
  myScore: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const config = await db.select().from(schema.hiveScoreConfig);
    const sums = await db
      .select({
        factor: schema.scoreEvents.factor,
        total: sql<number>`coalesce(sum(${schema.scoreEvents.points}),0)`,
      })
      .from(schema.scoreEvents)
      .where(eq(schema.scoreEvents.memberId, member.id))
      .groupBy(schema.scoreEvents.factor);
    const history = await db
      .select()
      .from(schema.hiveScoreHistory)
      .where(eq(schema.hiveScoreHistory.memberId, member.id))
      .orderBy(desc(schema.hiveScoreHistory.computedAt))
      .limit(12);
    const recent = await db
      .select()
      .from(schema.scoreEvents)
      .where(eq(schema.scoreEvents.memberId, member.id))
      .orderBy(desc(schema.scoreEvents.createdAt))
      .limit(10);
    return { member, config, sums, history, recent };
  }),

  /* ---- FRP (BRD 9.4) ---- */
  frpCohorts: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const cohorts = await db
      .select()
      .from(schema.frpCohorts)
      .where(sql`${schema.frpCohorts.status} != 'closed'`)
      .orderBy(asc(schema.frpCohorts.startsAt));
    const mine = await db
      .select()
      .from(schema.frpEnrolments)
      .where(
        and(
          eq(schema.frpEnrolments.memberId, member.id),
          sql`${schema.frpEnrolments.status} != 'withdrawn'`
        )
      );
    const mineMap = new Map(mine.map(m => [m.cohortId, m]));
    return cohorts.map(c => ({
      ...c,
      enrolled: mineMap.has(c.id),
      allowed: tierRank(member.tier) >= tierRank(c.tierGate),
    }));
  }),

  frpEnrol: authedQuery
    .input(z.object({ cohortId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const cohort = (
        await db
          .select()
          .from(schema.frpCohorts)
          .where(eq(schema.frpCohorts.id, input.cohortId))
          .limit(1)
      ).at(0);
      if (!cohort) throw new TRPCError({ code: "NOT_FOUND" });
      if (cohort.status !== "open") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This cohort is not open for enrolment.",
        });
      }
      if (tierRank(member.tier) < tierRank(cohort.tierGate))
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "FRP enrolment is gated to " + cohort.tierGate + " and above",
        });
      const dup = await db
        .select()
        .from(schema.frpEnrolments)
        .where(
          and(
            eq(schema.frpEnrolments.cohortId, cohort.id),
            eq(schema.frpEnrolments.memberId, member.id),
            sql`${schema.frpEnrolments.status} != 'withdrawn'`
          )
        )
        .limit(1);
      if (dup.length)
        throw new TRPCError({ code: "CONFLICT", message: "Already enrolled" });
      const res = await db
        .insert(schema.frpEnrolments)
        .values({ cohortId: cohort.id, memberId: member.id });
      const enrolmentId = Number(res[0].insertId);
      for (const key of ["deck", "model", "dataroom"] as const) {
        await db.insert(schema.frpMilestones).values({ enrolmentId, key });
      }
      await db.insert(schema.readinessAssessments).values({ enrolmentId });
      return { ok: true };
    }),

  myFrp: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const rows = await db
      .select({ enr: schema.frpEnrolments, cohort: schema.frpCohorts })
      .from(schema.frpEnrolments)
      .innerJoin(
        schema.frpCohorts,
        eq(schema.frpEnrolments.cohortId, schema.frpCohorts.id)
      )
      .where(
        and(
          eq(schema.frpEnrolments.memberId, member.id),
          sql`${schema.frpEnrolments.status} != 'withdrawn'`
        )
      )
      .orderBy(desc(schema.frpEnrolments.createdAt))
      .limit(1);
    const cur = rows.at(0);
    if (!cur) return null;
    const milestones = await db
      .select()
      .from(schema.frpMilestones)
      .where(eq(schema.frpMilestones.enrolmentId, cur.enr.id));
    const assessment =
      (
        await db
          .select()
          .from(schema.readinessAssessments)
          .where(eq(schema.readinessAssessments.enrolmentId, cur.enr.id))
          .limit(1)
      ).at(0) ?? null;
    return { enrolment: cur.enr, cohort: cur.cohort, milestones, assessment };
  }),

  saveAssessment: authedQuery
    .input(
      z.object({
        enrolmentId: z.number(),
        team: z.number().min(0).max(5),
        traction: z.number().min(0).max(5),
        market: z.number().min(0).max(5),
        financials: z.number().min(0).max(5),
        narrative: z.number().min(0).max(5),
        legal: z.number().min(0).max(5),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const enr = (
        await db
          .select()
          .from(schema.frpEnrolments)
          .where(eq(schema.frpEnrolments.id, input.enrolmentId))
          .limit(1)
      ).at(0);
      if (!enr || enr.memberId !== member.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      await db
        .update(schema.readinessAssessments)
        .set({
          team: input.team,
          traction: input.traction,
          market: input.market,
          financials: input.financials,
          narrative: input.narrative,
          legal: input.legal,
        })
        .where(eq(schema.readinessAssessments.enrolmentId, input.enrolmentId));
      return { ok: true };
    }),

  submitMilestone: authedQuery
    .input(z.object({ id: z.number(), note: z.string().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      const ms = (
        await db
          .select()
          .from(schema.frpMilestones)
          .where(eq(schema.frpMilestones.id, input.id))
          .limit(1)
      ).at(0);
      if (!ms) throw new TRPCError({ code: "NOT_FOUND" });
      const enr = (
        await db
          .select()
          .from(schema.frpEnrolments)
          .where(eq(schema.frpEnrolments.id, ms.enrolmentId))
          .limit(1)
      ).at(0);
      if (!enr || enr.memberId !== member.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      if (ms.status === "reviewed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This milestone has already been reviewed.",
        });
      }
      await db
        .update(schema.frpMilestones)
        .set({ status: "submitted", note: input.note ?? ms.note })
        .where(eq(schema.frpMilestones.id, ms.id));
      return { ok: true };
    }),

  /* ---- governance (BRD 9.5) ---- */
  governance: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const db = getDb();
    const bodies = await db
      .select()
      .from(schema.govBodies)
      .orderBy(asc(schema.govBodies.name));
    const roles = await db
      .select({
        role: schema.govRoles,
        body: schema.govBodies,
        member: schema.members,
        user: schema.users,
      })
      .from(schema.govRoles)
      .innerJoin(
        schema.govBodies,
        eq(schema.govRoles.bodyId, schema.govBodies.id)
      )
      .innerJoin(
        schema.members,
        eq(schema.govRoles.memberId, schema.members.id)
      )
      .innerJoin(schema.users, eq(schema.members.userId, schema.users.id));
    const minutes = await db
      .select({ minute: schema.govMinutes, body: schema.govBodies })
      .from(schema.govMinutes)
      .innerJoin(
        schema.govBodies,
        eq(schema.govMinutes.bodyId, schema.govBodies.id)
      )
      .orderBy(desc(schema.govMinutes.date))
      .limit(12);
    const scopeIds = await memberPolicyScopeIds(member.id);
    const scopeConditions = [
      eq(schema.policies.scope, "global"),
      ...(scopeIds.chapterId
        ? [
            and(
              eq(schema.policies.scope, "chapter"),
              eq(schema.policies.scopeId, scopeIds.chapterId)
            ),
          ]
        : []),
      ...(scopeIds.zoneId
        ? [
            and(
              eq(schema.policies.scope, "zone"),
              eq(schema.policies.scopeId, scopeIds.zoneId)
            ),
          ]
        : []),
      ...(scopeIds.regionId
        ? [
            and(
              eq(schema.policies.scope, "region"),
              eq(schema.policies.scopeId, scopeIds.regionId)
            ),
          ]
        : []),
      ...(scopeIds.countryId
        ? [
            and(
              eq(schema.policies.scope, "country"),
              eq(schema.policies.scopeId, scopeIds.countryId)
            ),
          ]
        : []),
    ];
    const pols = await db
      .select()
      .from(schema.policies)
      .where(or(...scopeConditions))
      .orderBy(desc(schema.policies.createdAt));
    const acks = await db
      .select()
      .from(schema.policyAcks)
      .where(eq(schema.policyAcks.memberId, member.id));
    return {
      bodies,
      roles,
      minutes,
      policies: pols.map(p => ({
        ...p,
        acknowledged: acks.some(a => a.policyId === p.id),
      })),
      myRoles: roles.filter(r => r.member.id === member.id),
    };
  }),

  ackPolicy: authedQuery
    .input(z.object({ policyId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const member = await requireMember(ctx.user.id);
      const db = getDb();
      // Idempotent atomic insert: concurrent duplicate acks collapse to a no-op
      // instead of racing to create duplicate rows.
      await db
        .insert(schema.policyAcks)
        .values({ policyId: input.policyId, memberId: member.id })
        .onDuplicateKeyUpdate({ set: { policyId: input.policyId } });
      return { ok: true };
    }),

  /* ---- library & offers (BRD 9.6 / 6.7) ---- */
  library: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const items = await getDb()
      .select()
      .from(schema.libraryItems)
      .orderBy(desc(schema.libraryItems.createdAt));
    return items.map(i => ({
      ...i,
      locked: tierRank(member.tier) < tierRank(i.tierGate),
    }));
  }),

  offers: authedQuery.query(async ({ ctx }) => {
    const member = await requireMember(ctx.user.id);
    const items = await getDb()
      .select()
      .from(schema.offers)
      .orderBy(asc(schema.offers.vertical), desc(schema.offers.createdAt));
    return items.filter(i => tierRank(member.tier) >= tierRank(i.tierGate));
  }),
});
