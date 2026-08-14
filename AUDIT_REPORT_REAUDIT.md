# eHive Portal — Re-audit & Gap Analysis

**Date:** 2026-08-13  
**Repository:** `https://github.com/shaheenaurora/eHive-Portal`  
**Scope:** Full-stack audit — security, functionality, business logic, UI/UX, lifecycle/governance, infrastructure/operations.

---

## Executive Summary

Since the last audit, the codebase has matured significantly:

- **Payments** are now idempotent (`payment_records.providerRef` unique per provider; webhook compare-and-swap).
- **Lifecycle transitions** are enforced through a central executor that keeps `status` coherent, opens/closes Save Playbook cases, notifies members, and audits.
- **Real Drizzle migrations** have replaced runtime `ensureSchema` patching; a pre-deploy baseline script handles the switch from `db:push` to `db:migrate`.
- Most of the original Critical/High security findings have been fixed (XSS escaping, safe user payloads, 7-day JWT + `tokenVersion`, `SameSite=Lax`, CSP, rate limiting on public endpoints, scoped push subscriptions, payment webhook authority checks).

**What remains** are business-process gaps that prevent the portal from operating as an ERP-grade system, plus several security/infrastructure hardening items that should be closed before scaling or go-live.

**Overall risk:** The app is now structurally sound, but **finance governance, awards judging, lifecycle completeness, and production hardening** still need work.

---

## 1. Finance — ERP-grade gaps

### Critical

| #   | Finding                                                   | Why it matters                                                                                                                                                                                                                                                           | Location                                                                                      | Recommended fix                                                                                                                      |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Expenses bypass chapter spend-approval policy**         | `recordExpense` inserts a `chapter_budgets` row with `kind: "spend"` and hard-codes `status: "approved"`. It never checks `SPEND_APPROVAL_THRESHOLD_AED` or routes through the proposal/approval flow. A finance-scoped admin can spend chapter money without oversight. | `api/queries/finance.ts:508-553`                                                              | Route every expense above the threshold through `proposed → approved` via the existing chapter-budget workflow (`decideBudgetLine`). |
| 2   | **Finance expenses and chapter budgets are disconnected** | The Finance UI records spend, while the Chapters UI has a proposal/approval flow. There is no shared model, so finance operates outside governance controls.                                                                                                             | `src/pages/admin/AdminFinance.tsx:1003-1105` vs. `src/pages/admin/AdminChapters.tsx:932-1002` | Unify spend recording behind the chapter-budget approval flow; Finance records the payment, Chapters owns the approval.              |

### High

| #   | Finding                                               | Why it matters                                                                                                                                          | Location                                           | Recommended fix                                                                                                        |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 3   | **No refund policy enforcement**                      | `refundPayment` only checks amount ≤ captured. No time-window, no non-refundable-fee rule, no check that the membership has not been consumed.          | `api/queries/finance.ts:282-369`                   | Add a `refundPolicy` config: max window, max refundable %, and block refunds when membership has been active > N days. |
| 4   | **No financial reports or exports**                   | Only headline `financeSummary` and a renewals report exist. Missing P&L, cash-flow, revenue-by-period, refunds report, expense-by-category, ledger CSV. | `api/queries/finance.ts`, `api/queries/reports.ts` | Build Finance → Reports → Export with date-range filters and CSV/PDF output.                                           |
| 5   | **No invoices or credit notes**                       | Manual payments create a row but no invoice document; refunds update the row but generate no credit note.                                               | `api/queries/finance.ts:99-121`, `:282-369`        | Generate invoice/credit-note records and expose a download endpoint.                                                   |
| 6   | **Payments status filter omits `partially_refunded`** | Admin filter allows pending/paid/failed/refunded but not `partially_refunded`, even though the schema and UI support it.                                | `api/admin-router.ts:2036`                         | Add `"partially_refunded"` to the filter enum.                                                                         |

### Medium / Low

- No receipt/attachment support for expenses (`recordExpense` has no file/URL field).
- Revenue recognition is coarse (`paidAt` only); no fiscal-period or deferred-revenue handling.
- No dunning or payment reminders for pending payments.
- Single-currency hard-coding (AED) throughout finance and Stripe.
- No bank-reconciliation or batch import.

---

## 2. Awards — recognition program gaps

### Critical

| #   | Finding                 | Why it matters                                                                                                                                                                                                     | Location                                  | Recommended fix                                                                                             |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | **No judging workflow** | Winners are picked by admin toggle (`shortlisted` / `winner` / `declined`). There is no scoring rubric, judge assignment, deliberation panel, voting, or tie-breaking. The `judging` cycle status is just a label. | `src/pages/admin/AdminAwards.tsx:302-335` | Implement a judging model: `award_judges`, `award_scores`, and a deliberation phase before winners are set. |

