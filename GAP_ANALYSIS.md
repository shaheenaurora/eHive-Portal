# eHive Portal — Consolidated Gap Analysis

**Date:** 2026-08-24  
**Repository:** `https://github.com/shaheenaurora/eHive-Portal`  
**Scope:** Business functional workflows, UI/UX user journeys, data/reporting, security, compliance, and franchise-readiness across the full value chain.

**Inputs:**
- `AUDIT_REPORT.md` — original full-stack audit
- `AUDIT_REPORT_REAUDIT.md` — re-audit after remediation
- `UX_AUDIT.md` — public website UX/product design audit
- Four parallel deep-dive workstreams covering business processes, UI/UX, data/schema, and security/production readiness.

---

## 0. Executive Summary

The eHive Portal has progressed from a promising prototype to a structurally sound application. The original Critical/High security and deployment issues have largely been resolved; builds pass, migrations run, and emails are flowing again. However, **the system is still a membership portal with ERP aspirations**, not an ERP-grade platform.

The most material gaps fall into four clusters:

1. **Business process incompleteness** — finance lacks expense approval, refund policy, invoicing and reporting; awards lack judging; governance lacks quorum/notifications; lifecycle transitions bypass the central executor in several paths.
2. **Franchise/multi-entity readiness** — the chapter/region/country hierarchy exists in tables but lacks RBAC, financial autonomy, white-label capability, and operational workflows needed to run a franchise network.
3. **Public-site UX and conversion** — the homepage uses a different design system from the rest of the site, sections dead-end without CTAs, contrast fails WCAG AA, and there is little motion or interactivity.
4. **Production hardening** — Docker runs as root, scheduler does not scale horizontally, authenticated tRPC lacks rate limiting, and observability is minimal.

This document maps those gaps across the value chain and proposes a prioritised roadmap.

---

## 1. Business & Functional Workflow Gaps

### 1.1 Lead Acquisition → Application → Admission

| # | Gap | Why it matters | Evidence / Location | Recommended Fix |
|---|-----|----------------|---------------------|-----------------|
| 1.1.1 | **Lead capture is buried and weakly validated** | Homepage email capture only appears in the footer; email regex accepts `a@b.c`; no lead scoring or nurture sequence. | `UX_AUDIT.md` §3.5; `public/app.js` | Move a high-value lead magnet above the fold; tighten validation; add a simple CRM pipeline and automated nurture emails. |
| 1.1.2 | **Email verification not enforced for application or payment** | Unverified/typo emails can apply, pay, and receive membership. | `AUDIT_REPORT.md` §1 #13, §2 #1; `AUDIT_REPORT_REAUDIT.md` §4 #7 | Gate `submitApplication`, `startCheckout`, and sensitive member actions on `emailVerifiedAt`. |
| 1.1.3 | **Application approval duplicates membership creation** | Approval logic lives in both `setApplicationStatus` and `activateMembership`; divergence risk. | `AUDIT_REPORT.md` §2 #2 | Centralise admission in `activateMembership`; have the admin endpoint call it. |
| 1.1.4 | **Application rejection does not notify the applicant** | Candidates are left in limbo; poor experience and lost re-engagement. | `AUDIT_REPORT_REAUDIT.md` §3 | Send rejection email with reason and a re-apply path. |
| 1.1.5 | **No admission analytics or funnel metrics** | Cannot measure drop-off between lead, application, payment, and activation. | reporting gaps | Add a conversion funnel dashboard (see §4). |

### 1.2 Onboarding → Active Membership

| # | Gap | Why it matters | Evidence / Location | Recommended Fix |
|---|-----|----------------|---------------------|-----------------|
| 1.2.1 | **Paid joins skip onboarding** | `activateMembership` sets `lifecycleState: "active"` instead of `"onboarding"`. Stripe-paid members never enter onboarding. | `AUDIT_REPORT_REAUDIT.md` §3 #1 | Set `lifecycleState: "onboarding"` for all new members and trigger onboarding notification/audit. |
| 1.2.2 | **Zenith admissions skip onboarding** | `decideZenith` creates members with default `lifecycleState: "active"`. | `AUDIT_REPORT_REAUDIT.md` §3 #6 | Force onboarding state for Zenith admits too. |
| 1.2.3 | **Onboarding steps are not enforced** | Members can remain active indefinitely without completing required steps (KYC, policy ack, profile). | `AdminMemberDetail.tsx`; onboarding queries | Add a `onboardingRequired` gate that blocks event registration, pod creation, or deal posting until completion. |
| 1.2.4 | **No onboarding completion tracking / reminders** | `jobOnboardingSlip` exists but there is no visible progress bar or drip sequence for the member. | scheduler; member profile | Build an onboarding checklist UI and a 7/14/21-day reminder cadence. |

