# eHive Portal — Deep Audit & Gap Analysis

**Date:** 30 Aug 2026  
**Scope:** Public site, member portal, admin/officer tools, business workflows, governance, finance, awards, notifications, security, DevOps, franchise readiness.  
**Method:** Static code audit of `eHive-Portal-clone/` (latest deployed branch).

---

## Executive Summary

The platform has made material progress since the last round: email delivery is working, migrations deploy cleanly, finance has invoice/credit-note flows, awards have categories and judging, governance has elections/motions, and a regional-officer layer exists. **However, the public site rebrand is incomplete, several business workflows are still half-wired, and franchise-ready operations need more scaffolding.**

**Most important finding:** `business-setup.html` and `get-started.html` were reported removed, but they still ship with the production build, still appear in navigation, and still contain full legacy content below a `meta refresh` redirect. This creates a duplicate-content SEO penalty, confused user journeys, and stale CTAs.

---

## 1. Public Site & Marketing Gaps

### P0 — `business-setup.html` and `get-started.html` are not actually removed

| Evidence                                        | Issue                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `public/business-setup.html:11`                 | `meta http-equiv="refresh" content="0; url=consulting.html"` but the full 1,086-line page still renders underneath. |
| `public/get-started.html:11`                    | Redirects to `clarity-scorecard.html` but still renders 604 lines of retired wizard.                                |
| `public/business-setup.html:61,69,541,678…1079` | Active nav link, "Get Started" button, and ~20 CTAs still point to `get-started.html?door=business`.                |
| `api/boot.ts:494-496,508`                       | Server-rendered insight article nav still links to `/business-setup.html` and `/get-started.html`.                  |
| `api/boot.ts:1088,1098`                         | Both files still in the static-pages allow-list.                                                                    |
| `public/app.js:687-970`                         | Business-setup calculator and get-started funnel JavaScript still loaded on every public page.                      |
| `public/home.css:1254,1588`                     | CSS for the retired wizard still bundled.                                                                           |
| `src/pages/admin/AdminLeads.tsx:494,606`        | Lead type `"get-started"` still listed and special-cased.                                                           |
| `db/seed.ts:571,595,665-674`                    | Seed insights/leads still reference the retired pages.                                                              |

**Fix:** Delete the HTML files, remove CSS/JS, purge boot.ts links, drop from static-pages list, remove the lead type, and update seed data. Replace with clean 301 redirects in `boot.ts`.

### P1 — Navigation inconsistency across public pages

- `business-setup.html` nav still shows "Business Setup" as a current page while other pages (index, consulting, circle, scorecard, brand-check) have already removed it.
- `get-started.html` nav is missing the "Login" CTA that exists on `business-setup.html`.
- `aria-current="page"` is hard-coded inconsistently; `app.js` dynamic matching misses `/`, `book.html`, `get-started.html`, `about.html`, `insights.html` (per `UX_AUDIT.md`).

### P1 — Conversion paths are fragmented

- Multiple entry points (scorecard, brand-check, booking, newsletter, membership application) submit to the same lead endpoint but have no unified CRM stage logic in the public UI.
- No exit-intent capture, no sticky CTA on mobile, no retargeting pixel / GTM / Meta CAPI plumbing visible.
- The "By the numbers" section on the homepage shows `0000` placeholders with no labels, undermining trust.

### P1 — SEO/AEO hygiene gaps

- `business-setup.html` and `get-started.html` serve self-referential canonicals (`consulting.html`, `clarity-scorecard.html`) but return 200 — search engines will index the wrong content.
- No `ld+json` structured data for Organization, LocalBusiness, Event, FAQ, or HowTo.
- No sitemap generation route; `/sitemap.xml` and `/robots.txt` are not produced by `boot.ts`.
- No Open Graph images per page; title/description are hard-coded in HTML rather than hydrated per route.
- Image alt text is generic or missing on several hero banners.

### P2 — Content still references the old pillar