### High

| #   | Finding                                                         | Why it matters                                                                                                                                              | Location                                                                              | Recommended fix                                                                                |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 2   | **Nomination dates are not enforced**                           | `awardCycles.opensAt`/`closesAt` are collected but never checked by `openCycle()` or `submitNomination`.                                                    | `db/schema.ts:1106-1107`; `api/queries/awards.ts:61-71`; `api/engage-router.ts:53-97` | Reject nominations outside the open window; block opening a cycle before `opensAt`.            |
| 3   | **Backend does not validate category subject vs. nominee type** | Frontend switches member/chapter pickers, but the backend accepts any combination. A member can be nominated for “Chapter of the Year” via direct API call. | `api/queries/awards.ts:180-200`; `api/admin-engage-router.ts:2198-2223`               | Enforce `AWARD_CATEGORIES[*].subject` server-side.                                             |
| 4   | **No scoped nomination validation**                             | A chapter/zone/region/country cycle has a `unitId`, but `nominate` does not verify the nominee belongs to that unit.                                        | `api/queries/awards.ts:180-200`                                                       | Validate nominee membership/chapter against the cycle's `level` + `unitId`.                    |
| 5   | **No duplicate-nominee guard within a category**                | `alreadyNominated` only checks the nominator; the same nominee can receive multiple nominations.                                                            | `api/queries/awards.ts:203-220`                                                       | Add a unique constraint or guard on `(cycleId, category, nomineeMemberId / nomineeChapterId)`. |
| 6   | **No notifications for shortlisted/winner nominees**            | Status changes update the row but do not notify nominees or the chapter.                                                                                    | `api/admin-engage-router.ts:2198-2223`                                                | Send in-app/email notifications on shortlist and winner announcements.                         |

### Medium / Low

- Shortlist phase is not enforced (`winner` can be set directly from `nominated`).
- Fixed category list is small; missing common categories like “Deal of the Year”, “Innovation”, etc.
- No per-member nomination cap across categories.
- Winners do not update profiles/badges or earn Hive Score recognition.
- No public standalone winners page.
- No nomination activity log or decline reason.

---

## 3. Lifecycle, Governance & Chapter Operations

### Critical

| #   | Finding                                              | Why it matters                                                                                                                                                     | Location                         | Recommended fix                                                                               |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | **Paid join bypasses onboarding**                    | `activateMembership` inserts new members with the schema default `lifecycleState: "active"` instead of `"onboarding"`. Stripe-paid members never enter onboarding. | `api/queries/circle.ts:262-264`  | Set `lifecycleState: "onboarding"` for new members and trigger onboarding notification/audit. |
| 2   | **Manual renewal bypasses lifecycle executor**       | `recordManualPayment` with `extendRenewal` directly writes `status`/`lifecycleState`, skipping save-case side effects and centralized notifications.               | `api/queries/finance.ts:242-269` | Route through `renewMembership` or `applyLifecycleTransition`.                                |
| 3   | **Application approval bypasses lifecycle executor** | `setApplicationStatus` creates the member manually with `lifecycleState: "onboarding"`, so the applicant gets no onboarding notification and no lifecycle audit.   | `api/admin-router.ts:431-439`    | Use `applyLifecycleTransition(memberId, "onboarding", { actor, reason })` after insert.       |
| 4   | **Member pause/cancel mutates `status` directly**    | `requestMembershipChange` sets `status` to paused/cancelled without transitioning `lifecycleState`, causing drift (e.g. `cancelled` + `active`).                   | `api/circle-router.ts:578-582`   | Use `applyLifecycleTransition` to `at_risk`/`lapsed`/`alumni` and let it coerce `status`.     |

### High