### 1.3 Membership Lifecycle (Renewal, Pause, Cancel, Lapse, Alumni)

| # | Gap | Why it matters | Evidence / Location | Recommended Fix |
|---|-----|----------------|---------------------|-----------------|
| 1.3.1 | **Manual renewal bypasses lifecycle executor** | `recordManualPayment` with `extendRenewal` writes status directly, skipping save-case side effects and notifications. | `AUDIT_REPORT_REAUDIT.md` §3 #2 | Route through `renewMembership` / `applyLifecycleTransition`. |
| 1.3.2 | **Self-renewal blocks lapsed/alumni win-back** | `startRenewal` rejects `cancelled`/`alumni`/`suspended`; lapsed members map to `cancelled` and cannot self-renew. | `AUDIT_REPORT_REAUDIT.md` §3 #5 | Allow self-renewal for `lapsed` and `alumni`; keep `suspended` blocked. |
| 1.3.3 | **Member pause/cancel mutates status directly** | `requestMembershipChange` sets `status` without transitioning `lifecycleState`, causing inconsistent pairs. | `AUDIT_REPORT_REAUDIT.md` §3 #4 | Use `applyLifecycleTransition` to `at_risk`/`lapsed`/`alumni`. |
| 1.3.4 | **Admin `setMemberStatus` bypasses lifecycle coherence** | Allows `cancelled` + `active` drift. | `AUDIT_REPORT_REAUDIT.md` §3 #8 | Derive `lifecycleState` from status or disallow direct mutation. |
| 1.3.5 | **Refund does not revert membership/renewal** | Refunding a payment leaves the member active. | `AUDIT_REPORT.md` §2 #14 | Define refund policy: cancel/expire membership or record credit. |
| 1.3.6 | **Dormancy evaluation is N+1 per member** | Does not scale; poor data for re-engagement. | `AUDIT_REPORT.md` §2 #8 | Pre-compute engagement counts in a single batch query. |
| 1.3.7 | **No win-back campaign for lapsed/alumni** | Lifecycle ends at `lapsed`; no automated reactivation offers. | lifecycle model | Add a win-back email sequence and a "reapply" discount code path. |

### 1.4 Chapters, Regions & Franchise Hierarchy

| # | Gap | Why it matters | Evidence / Location | Recommended Fix |
|---|-----|----------------|---------------------|-----------------|
| 1.4.1 | **Chapter transfer approval is silent** | Only updates `homeChapterId`; no notification, target validation, audit, or lifecycle event. | `AUDIT_REPORT_REAUDIT.md` §3 #7 | Notify member, validate target chapter, audit transfer, optionally require target chapter approval. |
| 1.4.2 | **Election close does not fill the seat** | Votes are tallied but the winner is not assigned to `chapter_roles`. | `AUDIT_REPORT_REAUDIT.md` §3 #9 | Auto-assign winning candidate and notify; enforce term limits. |
| 1.4.3 | **Term limits are defined but not enforced** | `CHAPTER_TERM_LIMIT_CONSECUTIVE` exists in constants only. | `AUDIT_REPORT_REAUDIT.md` §3 | Block nominations/run for members who would exceed consecutive terms. |
| 1.4.4 | **No chapter-level financial autonomy** | Chapter budgets are approved in Chapters UI, but finance spending is recorded separately without tying back. | `AUDIT_REPORT_REAUDIT.md` §1 #1, #2 | Unify spend recording behind chapter-budget approval; Finance records payment, Chapters owns approval. |
| 1.4.5 | **No regional/city chapter rollup** | Chapters exist as a flat list; no region/country dashboard or aggregate health. | schema; `AdminChapters.tsx` | Add region/country filters, aggregate KPI cards, and regional officer roles. |
| 1.4.6 | **No chapter-level RBAC / delegated admin** | All admin work requires global admin or chapter officer scopes that are coarse. | `AdminAccess.tsx`; middleware | Allow chapter presidents to manage their own members, events, and budgets within policy guardrails. |
| 1.4.7 | **No white-label / microsite per chapter** | Each chapter cannot brand its own landing or event page. | public site architecture | Optional per-chapter microsite with shared components. |