- `public/business-setup.html` hero still says "Start on solid ground" and "Company formation, licensing, visas…"
- Insight article CTAs rendered by `api/boot.ts:508` still send users to `/get-started.html`.

---

## 2. Business Workflow / Functional Gaps

### P1 — Lead-to-member journey is not closed-loop

- Leads are captured and emailed, but there is no automatic prospect-stage progression in the CRM when a lead replies or books.
- `PROSPECT_STAGES` exist (`prospect`, `guest`, `invited`, `converted`, `declined`) but no automation moves a lead through them.
- Admin `AdminLeads.tsx` lets users change status, but there is no workflow trigger (e.g., "contacted → send email", "invited → create guest registration").

### P1 — Booking flow is request-only, not confirmed

- `sendBookingConfirmation` sends a "request received" email unless `confirmed: true`, but nothing in the admin UI appears to flip `confirmed` when a slot is actually locked.
- No calendar integration (Google/Outlook CalDAV) to generate `.ics` invites automatically.
- No cancellation/reschedule flow for booked sessions.

### P1 — Scorecard / brand-check results are emailed, but follow-up is manual

- `sendScorecardFollowUp` exists for `follow_up_1` and `follow_up_2` stages, but there is no scheduler that sends these automatically after N days.
- No lead scoring that combines scorecard total + brand-check answers to prioritize hot leads.

### P2 — Membership application lacks status transparency

- Applicants can apply, but there is no public "check your application status" page.
- Rejected applicants are not emailed automatically (only accepted members get `activateMembership` notification).

### P2 — Newsletter signup is not connected to a list

- The `newsletter` form captures leads, but there is no `newsletter_subscribers` table or Mailchimp/Brevo/Zepto list sync.

---

## 3. Governance, Elections & Onboarding

### P1 — Elections: no voter eligibility check, no secret-ballot verification

- `setElectionStatus(closed)` tallies ballots and assigns the winner, but it never checks whether voters were eligible members.
- `ballotRoll` records participation, but the relationship between `ballotRoll.memberId` and cast `ballots` is not validated.
- Quorum uses `members.homeChapterId` count, but does not filter by `status = 'active'` or lifecycle state.
- A tie returns `winner: null` but does not create a run-off election or notify officers.

### P1 — Term limits are not enforced

- `CHAPTER_TERM_LIMIT_CONSECUTIVE = 2` is defined, but `officer/governance.ts` does not check whether the winner has already served two consecutive terms in the same role.
- `chapterRoles` has `termStart`/`termEnd` but no logic prevents a third consecutive `insert`.

### P1 — Motion close has no member notification

- `closeMotion` updates status and records audit, but does not notify members who voted or the chapter at large of the result.

### P1 — Onboarding is tracked but not proactively nudged

- `computeOnboarding` derives 10 milestones, but the only enforcement is `requireOnboardingComplete` (used sparingly).
- No scheduled reminder emails at day 7, 30, 60, 90 for incomplete milestones.
- `ONBOARDING_POD_BY_DAY = 60` is documented but no alert fires when a member is unplaced after 60 days.
- Manual milestones (`ask_offer`, `three_connections`, `first_contribution`, `benefit_used`, `check_in_90`) have no UI for members to check them off and no admin UI to confirm them.

### P2 — Officer onboarding bitmask is unused

- `chapterRoles.onboardingMask` stores progress against `ROLE_ONBOARDING_STEPS`, but no router exposes reading/updating it.

---

## 4. Franchise Readiness & Org Hierarchy

### P1 — Regional/org-unit management is mostly schema, thin UI

- `orgUnits`, `unitRoles`, `councilMeetings`, `councilDecisions` tables exist.
- `officer/regional.ts` gives zone/region/country directors an overview and council tools.
- **No admin UI to create/edit org units or assign unit roles.**
- **No page to view the chapter→zone→region→country hierarchy.**
- `chapters.zoneId` links to `orgUnits`, but chapter creation/editing in the admin does not expose zone assignment consistently.

