# eHive Portal — Deep Gap Analysis V4

**Date:** 13 September 2026
**Scope:** Full re-audit after V3 remediation and Vanguard founding launch. Business workflows, money paths, security, events, growth/SEO, ops/DR, residual UX.
**Base commit:** `5fd32dc` (landing scroll fix deployed, health green).
**Companion:** `DEEP_AUDIT_2026_09_02_V3.md` — this report verifies every V3 item and adds new findings.

---

## Executive Summary

V3's Wave-1 and Wave-2 items are **substantially remediated** — CRM pipeline, lead-to-cash, booking automation, onboarding checklist, retention metrics, sitemap/robots, lead SLA are all in production and verified in code this session. Security and money paths are **materially hardened**: webhook signature verification with compare-and-swap idempotency, per-endpoint rate limits, TOTP 2FA, SameSite=Strict cookies, scoped admin RBAC, atomic invoice numbering, and an 18-job scheduler covering dunning, payment reconciliation, and notification retries.

The residual risk is now concentrated in **four places**:

1. **Growth is still unmeasured** — no analytics or conversion tracking exists on any page. Every marketing decision remains a guess.
2. **Event economics** — no paid tickets/refunds, and archiving an event silently strands registrants without notice.
3. **Revenue expansion paths** — no tier upgrade checkout, no promo codes, no automated franchise royalties.
4. **Ops durability** — backups depend on an unset secret; sessions lack new-device alerts; two CSS systems keep producing readability regressions.

None require re-architecture. All are incremental builds on existing patterns.

---

## 1. Verified Closed (V3 and earlier — confirmed in code this audit)

| Area                                                                                                                                                             | Evidence                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Lead CRM: auto-assign, SLA, nextFollowUpAt, Kanban, follow-up-due                                                                                                | `api/queries/leads.ts:14-61`, `AdminLeads.tsx:54,118-165,369-619`                                                    |
| Lead→cash: `invoices.leadId` (migration 0030), create-invoice-from-lead, pipeline report                                                                         | `api/admin/finance.ts:282-380`, `AdminReports.tsx:875`                                                               |
| Booking: auto-confirm, ICS, 24h/1h reminders, signed reschedule/cancel                                                                                           | commit `71ba51c`, `api/lib/booking-token.ts`, scheduler `booking-reminders`                                          |
| Onboarding checklist on Dashboard with live progress                                                                                                             | `Dashboard.tsx:34-100`, `circle.myOnboarding`                                                                        |
| Retention: renewal/churn/LTV + cohorts by month & chapter                                                                                                        | `AdminReports.tsx:688+`, `api/queries/reports.ts:319`                                                                |
| Sitemap/robots (dynamic, host-correct)                                                                                                                           | commit `1d17b76`, `api/boot.ts`                                                                                      |
| Brand Check in-page confirmation survives email failure                                                                                                          | `/api/lead` returns `ok:true` with `emailError` flag (`api/boot.ts:487-491`); brand-check `done` state keys off `ok` |
| Waitlist FIFO promotion **with** member notification                                                                                                             | `api/queries/circle.ts:644-684`                                                                                      |
| No-show tracking with penalties + notification                                                                                                                   | `api/admin-engage-router.ts:495-587`                                                                                 |
| Founding launch: application-only Vanguard gating, funnel emails, AED 12,000 positioning                                                                         | commits `5a5fece`, `94d5e10`, `fd35b46`                                                                              |
| Scheduler breadth: 18 jobs (dormancy, renewal, dunning, payment reconciliation, notification retries, lead SLA, retention, KPI, budget carry-forward, franchise) | `api/lib/scheduler.ts:1084-1175`                                                                                     |

## 2. Security & Money-Path Verification (foolproof checks — all passed)