### 1.5 Governance, Elections & Motions

| # | Gap | Why it matters | Evidence / Location | Recommended Fix |
|---|-----|----------------|---------------------|-----------------|
| 1.5.1 | **Motion voting lacks quorum/eligibility checks** | Beyond home chapter, no validation that enough eligible voters participated. | `AUDIT_REPORT_REAUDIT.md` §3 | Add quorum rules and eligibility verification before closing a motion. |
| 1.5.2 | **Motion close does not notify the chapter** | Members are unaware of outcomes. | `AUDIT_REPORT_REAUDIT.md` §3 | Send email/in-app notification on close with result summary. |
| 1.5.3 | **Conduct appeal reversal does not unwind action** | `reversed` resets case to `reviewing` but does not reinstate the member. | `AUDIT_REPORT_REAUDIT.md` §3 #10 | On reversal, transition member back to `active` and notify. |
| 1.5.4 | **Election nominations lack eligibility validation** | Any member can be nominated regardless of tenure, tier, or term limits. | elections router | Enforce eligibility rules server-side. |

### 1.6 Awards & Recognition

| # | Gap | Why it matters | Evidence / Location | Recommended Fix |
|---|-----|----------------|---------------------|-----------------|
| 1.6.1 | **No judging workflow** | Winners are picked by admin toggle; no rubric, judge assignment, deliberation, or tie-breaking. | `AUDIT_REPORT_REAUDIT.md` §2 #1 | Implement `award_judges`, `award_scores`, and a deliberation phase. |
| 1.6.2 | **Award categories are undefined / too small** | Users ask “what are the categories of awards?”; fixed list missing common categories like Deal of the Year, Innovation. | `AdminAwards.tsx`; constants | Define and document categories; allow admin-configurable categories per cycle. |
| 1.6.3 | **Nomination dates are not enforced** | `opensAt`/`closesAt` are collected but never checked. | `AUDIT_REPORT_REAUDIT.md` §2 #2 | Reject nominations outside the window; block opening a cycle before `opensAt`. |
| 1.6.4 | **Backend does not validate category subject vs. nominee type** | A member can be nominated for “Chapter of the Year” via API. | `AUDIT_REPORT_REAUDIT.md` §2 #3 | Enforce `AWARD_CATEGORIES[*].subject` server-side. |
| 1.6.5 | **No scoped nomination validation** | Cycle has `unitId`, but `nominate` does not verify nominee belongs to that unit. | `AUDIT_REPORT_REAUDIT.md` §2 #4 | Validate nominee membership/chapter against cycle `level` + `unitId`. |
| 1.6.6 | **No duplicate-nominee guard within a category** | Same nominee can receive multiple nominations. | `AUDIT_REPORT_REAUDIT.md` §2 #5 | Add unique guard on `(cycleId, category, nomineeMemberId / nomineeChapterId)`. |
| 1.6.7 | **No notifications for shortlisted/winner nominees** | Status changes update rows silently. | `AUDIT_REPORT_REAUDIT.md` §2 #6 | Send in-app/email notifications on shortlist and winner announcements. |
| 1.6.8 | **Winners do not update profiles/badges or Hive Score** | Recognition program is disconnected from member identity and engagement scoring. | awards queries | Auto-apply badge and award Hive Score points. |
| 1.6.9 | **No public winners page** | Marketing opportunity lost; no social proof. | public site | Add `/awards/winners` page. |

### 1.7 FRP, Pods & Engagement

