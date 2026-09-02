# eHive Portal — Deep Gap Analysis V2

**Date:** 31 August 2026  
**Scope:** Operational/process automation, UI/UX, community journeys (members/chapters/leaders/zones/regions), franchise readiness.  
**Base commit:** `f3fdf10`

---

## Executive Summary

The portal is deployed and stable on Railway, email delivery is working, and the public-site rebrand is live. This second deep audit focuses on what still prevents the platform from operating as an ERP-grade, franchise-ready system:

1. **Operational automation is incomplete.** The scheduler computes chapter health but does not persist it; KPI reports therefore rely on manual snapshots. Payments can stay `pending` if a Stripe webhook is missed, and FX reporting silently falls back to a 1:1 rate.
2. **Community journeys have dead-ends.** Chapter officers cannot raise conduct cases or see Save Playbook cases for their chapter. Members cannot request a mentor, and self-paused members cannot self-resume. Cadence compliance is still fully manual.
3. **UI/UX is inconsistent and not mobile-first.** The public site uses two CSS systems, admin tables overflow on small screens, and several key flows (Apply, admin approval, login) have conflicting or inaccessible controls.
4. **Franchise hierarchy gaps remain.** Charter notifications only reach country directors, regional leaders cannot approve chapter budgets, and Save cases are opened with no owner or SLA.

No critical security vulnerabilities were identified in this pass. The items below are P0/P1 because they block day-to-day operations or create a poor member/officer experience at scale.

---

## P0 — Operations / Process Automation

| #      | Gap                                                                                                                                                                                                                | Evidence                                                                                       | Impact                                                | Recommended Fix                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| O-P0-1 | **Health snapshots are not persisted.** `jobHealthThreshold` calls `computeChapterHealth` and opens `kpiAlerts`, but never writes `healthSnapshots`. `captureKpiSnapshots` then cannot produce chapter CHI trends. | `api/lib/scheduler.ts:338-428`; `api/queries/kpi-snapshots.ts:30-49`                           | Executive/KPI reports show no per-chapter trend data. | Insert a `healthSnapshots` row per chapter inside `jobHealthThreshold` every day.                                                 |
| O-P0-2 | **Pending payments are only reconciled by webhooks.** If a Stripe webhook is missed, `paymentRecords.status` stays `pending` indefinitely.                                                                         | `api/lib/payments/provider.ts`; `api/lib/payments/stripe.ts`; `api/queries/finance.ts:731-776` | Revenue leakage and stale ledgers.                    | Add a nightly `reconcilePayments` job that polls pending records older than 1 hour against the gateway and updates status.        |
| O-P0-3 | **FX defaults missing rates to 1 (AED).** `ratesMap()` pre-fills every supported currency with `FX_RATE_SCALE`, so a USD payment is reported as AED when no rate is set.                                           | `api/queries/fx.ts:46-53`; `api/queries/finance.ts:219-227`                                    | Multi-currency finance reports are wrong.             | Fail closed: require an explicit rate for any non-base currency encountered; surface a clear error instead of silently using 1:1. |
| O-P0-4 | **Manual payments have no idempotency guard.** `recordManualPayment` can be double-submitted, creating duplicate paid invoices.                                                                                    | `api/queries/finance.ts:529-672`                                                               | Duplicate revenue and invoices.                       | Add a 5-minute duplicate check on `userId+amount+purpose+currency` or an optional `idempotencyKey` unique constraint.             |
| O-P0-5 | **KYC rejection does not gate access.** A member whose KYC is `rejected` remains `active` and can register for events, join pods, and post deals.                                                                  | `api/queries/kyc.ts:60-104`; `api/engage-router.ts`; `api/circle-router.ts`                    | Compliance and safeguarding risk.                     | On rejection, transition member to `suspended`/`paused` and block event/pod/deal access until verified.                           |
| O-P0-6 | **Scheduler lifecycle transitions are unaudited.** `jobRenewal` calls `tryLifecycleTransition(..., audit: false)`.                                                                                                 | `api/lib/scheduler.ts:176-194`                                                                 | No traceability for automated state changes.          | Pass `SYSTEM_ACTOR` and `audit: true` for all scheduler-driven lifecycle transitions.                                             |

---

## P0/P1 — Community Journeys