| Check                                                                                                                 | Result                                                        |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Webhook: raw-body signature verification                                                                              | ✅ `api/boot.ts:1072-1085`                                    |
| Webhook: compare-and-swap pending→paid (no double-activate on retries)                                                | ✅ `api/boot.ts:1138`                                         |
| Webhook: providerRef / userId / tier / amount mismatch logging                                                        | ✅ `api/boot.ts:1101-1134`                                    |
| Checkout redirect URLs from `env.publicUrl`, never request Origin                                                     | ✅ `api/circle-router.ts:175-182, 228-235`                    |
| Double-checkout guard (`CONFLICT` on existing member)                                                                 | ✅ `circle-router.ts:186-191`                                 |
| Renewal: lapsed/alumni self-renew allowed (lifecycle-consistent); suspended blocked                                   | ✅ `circle-router.ts:208-225`                                 |
| Rate limits: register 5/h/IP, login 20/15m IP + 8/15m acct, 2FA 6/15m, reset 5/h, change-password 5/h, lead 20/10m IP | ✅ `api/auth-router.ts`, `api/boot.ts:307`                    |
| Cookies: httpOnly + SameSite=Strict + secure (prod)                                                                   | ✅ `api/lib/cookies.ts:12-15`                                 |
| Password change bumps tokenVersion (other sessions die)                                                               | ✅ `api/auth-router.ts:381-385`                               |
| TOTP 2FA enrolment/verify flow                                                                                        | ✅ `api/auth-router.ts:392-435`                               |
| Admin RBAC: scopedAdmin segregation of duties + fullAdmin + audit log                                                 | ✅ `api/middleware.ts:89-137`, `adminAuditLog`                |
| Lead spam: honeypot (silent drop) + 1h dedupe + transactional scorecard persistence                                   | ✅ `api/boot.ts:325-336, 355-361`                             |
| Invoice numbering: atomic upsert counter (no race)                                                                    | ✅ `api/queries/invoicing.ts:32-46`                           |
| Uploads: magic-byte sniffing + ClamAV hook (fails open with logging when unconfigured)                                | ✅ `api/lib/receipt-scan.ts`                                  |
| Event capacity: at-capacity → waitlist; chapter event budget enforced at create/update                                | ✅ `circle-router.ts:1425-1426`, `api/admin/events.ts:69-115` |
| tRPC per-user mutation/query rate limits                                                                              | ✅ `api/middleware.ts:28-46`                                  |

## 3. Open Findings (verified this audit)

### Business / Revenue — Priority 1

| #     | Gap                                                                                                                                        | Evidence                                                             | Impact                                                                                                                                                     | Fix                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| V4-B1 | **No web analytics or conversion tracking.** No Plausible/PostHog/GA tag on any public page; no conversion events on lead/booking success. | `public/*.html` (no tag); only server-side `recordAnalyticsEvent`    | Zero visibility into traffic/CTR/conversion; can't attribute ads or A/B test. Same as V3 M-P0-1/M-P0-3 — still open.                                       | Add privacy-friendly tag (Plausible/PostHog) via one snippet in `app.js`; fire conversion events on scorecard/booking/apply success. |
| V4-B2 | **No tier upgrade path.** Members can't move Horizon→Ascent→Vanguard; only join or renew.                                                  | no `startUpgrade` anywhere; `startCheckout` rejects existing members | Direct revenue loss from engaged members; founding Vanguard cohort can't be grown from within. V3 B-P1-4 still open.                                       | `startUpgrade` checkout charging prorated tier delta; Dashboard CTA when engagement score crosses threshold.                         |
| V4-B3 | **No promo codes.**                                                                                                                        | no `promoCode`/`coupon` in schema or API                             | Blocks launch campaigns, partner/chapter-founder pricing. V3 B-P2-1 still open. (Admin → Offers partially covers bespoke pricing, but nothing self-serve.) | `promoCodes` table (%/fixed, scope, expiry, usage cap) applied at checkout.                                                          |
| V4-B4 | **Franchise royalty automation missing.**                                                                                                  | no `royalty` in codebase                                             | Chapter P&L is manual; franchisor invoicing is spreadsheet work. V3 B-P1-5 still open.                                                                     | Royalty rule (% of chapter revenue) → auto-generate monthly royalty invoices.                                                        |

### Events — Priority 2

| #     | Gap                                                                                                                                | Evidence                                            | Impact                                                                        | Fix                                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| V4-E1 | **No paid events.** `events.costAed` is the chapter's internal cost, not a ticket price. No attendee payment, no refund on cancel. | `db/schema.ts:437-488` — no price field on `events` | Summit/workshop revenue impossible; paid-event scenario from V3 remains open. | `events.ticketPriceMinor` + Stripe checkout for registration + refund policy on cancel.                               |
| V4-E2 | **Archiving an event silently strands registrants.** `archiveEvent` soft-deletes; no notification to registered members.           | `api/admin/events.ts:130-153` — no notify loop      | Members show up to cancelled events; trust damage.                            | On archive of a future event: notify all `registered` regs ("cancelled — apologies"), promote refund if paid (V4-E1). |
| V4-E3 | **Recurring event templates absent.**                                                                                              | no `eventTemplates`; V3 item still open             | Monthly chapter meetups recreated by hand.                                    | "Duplicate / make recurring" on AdminEvents.                                                                          |