| # | Gap | Why it matters | Evidence / Location | Recommended Fix |
|---|-----|----------------|---------------------|-----------------|
| 1.7.1 | **`frpEnrol` does not verify cohort status** | Members can enrol in closed/full cohorts. | `AUDIT_REPORT.md` §2 | Check `cohort.status === "open"` and capacity. |
| 1.7.2 | **`submitMilestone` allows resubmission of reviewed milestones** | Could overwrite approved work. | `AUDIT_REPORT.md` §2 | Block resubmission after approval; allow new version only if rejected. |
| 1.7.3 | **No clear FRP graduation criteria** | Milestones exist but graduation is manual/opaque. | FRP UI | Define and enforce graduation rules; issue certificate/badge automatically. |
| 1.7.4 | **Event check-in window semantics are unclear** | `EVENT_CHECKIN_OPENS_BEFORE_MS = 2h` allows check-in before event starts; contradicts “at the door” language. | `AUDIT_REPORT.md` §2 #5 | Rename constant or change semantics; document intended behaviour. |
| 1.7.5 | **`promoteWaitlist` does not re-validate tier eligibility** | Promoted member may no longer meet constraints. | `AUDIT_REPORT.md` §2 #6 | Re-run `memberCanAccessEvent` before promoting. |
| 1.7.6 | **Referral conversion is not implemented** | `referral_converted` rule exists but no flow marks referrals converted. | `AUDIT_REPORT.md` §2 #12 | Add admin action or webhook to mark referrals converted and award points. |
| 1.7.7 | **No atomic guard around score recomputation** | Concurrent `awardPoints` calls can interleave ledger inserts and score updates. | `AUDIT_REPORT.md` §2 #11 | Use row-level lock on `members` or serialise per `memberId`. |

### 1.8 Finance (ERP-grade gaps)

| # | Gap | Why it matters | Evidence / Location | Recommended Fix |
|---|-----|----------------|---------------------|-----------------|
| 1.8.1 | **Expenses bypass chapter spend-approval policy** | `recordExpense` hard-codes `status: "approved"`; no threshold check. | `AUDIT_REPORT_REAUDIT.md` §1 #1 | Route expenses above `SPEND_APPROVAL_THRESHOLD_AED` through `proposed → approved` workflow. |
| 1.8.2 | **Finance expenses and chapter budgets are disconnected** | Two UIs, no shared model. | `AUDIT_REPORT_REAUDIT.md` §1 #2 | Unify model: Chapters approves, Finance records payment. |
| 1.8.3 | **No refund policy enforcement** | `refundPayment` only checks amount ≤ captured; no time window or non-refundable rules. | `AUDIT_REPORT_REAUDIT.md` §1 #3 | Add refund policy config: max window, max refundable %, block if membership consumed. |
| 1.8.4 | **No financial reports or exports** | Missing P&L, cash-flow, revenue-by-period, refunds, expense-by-category, ledger CSV. | `AUDIT_REPORT_REAUDIT.md` §1 #4 | Build Finance → Reports → Export with date-range filters and CSV/PDF. |
| 1.8.5 | **No invoices or credit notes** | Manual payments create a row but no document; refunds update row but no credit note. | `AUDIT_REPORT_REAUDIT.md` §1 #5 | Generate invoice/credit-note records and expose download endpoint. |
| 1.8.6 | **Payments status filter omits `partially_refunded`** | Admin filter incomplete. | `AUDIT_REPORT_REAUDIT.md` §1 #6 | Add `"partially_refunded"` to filter enum. |
| 1.8.7 | **No receipt/attachment support for expenses** | `recordExpense` has no file/URL field. | `AUDIT_REPORT_REAUDIT.md` §1 | Add attachment upload and preview. |
| 1.8.8 | **Revenue recognition is coarse** | Only `paidAt`; no fiscal-period or deferred-revenue handling. | finance schema | Add revenue recognition by period/membership month. |
| 1.8.9 | **No dunning or payment reminders** | Pending payments are not chased automatically. | finance queries | Add dunning sequence before cancellation. |
| 1.8.10 | **Single-currency hard-coding (AED)** | Blocks expansion beyond UAE. | constants; Stripe | Introduce currency config; store amounts with currency. |
| 1.8.11 | **No bank reconciliation or batch import** | Manual finance work; error-prone. | finance UI | Add bank statement import and reconciliation. |

### 1.9 Franchise / Multi-Entity Readiness

| # | Gap | Why it matters | Evidence / Location | Recommended Fix |
|---|-----|----------------|---------------------|-----------------|
| 1.9.1 | **No multi-tenant org structure** | `org_units` table exists but the app is built for a single global tenant. | schema; routers | Introduce tenant-scoped queries and a top-level `tenantId` where needed. |
| 1.9.2 | **No regional/city chapter operating model** | Hierarchy exists in schema but not in workflows (budget roll-up, reporting, officer escalation). | `AdminChapters.tsx` | Build region/country dashboards and workflows. |
| 1.9.3 | **No chapter-level access control delegation** | Franchisees need self-service within brand guardrails. | `AdminAccess.tsx` | Implement chapter-level RBAC with policy templates. |
| 1.9.4 | **No chapter-level P&L or budget carry-forward** | Cannot operate chapters as P&L units. | finance schema | Add chapter P&L view, budget allocation, and year-end carry-forward. |
| 1.9.5 | **No franchisee onboarding / compliance checklist** | New chapter setup is ad-hoc. | admin UI | Build a chapter launch checklist and approval workflow. |
| 1.9.6 | **No centralised policy distribution and ack tracking** | Policies can be acked but there is no franchise-wide compliance view. | governance UI | Add policy assignment by chapter/region and compliance dashboard. |