### P1 — Franchise readiness is read-only

- `api/admin/chapters.ts:142` exposes `franchiseReadiness`.
- `evaluateFranchiseReadiness` checks 7 criteria (chartered, charter date, zone, 10 members, president, treasurer, budget, cadence).
- **No workflow action is triggered when a chapter becomes ready** (no charter approval, no launch checklist, no notification to national directors).
- **No audit trail when readiness status changes.**

### P2 — Chapter status lifecycle is manual

- `CHAPTER_STATUSES` = seed, provisional, chartered, mature, at_risk.
- No automatic promotion from provisional → chartered when readiness passes.
- No automatic at-risk flag when health index drops below `HEALTH_BAR = 60`.

### P2 — Multi-chapter member experience gaps

- Members can request a chapter transfer (`chapterTransfers` table), but the member portal does not expose this.
- No concept of "visiting" another chapter or cross-chapter event registration.

---

## 5. Finance Gaps

### P1 — Expense recording exists but is not integrated with chapter budgets

- `recordExpense` and `decideBudgetLine` enforce `SPEND_APPROVAL_THRESHOLD_AED = 2000`.
- **No check that the expense is within the chapter's approved budget allocation.**
- **No budget consumption counter updated when spend is approved.**

### P1 — Refunds create credit notes but do not update revenue recognition

- `createCreditNoteFromRefund` generates a document, but the ledger/revenue report may still count the original payment.
- No accounting-period cutoff logic (accrual vs. cash).

### P1 — No dunning / failed-renewal workflow

- Renewal window opens automatically (`RENEWAL_WINDOW_DAYS = 30`), but there is no email sequence for expiring cards, failed payments, or grace-period reminders.
- `lifecycle.ts` handles `lapsed` state, but only after `RENEWAL_GRACE_DAYS` — no proactive save campaign.

### P2 — FX rates are admin-maintained but no audit trail

- `currency_rates` table is used, but changes are not logged.
- No automatic rate feed (ECB/CB UAE).

### P2 — No financial reports for regional officers

- `regionalFinanceReport` and `regionalExpenses` exist, but they are not surfaced in a dedicated UI.

---

## 6. Awards Gaps

### P1 — Awards are defined but nomination UX is unclear

- 6 categories are defined in `AWARD_CATEGORIES`.
- Admin judging endpoints exist (`admin-engage-router.ts`).
- **No member-facing page to nominate peers** (the router likely expects admin-only nominations).
- **No visibility into who has been shortlisted or won.**

### P1 — Hall of Fame rules are not automated

- Hall of Fame criteria exist in constants (`HALL_OF_FAME_MIN_CHAMPION_YEARS`, etc.).
- `awards-halloffame.test.ts` exists, suggesting logic is implemented.
- **No admin UI to review/ratify annual inductees or enforce the annual intake cap.**

### P2 — Award fairness window is not enforced at nomination time

- `AWARD_FAIRNESS_WINDOW_DAYS = 45` exists, but the nomination endpoint does not appear to block recent winners from being nominated again.

---

## 7. Notifications & Email Coverage

### P1 — Many critical events are silent

| Workflow                   | Notified?                  | Gap                                 |
| -------------------------- | -------------------------- | ----------------------------------- |
| Lead captured              | Yes (owner + confirmation) | OK                                  |
| Booking requested          | Yes                        | OK                                  |
| Booking confirmed          | Only if `confirmed: true`  | No admin path to confirm            |
| Scorecard submitted        | Yes                        | OK                                  |
| Scorecard follow-up        | No (manual admin only)     | Needs automated nurture sequence    |
| Membership approved        | Yes                        | OK                                  |
| Membership rejected        | **No**                     | Add rejection email                 |
| Renewal window opens       | **No**                     | Add 30/14/7-day reminders           |
| Renewal lapses             | **No**                     | Add lapse email + save campaign     |
| Motion closed              | **No**                     | Notify voters + chapter             |
| Election opened/voting     | **No**                     | Notify eligible members             |
| Election closed / winner   | Yes (winner only)          | Notify losers + non-voters?         |
| Onboarding milestone       | **No**                     | Add milestone nudges                |
| Dormancy change            | Yes                        | OK                                  |
| Award shortlist/winner     | Partial                    | No member-facing announcement email |
| Conduct case opened/closed | Yes (subject)              | OK                                  |
| KYC verified/rejected      | Yes                        | OK                                  |