| #   | Finding                                                | Why it matters                                                                                                                                                                                                                               | Location                               | Recommended fix                                                                                                    |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 5   | **Self-renewal blocks lapsed/alumni win-back**         | `startRenewal` rejects `cancelled`/`alumni`/`suspended`. Because `lapsed` maps to `status: "cancelled"`, lapsed members cannot self-renew, contradicting the lifecycle matrix that allows `lapsed → active` and `alumni → active` win-backs. | `api/circle-router.ts:125-134`         | Allow self-renewal for `lapsed` and `alumni`; keep `suspended` blocked.                                            |
| 6   | **Zenith admissions skip onboarding**                  | `decideZenith` creates a new member with default `lifecycleState: "active"`.                                                                                                                                                                 | `api/admin-engage-router.ts:779-784`   | Set `lifecycleState: "onboarding"`.                                                                                |
| 7   | **Chapter transfer approval is silent**                | `decideChapterTransfer` only updates `homeChapterId`; no notification, no target-chapter validation, no audit/lifecycle event.                                                                                                               | `api/admin-engage-router.ts:1173-1193` | Notify the member, validate target chapter, audit the transfer.                                                    |
| 8   | **Admin status changes bypass lifecycle coherence**    | `setMemberStatus` updates `status` independently, allowing inconsistent pairs like `cancelled` + `active`.                                                                                                                                   | `api/admin-router.ts:851-879`          | Derive or enforce a matching `lifecycleState`, or remove direct status mutation in favor of lifecycle transitions. |
| 9   | **Election close does not fill the seat**              | `setElectionStatus(...closed)` tallies votes but does not assign the role or notify the winner.                                                                                                                                              | `api/admin-engage-router.ts:1539-1623` | Auto-assign the winning candidate to `chapter_roles` and notify.                                                   |
| 10  | **Conduct appeal reversal does not unwind the action** | `decideAppeal` with outcome `reversed` resets the case to `reviewing` but never reinstates the member or reverts the lifecycle change.                                                                                                       | `api/conduct-router.ts:340-351`        | On reversal, transition the member back to `active` and notify.                                                    |

### Medium / Low

- Application rejection does not notify the applicant.
- Direct chapter assignment (`setHomeChapter`) is silent.
- Role assignment/ending lacks member notification.
- Motion close does not notify the chapter.
- Term limits (`CHAPTER_TERM_LIMIT_CONSECUTIVE`) are defined but never enforced.
- Application status transitions are unvalidated.
- Conduct case updates do not notify stakeholders.
- `openCount` selects all rows into memory instead of using `COUNT`.
- Motion voting lacks quorum/eligibility checks beyond home chapter.

---

## 4. Security — remaining findings

### High

| #   | Finding                                                    | Why it matters                                                                                                | Location                                 | Recommended fix                                                  |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| 1   | **Payment success/cancel URLs still use request `Origin`** | An attacker who influences `Origin` can redirect a member to a phishing domain after Stripe checkout/renewal. | `api/circle-router.ts:81-92`, `:137-147` | Build URLs from configured `env.publicUrl`, not request headers. |
| 2   | **Synchronous `scryptSync` blocks the event loop**         | Login/registration stalls Node for ~50–200 ms per hash; cheap DoS vector.                                     | `api/lib/password.ts:35,47`              | Switch to async `scrypt` or `argon2id`.                          |
| 3   | **No rate limiting on authenticated tRPC mutations**       | Expensive authed operations are unbounded.                                                                    | `api/*-router.ts`                        | Add per-IP/per-user rate-limit middleware on `/api/trpc/*`.      |

### Medium

| #   | Finding                                                          | Why it matters                                                                                                                                                              | Location                                     | Recommended fix                                                     |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| 4   | **`/api/lead` rate-limit key trusts leftmost `X-Forwarded-For`** | Clients can prepend spoofed IPs to bypass per-IP limits.                                                                                                                    | `api/boot.ts:22-27`                          | Use rightmost untrusted proxy IP, matching `auth-router.ts:50-54`.  |
| 5   | **Public insight JSON endpoints return raw `body` HTML**         | The server-rendered HTML route escapes content, but `/api/insights/:slug` and the tRPC `insightBySlug` still serve raw HTML. Any client rendering it raw is XSS-vulnerable. | `api/boot.ts:174-183`; `api/router.ts:42-53` | Sanitise or strip HTML in public JSON payloads, or serve Markdown.  |
| 6   | **CSP allows `'unsafe-inline'`**                                 | Marketing-site inline scripts/styles can still execute.                                                                                                                     | `api/boot.ts:39-49`                          | Move to nonces/hashes and remove `'unsafe-inline'`.                 |
| 7   | **Login is not gated on `emailVerifiedAt`**                      | Unverified accounts can sign in and use non-payment member features.                                                                                                        | `api/auth-router.ts:117-152`                 | Reject login or restrict sensitive actions until email is verified. |
| 8   | **Tier-change requests lack business-rule validation**           | Members can request arbitrary tier changes with only a pending-conflict check.                                                                                              | `api/circle-router.ts:515-594`               | Validate allowed transitions, minimum tenure, and downgrade rules.  |

### Low