---

## 2. UI/UX & User-Journey Gaps

### 2.1 Public Website

| # | Gap | Why it matters | Evidence / Location | Recommended Fix |
|---|-----|----------------|---------------------|-----------------|
| 2.1.1 | **Two competing design systems** | Homepage is light paper + inline CSS; rest of site is dark navy/gold shared system. Undermines trust. | `UX_AUDIT.md` §1.1 | Rebuild `index.html` on shared `styles.css`/`apps.css`/`app.js`; componentise nav/footer. |
| 2.1.2 | **Color accessibility failures (Critical)** | Gold `#DA3A22` fails WCAG AA on navy; low-opacity ivory text unreadable. | `UX_AUDIT.md` §1.2 | Use `#E4573F` for accent text; never drop ivory below ~78 % opacity. |
| 2.1.3 | **Typography tokens are misleading** | `--font-mono` is Archivo; `--serif` points to display font; stale comments. | `UX_AUDIT.md` §1.3 | Rename tokens; remove stale comments; decide on serif brand expression. |
| 2.1.4 | **CSS architecture unmaintainable** | `styles.css` 7,500+ lines with duplicated component blocks. | `UX_AUDIT.md` §1.4 | Refactor into `tokens.css`, `components.css`, `pages/*.css`. |
| 2.1.5 | **Hero value proposition is abstract** | H1 does not say what eHive is, where it operates, or what the visitor gets. | `UX_AUDIT.md` §2.1 | Rewrite to outcome + geography; add “Book a free consultation” CTA. |
| 2.1.6 | **Stats are structural, not outcome-based** | “1 ecosystem, 6 products, 4 tiers” does not reduce risk. | `UX_AUDIT.md` §2.2 | Swap for proof points: founders served, businesses formed, NPS. |
| 2.1.7 | **No customer social proof** | Only a founder quote; `.proof` block unused. | `UX_AUDIT.md` §2.3 | Add testimonial section and trust bar. |
| 2.1.8 | **Several sections dead-end without CTA** | Manifesto, What eHive is, How it works, Voices lack next step. | `UX_AUDIT.md` §2.4 | End every section with a contextual CTA. |
| 2.1.9 | **No risk reversal near CTAs** | No “no obligation”, “free consultation”, privacy, or money-back language. | `UX_AUDIT.md` §2.5 | Add microcopy under primary CTAs. |
| 2.1.10 | **Modals lack focus traps** | Scorecard, Brand-Check, Pathfinder, Command-Palette do not trap focus. | `UX_AUDIT.md` §3.2 | Add focus-loop, initial focus, return focus. |
| 2.1.11 | **Misleading success states on backend failure** | Forms show “You’re all set” even when `submitLead` errors. | `UX_AUDIT.md` §3.3 | Render distinct failure panel with retry CTA. |
| 2.1.12 | **No loading/disabled state during submission** | Buttons remain active; double-submit risk. | `UX_AUDIT.md` §3.4 | Disable button and swap label to “Sending…”. |
| 2.1.13 | **Inner pages still use large static hero images** | Consulting, business-setup, etc. have oversized banners with no animation. | user feedback; `public/*.html` | Reduce hero height, add scroll-driven motion, parallax, or reveal animations. |
| 2.1.14 | **White text on white backgrounds still present** | Some pages/cards render unreadable text. | user feedback | Audit all pages for contrast; fix CSS variables or overrides. |
| 2.1.15 | **Hard-coded dates in countdown/copy** | “Opens 1 August 2026” needs manual updates. | user feedback | Centralise dates in config or CMS-driven fields. |
| 2.1.16 | **Lack of interactivity/motion vs. benchmark sites** | Site feels static compared to e.g. `bcgbrighthouse.com`. | user feedback | Add scroll reveals, micro-interactions, hover states, and staged content entrances. |