### P1 — `notify()` is fire-and-forget with no delivery tracking

- `emailNotification` returns nothing; failures are swallowed.
- No `notification_deliveries` table to track email/push status, bounces, or opens.

### P2 — WhatsApp placeholder is still empty

- `public/app.js:14` `WA_NUMBER = null` and the code comments say it is pending.

---

## 8. Security & Access Control

### P0 — Session/token invalidation works but is not enforced everywhere

- `tokenVersion` invalidation exists.
- Cookies are `SameSite=Lax`, 7-day expiry.
- **No device/session list for users** to revoke individual sessions.

### P1 — Admin scopes are good, but no UI prevents scope escalation

- `hasScope` gates procedures, but the admin user-edit form likely allows any full admin to grant `*`.
- No approval workflow for creating full admins.

### P1 — Rate limiting is per-user but not per-IP for public forms

- tRPC has per-user rate limits.
- Public lead/booking endpoints may still be vulnerable to IP-level spam without a CAPTCHA/honeypot.

### P1 — File uploads not audited in this pass

- `member-docs.test.ts` and `KycCard.tsx` suggest document uploads exist; need to verify virus scanning, MIME-type validation, and storage ACLs.

### P2 — CSP is computed with nonces

- Good. Need to verify `script-src` does not allow `unsafe-inline` for third-party widgets.

---

## 9. DevOps, Observability & Data Integrity

### P1 — Logging is mostly `console.*`

- 59 `console.log/warn/error` calls across 14 files.
- No structured logger (Pino/Winston) with correlation IDs.
- No request tracing across tRPC procedures.

### P1 — MySQL migration issue was fixed but pattern remains risky

- The `ER_UPDATE_TABLE_USED` error on `org_units` self-reference was resolved by rewriting the orphan cleanup.
- **Drizzle-generated migration cleanups should be reviewed before deploy**; MySQL does not allow `UPDATE ... WHERE col IN (SELECT col FROM same_table)` without a workaround.

### P1 — Healthcheck passes but does not validate dependencies

- `/api/health` exists; verify it checks DB connectivity, mail transport, and Redis (if used) before reporting healthy.

### P2 — No metrics / alerting hooks

- No Prometheus/OpenTelemetry instrumentation.
- No Sentry/error-boundary integration visible.
- Background jobs (scheduler, dormancy, renewals) run but have no failure alerting.

### P2 — CI runs tests but deployment is manual

- `.github/workflows/ci.yml` exists.
- Railway deployment is triggered manually; no staging environment or automated smoke tests post-deploy.

---

## 10. UI/UX Gaps

### P1 — Public site visual inconsistency

- Multiple color palettes: portal uses navy/terracotta (`#16264C`, `#DA3A22`), marketing uses gold/navy (`#b8862e`, `#101d2c`), creating brand dilution.
- Hero images on consulting/circle inner pages are oversized and static; no scroll-driven motion or parallax.
- Mobile nav is functional but lacks sticky CTA and conversion nudges.

### P1 — White-on-white / contrast issues persist

- User reported "white fonts in white backgrounds in many places" — need to run Lighthouse accessibility audit and fix any contrast < 4.5:1.
- Button hover states may fail contrast checks.

### P2 — Portal navigation density

- Admin portal has many pages (AdminLeads, AdminOffers, AdminFinance, AdminChapters, AdminOrg, AdminAccess, etc.) but no clear role-based sidebar filtering.
- A `community` admin still sees finance menu items even if scope is missing.

