# eHive Circle Portal — Gap Audit (August 2026)

_Scope: business, functional, UI/UX and technical gaps across the whole platform.
Read against the previous re-audit (`AUDIT_REPORT_REAUDIT.md`); this report marks
what that one flagged as **now closed**, and concentrates on what remains open plus
newly surfaced gaps. All file references are to the current `main`._

---

## Executive summary

The platform is in strong shape and most of the previous re-audit's **Critical/High**
findings have been resolved. The Awards & Recognition system is now built end-to-end
(judging engine, Hall of Fame, integrity layer), finance has reporting + a read-only
ERP/accounting integration API, and the lifecycle/governance drift issues are largely
closed.

The remaining gaps cluster in four places: **market fit** (no Arabic/RTL for a UAE
product), **scale/robustness** (unpaginated admin lists, in-process scheduler & rate
limiter, dependency vulnerabilities, thin router test coverage), **operational
visibility** (no `/metrics`, no off-site backup), and **UI resilience** (query-error
states and a few accessibility items still unfinished). None are launch-blockers for a
single-instance pilot; several are must-fix before scaling to multiple chapters/replicas.

### Closed since the last re-audit (verified)

| Area | Closed |
|---|---|
| Awards | Full judging engine — panel (#120), auto-score (#121), conferral + fairness caps (#122), constrained voting (#123), Hall of Fame + intake cap (#124), integrity/anti-gaming layer (#125) |
| Finance | Financial reports + CSV export (#118); read-only ERP/accounting integration API (#119); expense spend-approval now routes through `proposed → approved` (`finance.ts:565-569`); refund/payment URLs built from `env.publicUrl`, not request `Origin` |
| Governance | Election close now auto-fills the seat + notifies (#126); paid/admin/Zenith joins enter `onboarding` via the lifecycle executor; conduct reinstate routed through `applyLifecycleTransition` |
| Security | Async `scrypt` (non-blocking); Docker runs as non-root `USER node`; `SIGTERM/SIGINT` graceful shutdown; `.dockerignore` excludes secrets; global per-IP tRPC rate limit; TOTP 2FA; email-verification flow |
| UI | Native `confirm()` removed in favour of `confirmDialog` |

---

## 1. Business gaps

| # | Sev | Gap | Evidence | Recommendation |
|---|-----|-----|----------|----------------|
| B1 | High | **No Arabic / RTL localisation.** The product targets the UAE but there is no i18n layer, no `dir="rtl"`, no Arabic copy — everything is hard-coded English LTR. | no `react-i18next`/`dir="rtl"` anywhere in `src/` | Introduce an i18n layer (message catalogue + `dir` switch); at minimum localise the member portal and transactional emails to Arabic. |
| B2 | High | **Awards catalogue only covers member + chapter levels.** The spec's higher-level awards (President/Chapter/Zone/Region/National of the Year, scored from rolled-up CHI/ZHI/commercial indices — spec Parts 4–6) are not wired; auto-scoring only runs on the member cohort. | `award-autoscore.ts` scores members only; no org-unit rubric path | Add org-unit-level auto-scoring (CHI/ZHI/commercial deltas) so zone/region/national awards can run, per the KPI framework. |
| B3 | Med | **Refund policy not enforced.** `refundPayment` validates amount only — no time window, non-refundable fee, or "membership already consumed" rule. | `api/queries/finance.ts:307` | Add a `refundPolicy` config (max window, max refundable %, block after N active days). |
| B4 | Med | **Members can't self-serve billing history / invoices.** The integration API is read-only and admin-facing; a member has no "my payments / download receipt" view. | no member billing endpoint in `circle-router.ts` | Expose a member billing history + receipt/invoice download (the integration layer already models the data). |
| B5 | Med | **Award cycle scheduling is manual.** The spec calls for a configurable cycle scheduler that opens/closes windows automatically on the operating calendar; today an officer drives every status transition by hand. | `AdminAwards` status buttons; no cron for award windows | Add scheduled open/close of nomination & voting windows to the daily scheduler. |

---

## 2. Functional gaps

| # | Sev | Gap | Evidence | Recommendation |
|---|-----|-----|----------|----------------|
| F1 | High | **Admin lists are capped, not paginated.** Members list hard-caps at 300 rows (search exists, but no offset/cursor); other admin lists cap at 200. Beyond the cap, records silently vanish from the UI. | `admin-router.ts:~519` (`.limit(300)`); 39 `.limit(...)` sites | Add cursor/offset pagination (and server-side sort) to members, prospects, leads, audit, payments. |
| F2 | High | **Login is not gated on email verification.** `login` checks password + 2FA but never `emailVerifiedAt`; unverified accounts can sign in and use non-payment features. | `api/auth-router.ts:117-152` | Reject login (or restrict sensitive actions) until `emailVerifiedAt` is set; offer resend. |
| F3 | Med | **No 2FA enforcement for privileged roles.** TOTP is opt-in; a full/owner admin can operate without a second factor. | no `require2fa`/admin-2FA policy in `api/` | Require 2FA for admin scopes (grace period + enrolment prompt on first privileged action). |
| F4 | Med | **No active-session management.** `tokenVersion`/`incrementTokenVersion` exist (global "log out everywhere"), but a member can't see or revoke individual devices/sessions. | `auth-router.ts:197` | Add a sessions list + per-session revoke (store session metadata; bump version to revoke). |
| F5 | Med | **No bulk admin actions.** Every lifecycle move, notification, or role change is one-at-a-time; operating many chapters will be slow. | admin routers are all single-id mutations | Add bulk endpoints (bulk notify, bulk lifecycle transition, CSV member import) with audit. |
| F6 | Low | **Conduct appeal `reversed` may not fully unwind the action.** The moderation `reinstate` path uses the lifecycle executor, but the appeal-`reversed` branch resets the case without a guaranteed member reinstatement. | `api/conduct-router.ts:340-351` | On `reversed`, transition the member back to `active` and notify, mirroring the `reinstate` path. |

---

## 3. UI/UX gaps

| # | Sev | Gap | Evidence | Recommendation |
|---|-----|-----|----------|----------------|
| U1 | High | **Query-error states largely unhandled.** Only 1 of 30 admin pages uses `LoadError`+retry; the rest fall through to an empty/blank state on a network failure, indistinguishable from "no data". | `grep LoadError src/pages/admin` → 1/30 | Add `q.isError && <LoadError onRetry={q.refetch}/>` branches across admin pages (the prior re-audit's UI#4, still open). |
| U2 | Med | **A few clickable table rows aren't keyboard-accessible.** `<tr onClick>` without `role`/`tabIndex`/`onKeyDown` remains in 3 admin tables. | 3 `<tr … onClick>` in `src/pages/admin` | Convert to per-row buttons/links or add `role="button"`, `tabIndex=0`, `aria-label`, `onKeyDown`. |
| U3 | Med | **Form controls relying on placeholders lack labels.** KYC review note / TOTP inputs still use placeholder-only labelling in places. | `AdminKycPanel`, `TwoFactorSettings` | Add `<label>`/`aria-label` for screen-reader parity (prior UI#6). |
| U4 | Low | **No list virtualization / skeletons on large tables.** Big member/audit tables render all rows at once with a spinner, not skeletons or windowed rows. | admin list pages | Pair with F1 pagination; add skeleton loaders for perceived performance. |

---

## 4. Technical gaps

### Security

| # | Sev | Gap | Evidence | Recommendation |
|---|-----|-----|----------|----------------|
| T1 | High | **20 dependency vulnerabilities (12 high, 7 moderate, 1 low).** Unpatched since the last re-audit. | `npm audit` → 20 vulns | `npm audit fix`; upgrade breaking deps on a branch; add `npm audit --omit=dev` as a CI gate. |
| T2 | Med | **CSP still allows `'unsafe-inline'`** for scripts/styles (marketing transitional). | `api/boot.ts:48-49` | Move to nonces/hashes; drop `'unsafe-inline'`. |

### Infrastructure & operations

| # | Sev | Gap | Evidence | Recommendation |
|---|-----|-----|----------|----------------|
| T3 | High | **In-process scheduler has no distributed lock.** Safe on one replica (daily marker in `app_config`), but >1 replica would double-run or skip jobs. | `api/lib/scheduler.ts` | Single-replica worker, or an advisory/Redis lock around the daily pass, before scaling out. |
| T4 | High | **Rate limiter is in-process only.** Per-IP/account limits are bypassable across replicas. | `api/lib/rate-limit.ts:1-6` (documented) | Back with Redis when running >1 instance. |
| T5 | Med | **No `/metrics` or structured JSON logs.** Only `/api/health` exists; logs are PII-redacted text, not machine-parseable. | no `/metrics` in `boot.ts`; `api/lib/log.ts` | Add a Prometheus `/metrics` endpoint and structured JSON logging. |
| T6 | Med | **DB pool has no acquire/idle timeouts.** `connectionLimit: 20` only; a stall can exhaust the pool with no recovery bound. | `api/queries/connection.ts:20` | Add `acquireTimeout`, `idleTimeout`, env-driven limits. |
| T7 | Med | **Backups live only as GitHub artifacts (90-day).** No durable off-site copy; and the workflow is inert until `DATABASE_BACKUP_URL` is set. | `.github/workflows/backup.yml` | Upload dumps to S3/R2 with versioning; set the secret. |
| T8 | Med | **CI runs no dependency/container security scan.** No `npm audit`, no Trivy/Docker build. | `.github/workflows/ci.yml` | Add `npm audit` + a Docker build + image scan job. |

### Testing & data

| # | Sev | Gap | Evidence | Recommendation |
|---|-----|-----|----------|----------------|
| T9 | High | **No router/integration test coverage.** All 19 test files exercise pure functions; no tRPC caller tests for auth, payments webhook, lifecycle, or the award conferral gates. The `integration-test.mts` script needs a live DB and isn't in CI. | `api/*.test.ts` (all pure) | Add `createCaller` tests for the critical mutations (login, webhook, conferral, lifecycle), and wire a DB-backed integration job. |
| T10 | Low | **Scheduler failure visibility.** A failed daily job is retried only next UTC day; no alert. | `api/lib/scheduler.ts` | Record run status and alert (email/`kpi_alerts`) on failure. |

---

## 5. Prioritised roadmap

**P0 — before scaling beyond a single replica**
- T3 distributed scheduler lock · T4 Redis-backed rate limiter · T1 dependency vulnerabilities · F2 login email-verification gate

**P1 — before multi-chapter go-live**
- F1 list pagination · U1 query-error states · T9 router/integration tests · T7 off-site backups · T8 CI security scans · B3 refund policy · F3 admin 2FA enforcement

**P2 — market & depth**
- B1 Arabic/RTL · B2 higher-level awards auto-scoring · B5 award-window scheduler · B4 member billing self-service · F4 session management · F5 bulk actions · T5 `/metrics` + JSON logs · T6 DB pool timeouts · U2–U4 remaining a11y/UX · T2 CSP hardening · F6 appeal-reversal unwind

---

_Method: static review of routers (`api/*-router.ts`), queries (`api/queries/*`),
schema (`db/schema.ts`), pages (`src/pages/*`), infra (`Dockerfile`, `.github/workflows`,
`api/boot.ts`, `api/lib/*`) and `npm audit`, cross-checked against the prior re-audit._