| #      | Gap                                                                                                                                                                     | Evidence                                                          | Impact                                               | Recommended Fix                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| C-P0-1 | **Chapter officers cannot raise conduct cases.** Only members can `conduct.report` for their own chapter; officers need to escalate on behalf of the chapter.           | `api/conduct-router.ts:92-119`                                    | Safeguarding issues are not centrally tracked.       | Add an officer-scoped `createConductCase` mutation that sets `chapterId` and notifies the subject/reporter. |
| C-P0-2 | **Officers cannot see or act on Save Playbook cases.** `listSaveCases` is global/admin-only; chapter officers have no visibility into at-risk members in their chapter. | `api/queries/saves.ts:129-180`; `api/officer-router.ts`           | At-risk members fall through the cracks.             | Add chapter-scoped save-case list/detail/update/close endpoints for officers.                               |
| C-P0-3 | **Save cases open with no owner or SLA.** `openSaveCase` sets `ownerUserId: null` and no due date; the board cannot track accountability.                               | `api/queries/saves.ts:29-46`                                      | Cases sit open indefinitely.                         | Auto-assign the chapter VP Membership or President and set a 7-day due-date milestone.                      |
| C-P1-1 | **Members cannot request a mentor.** Only officers can `assignMentor`.                                                                                                  | `api/officer-router.ts:249-299`                                   | New members lack a self-service path to get a buddy. | Add `requestMentor` mutation; notify the relevant officer/VP Learning.                                      |
| C-P1-2 | **Self-paused members cannot self-resume.** A voluntary suspension can only be lifted by an admin/officer.                                                              | `api/circle-router.ts:718-724`; `api/lib/lifecycle.ts`            | Poor member experience and unnecessary support load. | Allow self-renewal/resume for voluntary suspensions, routing through `applyLifecycleTransition`.            |
| C-P1-3 | **Charter notifications ignore zone/region leaders.** `jobFranchiseReadiness` walks the tree only to find the country director.                                         | `api/lib/scheduler.ts:506-541`                                    | Zone/region leaders are blindsided by new charters.  | Notify all active unit-role holders in the chapter's ancestor chain (zone, region, country).                |
| C-P1-4 | **Cadences rely entirely on manual marking.** A held meeting or event in the period does not automatically mark the cadence `kept`.                                     | `api/queries/cadence.ts:127-156`; `api/officer-router.ts:360-394` | Compliance reporting is inaccurate.                  | Auto-mark a cadence as `kept` when a matching meeting/event is logged in the period.                        |
| C-P1-5 | **Regional leaders cannot review chapter budgets.** `officerRegionalRouter` has read-only finance.                                                                      | `api/officer/regional.ts:356-366`                                 | No cross-level budget approval workflow.             | Add `reviewChapterBudget` mutation for regional directors.                                                  |

---

## P0/P1 — UI/UX

| #      | Gap                                                                                                                                   | Evidence                                | Impact                                     | Recommended Fix                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| U-P0-1 | **Apply page has two competing gold CTAs.** Application and payment fight for primary action.                                         | `src/pages/portal/Apply.tsx`            | Members attempt to pay before applying.    | Make application the single primary action; defer payment until admitted. |
| U-P0-2 | **Admin application approval modal is unusable.** Six ungrouped buttons; approve is only disabled when no chapter is selected.        | `src/pages/admin/AdminApplications.tsx` | Accidental approvals/rejections.           | Sticky footer, grouped actions, inline chapter validation.                |
| U-P1-1 | **Public site uses two conflicting CSS systems.** `styles.css` dark vs `home.css` light cause white-on-white text in many components. | `public/styles.css`; `public/home.css`  | Unreadable text and inconsistent branding. | Migrate all `public/*.html` pages to one design system.                   |
| U-P1-2 | **Grid utilities collapse unreadably on mobile.** `.eh-grid.g2/g3/g4` uses `auto-fit minmax(180px, 1fr)`.                             | `public/styles.css`                     | 360px screens get 2 squashed columns.      | Add a single-column media query below 480px.                              |
| U-P1-3 | **Admin tables default to horizontal scroll.** Most tables lack `.stack` or responsive treatment.                                     | `src/pages/admin/*.tsx`                 | Mobile admin unusable.                     | Make stacking the default for admin tables.                               |
| U-P1-4 | **Login page lacks show-password and segmented controls.**                                                                            | `src/pages/portal/Login.tsx`            | Accessibility and UX friction.             | Add show-password toggle, improve focus/ARIA.                             |
| U-P1-5 | **Notification bell has mobile width issues and missing ARIA roles.**                                                                 | `src/components/NotificationBell.tsx`   | Mobile overflow, screen-reader issues.     | Clamp width, add ARIA roles.                                              |

---

## Cross-Cutting Themes

1. **Data consistency over time.** Health, payments, and FX all compute correctly at a point in time but fail to persist or reconcile, so reports drift.
2. **Chapter officers need operational tools.** Many back-office capabilities exist only at the admin/global level; franchise scaling requires pushing them down to chapter and regional officers.
3. **Mobile and accessibility are afterthoughts.** Responsive grids, colour contrast, and ARIA need to become defaults, not fixes.

---

## Recommended Implementation Order

1. **Operations P0** (O-P0-1 through O-P0-6) — these are foundations; reports and finance depend on them.
2. **Community P0** (C-P0-1 through C-P0-3) — closes the at-risk/safeguarding loop.
3. **UI P0** (U-P0-1, U-P0-2) — reduces support load and errors.
4. **Community P1 + Regional finance** (C-P1-1 through C-P1-5).
5. **UI P1** (U-P1-1 through U-P1-5).

---

## Verification Criteria

- `npm run check` passes.
- `npm run test -- --run` passes.
- `npm run build` passes.
- All changes committed and pushed.
- Railway deployment succeeds with `/api/health` returning `ok`.