- `/api/lead` has rate limiting but no honeypot/CAPTCHA.
- `TOTP_SECRET` falls back to `APP_SECRET` if unset.
- `/api/newsletters` returns full rows that may contain raw HTML.

---

## 5. UI/UX

### Critical

| #   | Finding                                             | Why it matters                                                                                                         | Location                                                                             | Recommended fix                                           |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 1   | **Native `confirm()` used for destructive actions** | `AdminLibrary`, `AdminOffers`, `AdminAccess` use native `confirm()`, which blocks the main thread and is inaccessible. | `src/pages/admin/AdminLibrary.tsx:123`; `AdminOffers.tsx:133`; `AdminAccess.tsx:367` | Replace with the app's `confirmDialog({ danger: true })`. |
| 2   | **Admin Insights deletes with no confirmation**     | One-click delete risk.                                                                                                 | `src/pages/admin/AdminInsights.tsx:134`                                              | Wrap in `confirmDialog`.                                  |

### High

| #   | Finding                                              | Why it matters                                                         | Location                                                                                                                                                                                                                                                                      | Recommended fix                                                                            |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 3   | **Admin dashboard misuses `Empty` for error state**  | Query errors render as an empty state with no retry.                   | `src/pages/admin/AdminDashboard.tsx:33-36`                                                                                                                                                                                                                                    | Use `LoadError` with `onRetry`.                                                            |
| 4   | **Many admin pages ignore query errors**             | Network failures silently fall through to empty/blank states.          | `AdminPods`, `AdminLibrary`, `AdminOffers`, `AdminNewsletters`, `AdminGovernance`, `AdminFrp`, `AdminAwards`, `AdminOps`, `AdminAdmissions`, `AdminConnect`, `AdminEvents`, `AdminScore`, `AdminReports`, `AdminFinance`, `AdminChapters`, `AdminEngagement`, `AdminRequests` | Add `q.isError && <LoadError onRetry={...} />` branches.                                   |
| 5   | **Clickable table rows are not keyboard accessible** | `<tr onClick>` is not focusable and has no `role` or keyboard handler. | `AdminApplications:110`; `AdminMembers:215`; `AdminProspects:182`; `AdminConduct:224`; `AdminLeads:133`                                                                                                                                                                       | Convert to per-row buttons/links or add `tabIndex`, `role`, `aria-label`, and `onKeyDown`. |
| 6   | **Form controls lack accessible labels**             | KYC review note, TOTP code inputs rely on placeholders only.           | `src/components/AdminKycPanel.tsx:64`; `src/components/TwoFactorSettings.tsx:65,121`                                                                                                                                                                                          | Add `<label>` or `aria-label`.                                                             |

### Medium / Low

- Data tables lack `<caption>` and `scope="col"`.
- Mobile drawer and notification popover lack focus trap / Escape close.
- Sidebar color contrast likely fails WCAG AA.
- Marketing countdown is not announced to screen readers.
- KYC ID number has minimal client-side validation.
- Member profile edit lacks visible validation feedback.
- Long tables overflow without accessible horizontal scrolling cue.
- Mixed form primitives across portal/admin.

---

## 6. Infrastructure, Deployment & Operations

### Critical

| #   | Finding                                                | Why it matters                                                                              | Location                                              | Recommended fix                                                        |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | **Docker container runs as root**                      | Compromise grants host root.                                                                | `Dockerfile:18-39`                                    | Add non-root `USER app`.                                               |
| 2   | **No graceful shutdown / SIGTERM handling**            | In-flight requests and scheduler jobs are dropped on restart.                               | `api/boot.ts:559`                                     | Add `SIGTERM` handler to stop scheduler, close pool, drain server.     |
| 3   | **In-process scheduler does not scale horizontally**   | With >1 replica, jobs duplicate or skip because the daily marker is not a distributed lock. | `api/lib/scheduler.ts:313-324`; `api/boot.ts:564-569` | Move scheduler to a single-replica worker or use advisory locks/Redis. |
| 4   | **Rate limiter is in-process only**                    | Multi-instance deployments bypass per-IP/account limits.                                    | `api/lib/rate-limit.ts:1-36`                          | Back with Redis.                                                       |
| 5   | **`.dockerignore` may leak secrets into image layers** | `.env`, `.env.*.local`, `*.pem`, `*.key` are not excluded.                                  | `.dockerignore:1-5`                                   | Add `.env*`, `*.pem`, `*.key`, credential directories.                 |

### High