### P2 — Empty states and loading skeletons

- Several tables show blank panes while loading; need skeleton screens and empty-state CTAs.

---

## 11. Prioritized Roadmap

### Phase 1 — Stop the bleed (this week)

1. **Delete / redirect retired pages:** Remove `business-setup.html` and `get-started.html`; implement 301 redirects in `boot.ts`; purge CSS/JS/seed/admin references.
2. **Fix public-site nav consistency** across all `.html` files.
3. **Add structured data, sitemap, robots.txt** to `boot.ts`.
4. **Verify `/api/health`** checks DB + mail + Redis.

### Phase 2 — Close core loops (next 2 weeks)

5. **Automated scorecard nurture:** Schedule `follow_up_1` (day 3) and `follow_up_2` (day 10) emails.
6. **Renewal/dunning email sequence:** 30/14/7/0/lapse emails with save-CTA.
7. **Election hardening:** Eligible-voter check, tie handling, term-limit enforcement, open/close notifications.
8. **Onboarding nudges:** Day 7/30/60/90 milestone reminders + manual milestone UI.
9. **Booking confirmation workflow:** Admin "confirm slot" action that sends `.ics` invite.

### Phase 3 — Franchise & scale (next month)

10. **Org-unit admin UI:** Create/edit zones/regions/countries, assign unit roles, view hierarchy.
11. **Franchise readiness actions:** Charter approval workflow, readiness-change audit, auto-promotion to chartered.
12. **Chapter budget enforcement:** Link expenses to approved allocations; show remaining budget.
13. **Member-facing awards:** Nomination page, shortlist/winner announcements.
14. **Notification delivery tracking:** `notification_deliveries` table + retry logic.

### Phase 4 — Polish & growth

15. **Unified public conversion UX:** Exit-intent, sticky mobile CTA, GTM/Meta CAPI, lead scoring.
16. **Design system refresh:** Single palette, consistent typography, scroll animations, optimized images.
17. **Observability:** Structured logging, Sentry, dependency healthchecks, background-job monitoring.
18. **Accessibility audit:** Lighthouse + axe, fix contrast, keyboard traps, focus management.

---

## File References Quick List

| File                                                                          | Why it matters                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `public/business-setup.html`, `public/get-started.html`                       | Still ship retired content; need removal/redirect.                      |
| `api/boot.ts:494-496,508,1088,1098`                                           | Server links and static-page allow-list still reference retired pages.  |
| `public/app.js:687-970`                                                       | Retired calculator + funnel JS.                                         |
| `public/home.css:1254,1588`                                                   | Retired wizard CSS.                                                     |
| `src/pages/admin/AdminLeads.tsx:494,606`                                      | Retired `"get-started"` lead type.                                      |
| `api/officer/governance.ts`                                                   | Elections/motions; needs voter eligibility, term limits, notifications. |
| `api/queries/onboarding.ts`                                                   | Milestone logic; needs nudges + manual UI.                              |
| `api/officer/regional.ts`                                                     | Regional overview; needs admin UI for org units.                        |
| `api/admin/chapters.ts:142`                                                   | Franchise readiness read-only.                                          |
| `api/lib/franchise-readiness.ts`                                              | Readiness criteria.                                                     |
| `api/queries/finance.ts`                                                      | Expenses/budget gap.                                                    |
| `api/admin-engage-router.ts`, `api/queries/award-*.ts`                        | Awards judging; needs member nomination UX.                             |
| `api/lib/lead-mail.ts`, `api/lib/notify-mail.ts`, `api/queries/circle.ts:151` | Email coverage gaps + no delivery tracking.                             |
| `api/middleware.ts`                                                           | Access scopes; needs escalation controls.                               |
| `api/lib/scheduler.ts`                                                        | Renewal/dormancy scheduling; needs email hooks.                         |

---

_End of audit. The next step is to confirm which Phase 1 items the team wants implemented first._