### 2.2 Portal (Member + Admin)

| # | Gap | Why it matters | Evidence / Location | Recommended Fix |
|---|-----|----------------|---------------------|-----------------|
| 2.2.1 | **Destructive actions use native `confirm()` or no confirmation** | Inaccessible and risky. | `AUDIT_REPORT_REAUDIT.md` §5 #1, #2 | Replace with `confirmDialog({ danger: true })` across all admin pages. |
| 2.2.2 | **Many admin pages ignore query errors** | Network failures silently fall through to blank/empty states. | `AUDIT_REPORT_REAUDIT.md` §5 #4 | Add `q.isError && <LoadError onRetry={...} />` branches. |
| 2.2.3 | **Clickable table rows are not keyboard accessible** | `<tr onClick>` is not focusable. | `AUDIT_REPORT_REAUDIT.md` §5 #5 | Convert to row buttons/links or add `tabIndex`, `role`, `aria-label`, `onKeyDown`. |
| 2.2.4 | **Form controls lack accessible labels** | KYC note, TOTP inputs rely on placeholders. | `AUDIT_REPORT_REAUDIT.md` §5 #6 | Add `<label>` or `aria-label`. |
| 2.2.5 | **Field-level validation feedback is weak** | Errors appear only as toasts. | `AUDIT_REPORT.md` §3 #3 | Adopt `react-hook-form` + zod with `aria-invalid`/`aria-describedby`. |
| 2.2.6 | **Data tables lack `<caption>` and `scope="col"`** | Screen-reader users lose context. | `AUDIT_REPORT_REAUDIT.md` §5 | Add semantic table markup. |
| 2.2.7 | **Mobile sidebar drawer lacks close button and focus trap** | Poor mobile UX. | `AUDIT_REPORT.md` §3 | Add explicit close button, focus trap, `aria-controls`. |
| 2.2.8 | **Single top-level `Suspense` + `ErrorBoundary`** | One failed chunk can take down the SPA. | `AUDIT_REPORT.md` §3 | Add route-level boundaries. |
| 2.2.9 | **Mixed form primitives** | Some pages use bespoke `eh-*` classes instead of shared UI components. | `AUDIT_REPORT.md` §3 | Standardise on `src/components/ui/` primitives. |
| 2.2.10 | **Status indicators rely on colour alone** | Accessibility failure. | `AUDIT_REPORT.md` §3 | Add icons/text alongside colour. |

### 2.3 Conversion & User Journey

| # | Gap | Why it matters | Recommended Fix |
|---|-----|----------------|-----------------|
| 2.3.1 | **No clear path from visitor → member** | Homepage does not guide users through “find your door” to application. | Restructure landing around a single conversion funnel with progressive disclosure. |
| 2.3.2 | **Scorecard/booking results not visibly tied to follow-up** | Users take the scorecard but there is no clear next step email/CRM action. | Send personalised result email + suggested next step (consulting, Circle apply, newsletter). |
| 2.3.3 | **No onboarding wizard for new members** | Members land in dashboard without guidance. | Add a 3-step welcome wizard: complete profile, book intro event, join a pod. |
| 2.3.4 | **No progress indicators for long workflows** | Applications, FRP, governance forms feel like endless forms. | Add stepper UI and save-as-draft. |
| 2.3.5 | **No personalisation based on tier/chapter** | All members see the same dashboard regardless of context. | Tier/chapter-aware dashboard cards and quick actions. |

---

## 3. Data, Reporting & Analytics Gaps