| #   | Finding                                                   | Why it matters                                                                                                                              | Location                             | Recommended fix                                                                |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| 6   | **20 known dependency vulnerabilities**                   | Includes Hono CORS ReDoS, Vite/Rollup path traversal, React Router CSRF, PostCSS XSS, Nodemailer SMTP injection, nanoid infinite loop, etc. | `package-lock.json`                  | Run `npm audit fix`; upgrade breaking deps in a branch; add `npm audit` to CI. |
| 7   | **No production observability / metrics endpoint**        | Only `/api/health` exists.                                                                                                                  | `api/boot.ts:416-425`                | Add `/metrics` (Prometheus) and structured JSON logs.                          |
| 8   | **DB pool lacks timeout/retry configuration**             | `connectionLimit: 20` with no `acquireTimeout`/`idleTimeout`.                                                                               | `api/queries/connection.ts:10-22`    | Add timeouts and env-driven limits.                                            |
| 9   | **Very low test coverage**                                | 11 test files vs. ~195 source files.                                                                                                        | `vitest.config.ts`                   | Add integration tests for auth, payments webhook, tRPC routers.                |
| 10  | **Backup workflow stores dumps only as GitHub artifacts** | 90-day retention; not durable off-site.                                                                                                     | `.github/workflows/backup.yml:54-59` | Upload dumps to S3/R2 with versioning.                                         |
| 11  | **Docker build copies everything after `npm ci`**         | Poor cache invalidation on source edits.                                                                                                    | `Dockerfile:14`                      | Tighten `.dockerignore` and copy only build inputs.                            |
| 12  | **Production bundles are large**                          | `dist/boot.js` ~4.1 MB, `dist/pre-deploy.js` ~1.5 MB.                                                                                       | `npm run build` output               | Verify minification, tree-shake AWS SDK, lazy-load heavy routers.              |
| 13  | **CI does not build Docker image or run security scans**  | Dockerfile drift not caught.                                                                                                                | `.github/workflows/ci.yml:35`        | Add Docker build + Trivy/docker-scout job.                                     |
| 14  | **docker-compose has no healthcheck or resource limits**  | App failures won't restart container; runaway resources unbounded.                                                                          | `docker-compose.yml:35-51`           | Add healthcheck, `mem_limit`, `cpus`, log rotation.                            |
| 15  | **Scheduler silently swallows job failures**              | Failed daily jobs are missed until the next UTC day.                                                                                        | `api/lib/scheduler.ts:47-53`         | Track runs in `app_config` or table; alert on failure; retry.                  |

### Medium / Low

- Dockerfile copies `scripts/pre-deploy.ts` into runner even though only `dist/pre-deploy.js` is used.
- No `.nvmrc`.
- Vite dev-server plugin present in production config.
- `railway.json` restart policy gives up after 3 retries.
- Healthcheck returns 200 even when DB is down.
- README/DEPLOY still mention `db:push` for production in places.
- No separate staging config.
- CI does not persist build artifacts.

---

## 7. Prioritised Roadmap

### P0 — fix before any production traffic

1. Route expenses through chapter-budget approval (AF-02).
2. Use `env.publicUrl` for Stripe success/cancel URLs.
3. Switch password hashing to async `scrypt` or `argon2id`.
4. Add non-root `USER` to Dockerfile.
5. Add SIGTERM graceful shutdown.
6. Fix lifecycle bypasses (paid join → onboarding; manual renewal/application approval → executor; pause/cancel → executor).

### P1 — fix before go-live

7. Add per-IP/per-user rate limiting on authed tRPC.
8. Implement awards judging workflow (judges, scores, deliberation).
9. Enforce award-cycle dates and category/subject validation.
10. Fix self-renewal for lapsed/alumni win-back.
11. Sanitise public insight/newsletter JSON payloads.
12. Replace native `confirm()` with `confirmDialog`.
13. Add `LoadError` + retry to admin pages.
14. Upgrade vulnerable dependencies and add `npm audit` to CI.

### P2 — scale and polish

15. Move scheduler to a single-replica worker or add distributed locking.
16. Back rate limiter with Redis.
17. Add `/metrics` and structured logs.
18. Improve DB pool config.
19. Add integration tests for critical paths.
20. Implement financial reports/exports and invoice/credit-note generation.
21. Full UI/UX accessibility pass (focus management, labels, contrast, tables).

---

## Automated checks at time of re-audit

| Check                  | Result              |
| ---------------------- | ------------------- |
| `npm run check`        | ✅ Pass             |
| `npm run lint`         | ✅ Pass             |
| `npm run format:check` | ✅ Pass             |
| `npm run test`         | ✅ 94/94 tests pass |
| `npm run build`        | ✅ Pass             |
