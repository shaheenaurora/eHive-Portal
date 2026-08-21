# Audit reconciliation — second-opinion audit vs. actual code

_Every finding below was checked against the current `main`. Verdicts:_
**DONE** (already implemented) · **OPEN** (confirmed gap) · **PARTIAL** (partly done) ·
**DESCOPED** (deliberate product decision) · **N/A** (references code that doesn't
exist in this repo).

> ⚠️ About a quarter of the second audit points at files that aren't in this
> repository — `api/admin/membership.ts`, `api/admin/finance.ts`,
> `api/admin/system.ts`, an `appointments` table (`db/schema.ts:1836-1871`),
> `/api/bookings` (`api/boot.ts:500-614`), `public/home.css`. This repo splits the
> backend as `api/admin-router.ts` / `api/admin-engage-router.ts` / `api/queries/*`
> and has **no appointment/booking system**. Those findings are marked **N/A**.
> The second audit's own summary also claims a "MySQL-backed rate limiter" — the
> limiter here is **in-process** (`api/lib/rate-limit.ts`), so that summary line is
> wrong too.

## 1. Finance

| Finding | Verdict | Evidence |
|---|---|---|
| Expenses can overspend approved budgets | **OPEN** | `recordExpense` routes over-threshold spend to `proposed`, but neither it nor `decideBudgetLine` checks `allocated − spent ≥ amount` (`finance.ts:~532`). Real. |
| Refunds don't revert membership entitlement | **OPEN** | `refundPayment` updates the ledger + notifies only; no status/`renewalAt` revert (`finance.ts:307`). Real. |
| No invoices / credit notes | **DESCOPED** | You explicitly said skip VAT invoicing and keep it API-ready for external ERP — shipped as the read-only integration API (#119). Not a gap by decision. |
| Finance reports lack period filter / PDF / cash-flow | **PARTIAL** | Reports + CSV exist (#118) but `financeReport()` takes no date range, and there's no PDF/cash-flow. Open portion valid. |
| No dunning / payment reminders | **OPEN** | No dunning pass in the scheduler. |
| Single hard-coded currency (AED) | **OPEN** | `TIER_PRICE_AED` hard-coded; single-market by design, real if expanding. |
| No bank reconciliation / batch import | **OPEN** | Missing. |
| Expense receipts / attachments | **OPEN** | `chapter_budgets` has a text note only. |

## 2. Membership & lifecycle

| Finding | Verdict | Evidence |
|---|---|---|
| `setMemberStatus` bypasses lifecycle executor | **OPEN** | `.set({ status })` direct, no coherence coercion (`admin-router.ts`, not the cited `api/admin/membership.ts`). Real. |
| Tier changes lack business-rule validation | **PARTIAL** | `requestMembershipChange` checks rank direction only — no tenure/cooling-off (`circle-router.ts:514`). |
| Application rejection silent / status jumps | **PARTIAL** | Worth tightening; path cited is wrong (`api/admin/membership.ts`). |
| Direct chapter assignment silent | **OPEN** | `setHomeChapter` (`admin-engage-router.ts:1100`) doesn't notify. |
| Role assign/end lacks notification | **PARTIAL** | Manual `assignChapterRole` doesn't notify, **but** election-seat auto-fill (#126) does notify the elected member. |
| Chapter term limits not enforced | **OPEN** | `CHAPTER_TERM_LIMIT_CONSECUTIVE` not checked before re-appointment. |
| Motion close doesn't notify | **OPEN** | Outcome tallied, no chapter notification. |

## 3. Awards

| Finding | Verdict | Evidence |
|---|---|---|
| Admin nominations skip member validations | **PARTIAL** | Member `submitNomination` validates window/subject/unit; the admin `awardsNominate` path is looser. |
| No duplicate-nominee guard within a category | **OPEN (by design)** | `alreadyNominated` checks the nominator only — multiple people nominating one nominee is intentional for panel/vote awards. |
| Shortlist phase not enforced | **PARTIAL** | Conferral is now gated by ratification + the integrity scan across all three winner paths (#122–#125); the raw status toggle can still set `winner` directly. |
| No per-member nomination cap | **OPEN (by design)** | Spec is explicitly "one nomination per category". |

## 4. Leads & bookings

| Finding | Verdict | Evidence |
|---|---|---|
| No admin appointment workflow | **N/A** | No `appointments` table, no `/api/bookings` endpoint in this repo (grep = 0). `public/book.html` is a marketing form only; cited backend locations don't exist. |
| Lead assignment doesn't notify owner | **PARTIAL** | Plausible, but cited path `api/admin/finance.ts` doesn't exist. |
| No structured nurture beyond one email | **PARTIAL** | Scorecard nurture is persisted; multi-step sequencing isn't built. |

## 5. Admin capabilities

| Finding | Verdict | Evidence |
|---|---|---|
| No bulk operations | **OPEN** | Confirmed (matches my own audit F5). |
| No member directory export | **OPEN** | No members-CSV endpoint. |
| Audit trail not filterable/exportable | **PARTIAL/OPEN** | Returns last-N; no actor/action/date filter or CSV. |

## 6. Security

| Finding | Verdict | Evidence |
|---|---|---|
| 20 dependency vulnerabilities (12 high) | **OPEN** | `npm audit` = 20 (12 high, 7 mod, 1 low). |
| Login not gated on `emailVerifiedAt` | **OPEN** | `login` checks password + 2FA only (`auth-router.ts:117`). |
| PDPL export/deletion only updates status | **PARTIAL** | Request queue exists (`engage-router.ts:361`); real export-file/erasure fulfilment isn't automated. |
| Refund policy not enforced | **OPEN** | `computeRefund` checks amount only — no window/consumption rule. |
| Integration API exposes raw PII | **BY DESIGN** | ERP sync needs contact data; endpoint is admin/key-scoped. Keep access-controlled. |
| CSP allows `'unsafe-inline'` for styles | **OPEN** | `boot.ts:48-49` (transitional). |
| No honeypot/CAPTCHA on `/api/lead` | **OPEN (low)** | None; endpoint is rate-limited. |
| `TOTP_SECRET` falls back to `APP_SECRET` | **BY DESIGN (low)** | Documented fallback (`env.ts:27`); separate secret recommended. |
| No per-user rate limit on `requestData` | **OPEN (low)** | Minor. |

## 7. UI/UX

| Finding | Verdict | Evidence |
|---|---|---|
| Accent `#DA3A22` fails WCAG AA on light | **PARTIAL** | Marketing text uses the darker `#a62e1a`; the raw accent is used for icons/borders. Audit contrast for text usages. `public/home.css` (cited) doesn't exist. |
| Public buttons lack `:focus-visible` | **PARTIAL** | `public/styles.css` has 29 `:focus` rules; `public/apps.css` widgets have none. |
| Admin mobile drawer not keyboard-accessible | **OPEN (likely)** | Worth a focus-trap/Escape pass. |
| Admin table rows mouse-only (`<tr onClick>`) | **PARTIAL** | 2 remain (`AdminLeads`, `AdminProspects`); `AdminApplications` no longer has it. |
| Admin pages don't enforce admin role in shell | **LOW (backend-enforced)** | Every admin endpoint is `scopedAdmin`/`adminQuery`; the shell guard is defense-in-depth only. |
| Destructive admin actions lack confirmation | **DONE (largely)** | 14 admin pages use `confirmDialog`; native `confirm()` removed. Spot-check a few remaining. |
| Booking success shown when email fails | **N/A** | Marketing-form behaviour; no booking backend here. |
| Get-Started ARIA semantics | **OPEN (low, marketing)** | Minor. |
| Notification dropdown lacks focus/Escape/outside-click | **OPEN** | `NotifBell` (`eh.tsx:656`) has no Escape/outside-click handling. |
| Admin list views ignore query errors | **OPEN** | Only 1/30 admin pages use `LoadError` (matches my audit U1). |
| No bulk select/export in admin lists | **OPEN** | Confirmed. |
| Static public pages lack cookie consent | **PARTIAL** | Portal has consent; static marketing pages may not. |
| Placeholder testimonial on homepage | **OPEN (low)** | Marketing copy. |

## 8. Architecture / data / ops

| Finding | Verdict | Evidence |
|---|---|---|
| Almost no foreign-key constraints | **OPEN** | 0 `.references()` in `db/schema.ts`. Real data-integrity gap (common trade-off, worth adding after orphan reconciliation). |
| No `/metrics` endpoint | **OPEN** | Confirmed. |
| Scheduler has no distributed lock | **OPEN** | Safe on one replica (day marker in `app_config`); breaks on >1. |
| CI doesn't build Docker / run `npm audit` / integration tests | **OPEN** | Confirmed. |
| Backups only as 90-day GitHub artifacts | **OPEN** | Inert until `DATABASE_BACKUP_URL` set; not off-site. |
| Missing secondary indexes | **PARTIAL** | `members` is well-indexed; some FK-less tables aren't. |
| Health check returns 200 when DB down | **BY DESIGN** | It's a **liveness** probe (returns 200, reports DB status in body). Add a separate readiness probe if desired. |
| No structured JSON logging / request IDs | **PARTIAL** | PII-redacting log wrapper exists (`lib/log.ts`); not JSON, no request IDs. |
| Backend bundle ~4.1 MB | **OPEN (server-side)** | Not user-facing; worth trimming. |
| Fixed limits without pagination | **OPEN** | Matches my audit F1. |
| docker-compose app lacks healthcheck/limits | **PARTIAL** | `db` service has a healthcheck; `app` doesn't. |

---

## Bottom line

**Genuinely open and worth doing (my ranking):**
1. Enforce chapter-budget balance in `recordExpense` (Critical)
2. Revert membership/renewal entitlement on refund (Critical)
3. Route `setMemberStatus` through the lifecycle executor (High)
4. Gate login on `emailVerifiedAt` (High)
5. Finance report date-range filtering (+ PDF/cash-flow) (High)
6. Add foreign-key constraints after orphan reconciliation (High, needs care)
7. Distributed scheduler lock + Redis rate limiter before multi-replica (High)
8. `npm audit` fixes + CI security scan (High)
9. Admin query-error states, notification-dropdown a11y, remaining `<tr onClick>` (Med)
10. Member/lead CSV export + bulk actions; dunning; term-limit enforcement (Med)

**Already done — do not re-do:** destructive-action confirmations (`confirmDialog` on 14 pages), non-root Docker, graceful shutdown, awards judging/Hall-of-Fame/integrity workflow, election-seat auto-fill, async password hashing, scoped-admin enforcement on every admin endpoint, encrypted TOTP, payment redirect URLs from `env.publicUrl`, expense approval-threshold routing, persisted scorecard nurture.

**Descoped by you (not gaps):** invoices/credit notes (→ integration API), VAT.

**N/A (not in this repo):** appointment/booking admin workflow and its cited backend, `api/admin/{membership,finance,system}.ts`, `public/home.css`, "MySQL-backed rate limiter".