| # | Gap | Why it matters | Evidence / Location | Recommended Fix |
|---|-----|----------------|---------------------|-----------------|
| 3.1 | **No centralised analytics event stream** | Cannot measure funnel, engagement, or feature adoption. | whole app | Add an `analytics_events` table or integrate Segment/Amplitude/PostHog with PII care. |
| 3.2 | **No conversion funnel reports** | Cannot optimise marketing spend. | reporting | Build reports: visitor → lead → application → payment → active. |
| 3.3 | **No chapter health dashboard** | `computeChapterHealth` exists but is not exposed as a trend dashboard. | `AdminChapters.tsx` | Add health scorecards with trend lines and drill-down. |
| 3.4 | **No financial reports** | As listed in §1.8.4. | `AdminFinance.tsx` | Build P&L, cash-flow, revenue recognition, refunds, expenses. |
| 3.5 | **No audit reporting UI** | Audit trail exists in DB but no way to search/review. | `audit` table | Add admin audit log viewer with filters and export. |
| 3.6 | **No member engagement scoring drill-down** | Hive Score is a number; no visibility into how it is earned/lost. | `Score.tsx` | Add ledger-style activity view and score breakdown. |
| 3.7 | **No data export / portability** | PDPL/data-request scaffolding exists but no self-service export. | `dataRequests` table | Add member self-service data export and admin fulfilment workflow. |
| 3.8 | **No scheduled report subscriptions** | Reports must be generated manually. | reporting | Allow admins to subscribe to weekly/monthly email reports. |
| 3.9 | **Dashboard runs many small existence checks** | Inefficient and slow at scale. | `dashboard` query | Consolidate into a single aggregated query or materialised view. |
| 3.10 | **Dynamic `Record<string, unknown>` patches bypass Drizzle typing** | Silent acceptance of invalid columns. | `AUDIT_REPORT.md` §4 #7 | Use explicit typed objects or typed helper builders. |

---

## 4. Security, Compliance & Operations Gaps

| # | Gap | Why it matters | Evidence / Location | Recommended Fix |
|---|-----|----------------|---------------------|-----------------|
| 4.1 | **Payment success/cancel URLs use request `Origin`** | Attacker can redirect to phishing domain. | `AUDIT_REPORT_REAUDIT.md` §4 #1 | Build URLs from configured `env.publicUrl`. |
| 4.2 | **Synchronous `scryptSync` blocks event loop** | Login stalls Node 50–200 ms; DoS vector. | `AUDIT_REPORT_REAUDIT.md` §4 #2 | Switch to async `scrypt` or `argon2id`. |
| 4.3 | **No rate limiting on authenticated tRPC mutations** | Expensive operations unbounded. | `AUDIT_REPORT_REAUDIT.md` §4 #3 | Add per-IP/per-user rate-limit middleware on `/api/trpc/*`. |
| 4.4 | **`/api/lead` trusts leftmost `X-Forwarded-For`** | Clients can spoof IPs to bypass limits. | `AUDIT_REPORT_REAUDIT.md` §4 #4 | Use rightmost untrusted proxy IP. |
| 4.5 | **Public insight JSON endpoints return raw HTML** | XSS risk if any client renders raw. | `AUDIT_REPORT_REAUDIT.md` §4 #5 | Sanitise or strip HTML in JSON payloads. |
| 4.6 | **CSP allows `'unsafe-inline'`** | Marketing inline scripts/styles can execute. | `AUDIT_REPORT_REAUDIT.md` §4 #6 | Move to nonces/hashes; remove `'unsafe-inline'`. |
| 4.7 | **Email verification not enforced at login** | Unverified accounts can use non-payment features. | `AUDIT_REPORT_REAUDIT.md` §4 #7 | Reject login or restrict until verified. |
| 4.8 | **Tier-change requests lack business-rule validation** | Arbitrary tier changes possible. | `AUDIT_REPORT_REAUDIT.md` §4 #8 | Validate allowed transitions, minimum tenure, downgrade rules. |
| 4.9 | **Docker container runs as root** | Compromise grants host root. | `AUDIT_REPORT_REAUDIT.md` §6 #1 | Add non-root `USER app`. |
| 4.10 | **No graceful shutdown / SIGTERM handling** | In-flight requests dropped on restart. | `AUDIT_REPORT_REAUDIT.md` §6 #2 | Add SIGTERM handler to stop scheduler, close pool, drain server. |
| 4.11 | **In-process scheduler does not scale horizontally** | Jobs duplicate/skip with >1 replica. | `AUDIT_REPORT_REAUDIT.md` §6 #3 | Move to single-replica worker or use advisory locks/Redis. |
| 4.12 | **Rate limiter is in-process only** | Multi-instance deployments bypass limits. | `AUDIT_REPORT_REAUDIT.md` §6 #4 | Back with Redis. |
| 4.13 | **`.dockerignore` may leak secrets** | `.env`, `.env.*.local`, `*.pem`, `*.key` not excluded. | `AUDIT_REPORT_REAUDIT.md` §6 #5 | Add `.env*`, `*.pem`, `*.key`, credential directories. |
| 4.14 | **20 known dependency vulnerabilities** | Hono CORS ReDoS, Vite/Rollup path traversal, React Router CSRF, PostCSS XSS, etc. | `AUDIT_REPORT_REAUDIT.md` §6 #6 | Run `npm audit fix`; upgrade breaking deps; add `npm audit` to CI. |
| 4.15 | **No production observability / metrics endpoint** | Only `/api/health` exists. | `AUDIT_REPORT_REAUDIT.md` §6 #7 | Add `/metrics` (Prometheus) and structured JSON logs. |
| 4.16 | **DB pool lacks timeout/retry configuration** | `connectionLimit: 20` with no timeouts. | `AUDIT_REPORT_REAUDIT.md` §6 #8 | Add `acquireTimeout`, `idleTimeout`, env-driven limits. |
| 4.17 | **Very low test coverage** | 11 test files vs. ~195 source files. | `AUDIT_REPORT_REAUDIT.md` §6 #9 | Add integration tests for auth, payments webhook, tRPC routers. |
| 4.18 | **Backup workflow stores dumps only as GitHub artifacts** | 90-day retention only. | `AUDIT_REPORT_REAUDIT.md` §6 #10 | Upload dumps to S3/R2 with versioning. |
| 4.19 | **Docker build copies everything after `npm ci`** | Poor cache invalidation. | `AUDIT_REPORT_REAUDIT.md` §6 #11 | Tighten `.dockerignore`; copy only build inputs. |
| 4.20 | **Production bundles are large** | `dist/boot.js` ~4.1 MB, `dist/pre-deploy.js` ~1.5 MB. | `AUDIT_REPORT_REAUDIT.md` §6 #12 | Verify minification, tree-shake AWS SDK, lazy-load heavy routers. |
| 4.21 | **CI does not build Docker image or run security scans** | Dockerfile drift not caught. | `AUDIT_REPORT_REAUDIT.md` §6 #13 | Add Docker build + Trivy/docker-scout job. |
| 4.22 | **docker-compose lacks healthcheck/resource limits** | App failures won't restart container. | `AUDIT_REPORT_REAUDIT.md` §6 #14 | Add healthcheck, `mem_limit`, `cpus`, log rotation. |
| 4.23 | **PDPL compliance workflow is scaffolding only** | Data-request table exists but no fulfilment SLA or erasure workflow. | `dataRequests` table | Implement request intake, identity verification, 30-day SLA, secure download, and erasure log. |