### Growth / Marketing — Priority 2

| #     | Gap                                                                                                          | Evidence                                                                              | Impact                                                                                                         | Fix                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| V4-M1 | **No social-proof engine.** Testimonials are hard-coded copy.                                                | no `testimonials` table                                                               | Static claims convert worse than real, rotating proof. V3 M-P1-2 still open.                                   | `testimonials` admin table + rotation on homepage.                      |
| V4-M2 | **One shared OG image for all pages.**                                                                       | 1 `og:image` per page, identical                                                      | Weak link previews. V3 M-P2-1 still open.                                                                      | Per-page OG images for service/scorecard/vanguard pages.                |
| V4-M3 | **WhatsApp CTA disabled.**                                                                                   | `public/app.js:14` `WA_NUMBER = null`                                                 | Highest-converting Gulf channel unused. V3 M-P1-3 still open — needs a provisioned number (business decision). | Set number; floating WA button on consulting/contact pages.             |
| V4-M4 | **Nurture drip is thin beyond scorecard.** Brand-check and booking-no-show tracks lack scheduled follow-ups. | scheduler has `scorecard-follow-up`, `lead-sla`; no brand-check or no-show rebook job | Leads touched once, then forgotten. V3 M-P1-1 partially open.                                                  | Add nurture jobs: brand-check review (3d), booking no-show rebook (1d). |

### Platform / Ops / UX — Priority 3

| #     | Gap                                                                                                                                    | Evidence                                                                                                    | Impact                                                                     | Fix                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| V4-A1 | **Backups not durable.** `backup.yml` supports `DATABASE_BACKUP_URL` but the secret is unset → artifact-only, 90-day GitHub retention. | `.github/workflows/backup.yml:24-27`                                                                        | A repo/Platform incident loses the DB.                                     | Set `DATABASE_BACKUP_URL` (Railway MySQL URL) + upload to S3/R2.            |
| V4-A2 | **No new-device/login alert; no "log out all devices" UI.**                                                                            | `revokeAllUserSessions` exists server-side (`api/queries/sessions.ts:54`) but no caller, no new-login email | Compromised-password discovery is delayed. V3 A-P0-12 partially open.      | New-login email; Security settings page with revoke-all.                    |
| V4-A3 | **Two CSS systems persist** (`styles.css` dark + `home.css` light).                                                                    | V3 U-P1-4 still open; user reported white-on-white regressions after every visual change                    | Recurring readability bugs; slower page work.                              | Token-based single system; retire `styles.css`.                             |
| V4-A4 | **Long forms lose state on refresh** (Brand Check multi-step).                                                                         | no sessionStorage in `brand-check.html`                                                                     | Abandoned half-finished forms. V3 U-P2-1 still open.                       | Persist answers to sessionStorage, restore on load.                         |
| V4-A5 | **Rate limiter and scheduler are in-process/DB-backed** (no Redis).                                                                    | V3 architecture P0s unchanged                                                                               | Fine at current scale; becomes the ceiling at the next order of magnitude. | Redis when traffic justifies — unlocks queue, sliding-window limits, cache. |

---

## Cross-Cutting Assessment

- **Capture → Convert → Close is now wired.** The remaining funnel leaks are measurement (V4-B1) and follow-up breadth (V4-M4), not mechanics.
- **The money paths are the most trustworthy code in the repo.** Webhook idempotency, CAS activation, and mismatch logging are production-grade. The next money features (paid events, upgrades, promo codes) should reuse these exact patterns.
- **The highest-leverage single change is analytics** — one snippet, immediate compounding value for every future decision.
- **Every recurring UX bug trace root-caused this session** (white-on-white, scroll position) originates from the dual-CSS system (V4-A3). Unifying it pays for itself in prevented regressions.

## Recommended Order

1. **Wave 1 (this week):** V4-B1 analytics + conversion events · V4-A1 backup secret · V4-E2 cancel-notify.
2. **Wave 2 (launch-adjacent):** V4-B2 upgrade checkout · V4-B3 promo codes · V4-E1 paid events (reuses webhook CAS) · V4-A4 form persistence.
3. **Wave 3 (growth):** V4-M1 testimonials · V4-M2 OG images · V4-M4 nurture jobs · V4-M3 WhatsApp (needs number) · V4-E3 recurring events.
4. **Structural (scheduled):** V4-B4 royalties · V4-A2 session UI · V4-A3 CSS unification · V4-A5 Redis when scale demands.