---

## 5. Prioritised Roadmap

### P0 — Blockers for Safe Operations (do first)

1. Fix remaining lifecycle bypasses (paid join, manual renewal, admin status changes) so `lifecycleState` and `status` cannot drift.
2. Enforce email verification before application, payment, and sensitive actions.
3. Close finance governance gaps: route expenses through chapter-budget approval; define refund policy and membership revert logic.
4. Fix authenticated tRPC rate limiting and switch `scryptSync` to async.
5. Fix public-site colour contrast failures and white-on-white text bugs.
6. Add graceful shutdown, non-root Docker user, and tighten `.dockerignore`.

### P1 — ERP-Grade Functionality (next sprint)

7. Implement awards judging workflow (judges, scores, deliberation, notifications, winners page).
8. Define and enforce award categories and nomination windows.
9. Build financial reports and invoice/credit-note generation.
10. Fix governance gaps: election seat assignment, term limits, motion quorum, conduct appeal reversal.
11. Add chapter-level RBAC and delegated admin.
12. Implement referral conversion flow and atomic score recomputation.
13. Add onboarding enforcement and win-back campaign.
14. Unify public website design system; rebuild homepage on shared system.

### P2 — Scale, Franchise & World-Class UX (following sprint)

15. Franchise readiness: regional rollups, chapter P&L, franchisee onboarding checklist, policy distribution.
16. Analytics/event stream + conversion funnel reports.
17. Production observability: `/metrics`, structured logs, dependency vulnerability CI, Docker security scans.
18. Public-site motion/interactivity overhaul (benchmark-quality animations, scroll reveals, micro-interactions).
19. Mobile UX polish across portal and public site.
20. PDPL compliance workflow and self-service data export.

---

## 6. How to Use This Document

- Each gap references the underlying audit or code location. Use the table as a checklist in project-management tooling.
- Treat P0 items as prerequisites for any production launch with real members and money.
- P1 items are required before positioning the portal as an ERP-grade system.
- P2 items are the difference between a functional portal and a world-class franchise platform.

---

*End of Consolidated Gap Analysis*
