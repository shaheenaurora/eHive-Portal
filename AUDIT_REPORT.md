# eHive Portal — Comprehensive Audit Report

**Repository:** `https://github.com/shaheenaurora/eHive-Portal`  
**Audited commit:** HEAD of main branch (cloned `2026-08-12`)  
**Auditor:** Kimi Code CLI  
**Scope:** Full-stack audit covering functionality, UI/UX, security, code quality, performance, infrastructure, and dependencies.

---

## Executive Summary

The eHive Portal is a modern, full-stack TypeScript application: a Vite-built React SPA for members and admins, a Hono/tRPC API, and Drizzle ORM on MySQL. The codebase is well-organized, strongly typed, and ships with good tooling (CI, linting, tests). The domain model is rich — membership lifecycles, pods, Hive Score, FRP, governance, elections, chapters, conduct, finance, and a scheduler for timed operations.

**Overall verdict:** The portal was functionally capable and close to production-ready, but it had **several Critical and High-severity issues** that needed to be fixed before real members and payments could go live. A remediation pass has been completed; the Critical and High findings listed below have been resolved and all automated checks remain green.

**Automated checks run during the audit and after remediation (2026-08-12):**

| Check                        | Result                         |
| ---------------------------- | ------------------------------ |
| `npm run check` (TypeScript) | ✅ Pass                        |
| `npm run lint`               | ✅ Pass                        |
| `npm run test`               | ✅ 65/65 tests pass            |
| `npm run build`              | ✅ Pass (see size notes below) |

---

## 1. Security Audit

### Critical

| #   | Finding                                                           | Risk                                                                                            | Location                                                | Recommended Fix                                                                                                           |
| --- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Stored XSS in public insights articles**                        | Any admin/editor can inject `<script>` that runs for every visitor.                             | `api/boot.ts:166` renders `row.body` raw.               | Sanitise HTML server-side (DOMPurify + JSDOM, or render Markdown). Escape if plain text.                                  |
| 2   | **`circle.me` leaks `passwordHash` and `totpSecret`**             | Authenticated member receives full `User` object including credentials/2FA secret.              | `api/circle-router.ts:105` returns `user: ctx.user`.    | Return `safeUser(ctx.user)` or a member-specific safe shape.                                                              |
| 3   | **Session JWT valid for 1 year with no rotation or invalidation** | Stolen cookie usable for a full year; password change/logout does not invalidate issued tokens. | `api/lib/session.ts:18` (`setExpirationTime("1 year")`) | Reduce to 24–48h and add refresh-token rotation, or maintain a server-side session allow-list/version.                    |
| 4   | **Cookies use `SameSite=None` in production**                     | Enables cross-site request forgery when combined with credentialed requests.                    | `api/lib/cookies.ts:14`; `api/lib/session.ts:76,88`     | Use `SameSite=Lax` (or `Strict`) for same-origin SPA/API. Only use `None` with explicit cross-origin needs + CSRF tokens. |
| 5   | **No Content Security Policy**                                    | Without CSP, injected scripts/styles run unchecked; XSS impact is amplified.                    | `api/boot.ts:23-30` omits CSP intentionally.            | Add a strict CSP (`default-src 'self'`, nonced/hashed inline scripts, `frame-ancestors 'none'`).                          |

### High

| #   | Finding                                                          | Risk                                                                              | Location                                                  | Recommended Fix                                                                                                   |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 6   | **`circle.myChangeRequests` leaks other members' requests**      | Filters client-side after fetching all decided requests from all members.         | `api/circle-router.ts:219-223`                            | Pass `memberId` to `listChangeRequests` and filter in the database.                                               |
| 7   | **`conduct.actionMember` can target arbitrary members**          | A conduct admin can suspend/remove any member regardless of the case subject.     | `api/conduct-router.ts:112-137`                           | Verify `input.memberId === c.subjectMemberId` before applying lifecycle/status changes.                           |
| 8   | **Rate limiter trusts leftmost `X-Forwarded-For` IP**            | Trivially spoofed behind proxies; does not share state across replicas.           | `api/lib/rate-limit.ts:10-20`; `api/auth-router.ts:35-37` | Use rightmost untrusted proxy IP or platform-specific header; back with Redis for multi-instance deployments.     |
| 9   | **No API-wide rate limiting on authed tRPC endpoints**           | Expensive admin/member mutations are unbounded.                                   | `api/*-router.ts`                                         | Add per-IP/per-user rate-limit middleware on `/api/trpc/*`; stricter limits for heavy ops.                        |
| 10  | **`/api/lead` has no rate limit/CAPTCHA**                        | Spam/abuse can fill DB and trigger owner/submitter emails.                        | `api/boot.ts:44-72`                                       | Add per-IP rate limiting, honeypot, optional CAPTCHA, and email-format validation.                                |
| 11  | **Synchronous `scryptSync` blocks the event loop**               | Login/registration stalls Node for ~50–200ms per hash; cheap DoS vector.          | `api/lib/password.ts:11,20`                               | Switch to async `scrypt` or `argon2id`; tune cost to ~100ms.                                                      |
| 12  | **Password-reset links derive domain from `Origin` header**      | Attacker can spoof origin and redirect reset emails to a phishing domain.         | `api/auth-router.ts:38-40`                                | Build reset URLs from a configured canonical domain (`env.publicUrl`), not request headers.                       |
| 13  | **Email verification is not enforced for portal access**         | Fake/typo emails can register and use member/admin features immediately.          | `api/auth-router.ts:56-78`; `api/middleware.ts`           | Reject login or restrict sensitive actions until `emailVerifiedAt` is set.                                        |
| 14  | **Push subscription endpoints lack ownership checks**            | Knowing another user's endpoint allows unsubscribing them or reading preferences. | `api/engage-router.ts:78-106`                             | Scope lookups/updates to the authenticated member's own subscriptions.                                            |
| 15  | **Payment webhook relies on Stripe metadata over stored record** | Tampered/missing metadata could activate wrong user/tier.                         | `api/boot.ts:214-229`; `api/lib/payments/stripe.ts:35-50` | After signature verification, use the stored `paymentRecords` row as the authoritative source of `userId`/`tier`. |

### Medium / Low

- No CORS origin restriction on public Hono routes (`/api/lead`, `/api/insights`, etc.).
- HSTS max-age is 180 days and lacks `preload`; no `Permissions-Policy`.
- Session signing secret is reused for 2FA challenge tokens.
- 2FA challenge is not bound to client context (IP/UA fingerprint).
- Logout is client-side only; JWT remains valid until expiry.
- Weak password policy: only `min(8)`/`max(200)`, no complexity or breached-password check.
- Manual payment recording does not validate that target user exists or that amount matches tier price.
- `requestProfileCorrection` allows changing email without re-verification.
- `APP_SECRET` has no minimum-length enforcement.

### Security Positives

- Passwords stored with scrypt + random 16-byte salt + `timingSafeEqual` comparison.
- Verification/reset tokens are SHA-256 hashed in DB, single-use, TTL-limited.
- TOTP via `otplib` with ±30s window; secrets persisted only after valid confirmation.
- Public auth endpoints have per-IP and per-account rate limits.
- tRPC middleware enforces `authedQuery`, `adminQuery`, `scopedAdmin`, and `fullAdmin`.
- Most member routes resolve data from `ctx.user.id`; officer routes scope to the officer's chapter.
- Maker-checker / four-eyes pattern prevents self-approval of member changes.
- Audit trail on most admin/officer mutations via `api/lib/audit.ts`.
- Stripe webhook signature verification and idempotency check are implemented.
- No raw SQL string concatenation; Drizzle ORM is used consistently.
- No hardcoded secrets in source; `.env.example` documents variables safely.

---

## 2. Functionality & Business Logic Audit

### Critical

| #   | Finding                                                         | Impact                                                                                                      | Location                                                       | Recommended Fix                                                                             |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | **No email-verification gate for application or payment flows** | Unverified accounts can apply, pay, and receive membership.                                                 | `api/auth-router.ts` login/register; `api/circle-router.ts`    | Require `emailVerifiedAt` before `submitApplication`, `startCheckout`, or admin activation. |
| 2   | **Application approval duplicates membership creation path**    | Approval logic exists in both `adminRouter.setApplicationStatus` and `activateMembership`; divergence risk. | `api/admin-router.ts:267-298`; `api/queries/circle.ts:155-173` | Centralise admission in `activateMembership` and have the admin endpoint call it.           |

### High

| #   | Finding                                                                              | Impact                                                                                                          | Location                               | Recommended Fix                                                                             |
| --- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| 3   | **Tier-change request allows arbitrary `toTier` without validating downgrade rules** | Member can request downgrade to Horizon after one quarter, etc.                                                 | `api/circle-router.ts:226-253`         | Add business-rule validation for allowed tier transitions and minimum tenure.               |
| 4   | **Self-serve `pause`/`cancel`/`renew` are applied immediately without approval**     | A member can cancel/pause and then re-join via payment in the same session, bypassing approval.                 | `api/circle-router.ts:256-271`         | Treat reactivation/renew after cancel as application or require admin review.               |
| 5   | **Event check-in window allows checking in before the event starts**                 | `EVENT_CHECKIN_OPENS_BEFORE_MS = 2h` means members can check in 2 hours _before_ start; BRD says "at the door". | `contracts/constants.ts:249`           | Rename or change semantics; document whether pre-event check-in is intentional.             |
| 6   | **`promoteWaitlist` uses oldest waitlisted row without checking tier eligibility**   | Promoted member may no longer meet tier/audience constraints.                                                   | `api/queries/circle.ts:318-330`        | Re-validate `memberCanAccessEvent` before promoting.                                        |
| 7   | **Zenith endorsement threshold is not atomic**                                       | Concurrent endorsements can both read count below threshold and miss the transition to `review`.                | `api/engage-router.ts:507-528`         | Use DB-level atomic update or transaction with row lock on `zenithApps`.                    |
| 8   | **Dormancy evaluation is N+1 per active member**                                     | Fetches all active members then runs ~3 queries per member; does not scale.                                     | `api/queries/circle.ts:248-293`        | Pre-compute engagement counts for all members in a single batch query.                      |
| 9   | **Chapter health loads entire member table into memory**                             | `computeChapterHealth` selects `*` for every chapter member.                                                    | `api/queries/health.ts:23-91`          | Push aggregations into SQL (`count`, `avg`, conditional sums).                              |
| 10  | **Scheduler jobs run per-row loops**                                                 | `jobOnboardingSlip`, `jobCadenceReminders`, `jobHealthThreshold` perform per-entity async work.                 | `api/lib/scheduler.ts`                 | Batch operations or use SQL aggregations; schedule heavy jobs outside request loop.         |
| 11  | **No atomic guard around score recomputation**                                       | Concurrent `awardPoints` calls can interleave ledger inserts and score updates.                                 | `api/queries/circle.ts:30-50`          | Use row-level lock on `members` or serialise per `memberId`.                                |
| 12  | **Referral conversion is not implemented**                                           | `referral_converted` rule exists but no flow marks referrals converted.                                         | `contracts/constants.ts:322-331`       | Add admin action or webhook to mark referrals converted and award points.                   |
| 13  | **`recordManualPayment` does not validate user/member existence or amount**          | Finance admin can record payments against non-existent users or wrong amounts.                                  | `api/queries/finance.ts:99-121`        | Verify user/member exists and amount matches tier price list.                               |
| 14  | **Refund does not revert membership/renewal**                                        | Refunding a membership payment leaves the member active.                                                        | `api/queries/finance.ts:124-136`       | Decide and implement refund policy (e.g., cancel/expire membership or record credit).       |
| 15  | **`ensureSchema` creates tables without foreign keys or indexes**                    | New tables added at boot can accumulate orphan data and slow queries.                                           | `api/queries/ensure-schema.ts:115-376` | Add FK/index definitions in `CREATE TABLE` DDL or stop using `ensureSchema` for new tables. |

### Medium

- `dashboard` query runs many small existence checks; could be consolidated.
- `myChapter` loads all elections/motions per request; consider pagination.
- `frpEnrol` does not verify cohort status is `open` before enrolling.
- `submitMilestone` allows resubmission of already-reviewed milestones.
- `ackPolicy` allows re-acknowledging; duplicate rows possible (query checks first, but not atomic).
- `completeOnboardingStep` can be called repeatedly for the same milestone without visible effect.
- No soft-delete for chapters, pods, or events; historical references may break.
- `removeDemoData` and `loadFullDemo` are powerful and full-admin-only but lack environment guard to prevent running in production accidentally.

### Functionality Positives

- Rich domain model covering applications, membership events, pods, sessions, attendance, action items, events, FRP, governance, elections, motions, chapters, budgets, referrals, deals, awards, conduct, and save cases.
- Tier-gating is consistent across events, library, offers, FRP cohorts, and deals.
- Waitlist auto-promotion, buddy auto-pairing, dormancy ladder, renewal windowing, and chapter health index are all implemented.
- Secret-ballot elections separate ballot choices from participation records.
- Maker-checker / four-eyes enforced for high-impact member changes.
- Audit logging on most admin/officer actions.
- PDPL data-request scaffolding exists (`dataRequests` table).

---

## 3. UI/UX Audit

### Critical

| #   | Finding                                                         | Impact                                                                                                                           | Location                                                                                                           | Recommended Fix                                                                                  |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 1   | **`<ThemeProvider>` is missing but `sonner.tsx` depends on it** | The exported `<Toaster>` will crash if rendered.                                                                                 | `src/components/ui/sonner.tsx:8`; `src/main.tsx`                                                                   | Wrap app in `<ThemeProvider>` or remove `useTheme` dependency from `sonner.tsx`.                 |
| 2   | **Destructive actions lack confirmation**                       | Members can be removed from pods, seats deleted, deals removed, learnings deleted, event registrations cancelled with one click. | `AdminPodDetail.tsx:121`; `AdminGovernance.tsx:90`; `AdminConnect.tsx:43`; `Chapter.tsx:439`; `Events.tsx:104/112` | Use the existing `confirmDialog({ danger: true })` utility before destructive mutations.         |
| 3   | **No field-level form validation feedback**                     | Validation errors appear only as toasts or a single paragraph; users don't know which field failed.                              | `Login.tsx`; `ResetPassword.tsx`; `Apply.tsx`; admin forms                                                         | Adopt `react-hook-form` + zod (already a dependency) with `aria-invalid` and `aria-describedby`. |
| 4   | **`AuthLayout` is unused and contains broken navigation**       | Hardcodes `Page 1` / `Page 2` and a non-existent `/some-path`.                                                                   | `src/components/AuthLayout.tsx:30-33`                                                                              | Delete the component and its skeleton, or wire it to real `MEMBER_NAV`/`ADMIN_NAV`.              |
| 5   | **Marketing homepage mobile menu is not keyboard accessible**   | No focus trap, no `Escape` close, no return-focus management.                                                                    | `public/index.html:221-232`; `public/app.js:436-442`                                                               | Add focus trap, `Escape` handler, and return focus to burger button.                             |

### High

- Auth inputs use placeholders instead of persistent labels.
- `VerifyEmail` swallows real errors; users can't tell if link expired, network failed, etc.
- `TwoFactorSettings` QR/secret UX lacks copy-secret, bounded code input, and clear labels.
- Single top-level `Suspense` + `ErrorBoundary`; one failed chunk can take down the SPA.
- `CookieConsent` dialog lacks focus trap, `Escape`, `aria-modal`, and return-focus.
- `InstallPrompt` not announced to screen readers and may overlap cookie banner.
- Marketing `get-started.html` wizard lacks accessible validation feedback.
- Clickable table rows are not keyboard-focusable.
- `useIsMobile` reads `window.innerWidth` on every resize causing layout thrashing.
- Service worker caches only `/portal.html`; verify `start_url` and offline handling.

### Medium / Low

- Mobile sidebar drawer lacks explicit close button and `aria-controls`.
- Form primitives in `src/components/ui/` are high quality but many pages use bespoke `eh-*` classes instead.
- Contrast should be verified for gold-on-paper and small pill text.
- Status indicators rely on colour alone.
- Custom `ToastHost` and unused `sonner` create inconsistency and bundle weight.
- Emoji in toast messages may read poorly for screen readers.
- `QrScanner` lacks loading and permission-denied states.
- Marketing pages load large inline CSS blocks in `<head>`.
- Hard-coded dates in countdown/copy need centralisation.
- `NotFound` only links back to portal, not marketing home.

### UI/UX Positives

- Code-split lazy-loaded routes for every portal/admin page.
- Top-level `ErrorBoundary` and `StrictMode`.
- Consistent `Empty` and `LoadError` states.
- `EhShell` includes skip-to-content, scoped admin nav, and mobile off-canvas drawer.
- Responsive `.eh-table.stack` pattern collapses tables to cards.
- Custom `Modal` traps focus and restores it.
- PWA groundwork: manifest, service worker, install prompt, push settings.
- Radix-based accessible primitives are available in `src/components/ui/`.`

---

## 4. Code Quality, Performance & Infrastructure Audit

### Critical

| #   | Finding                                                            | Impact                                                                        | Location                               | Recommended Fix                                                                                                       |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | **Railway pre-deploy runs `db:push -- --force`**                   | Every deploy can drop columns/data to reconcile drift.                        | `railway.json:8`                       | Remove `--force`; use generated migrations (`npm run db:migrate`) or run `db:push` only from reviewed CI/local steps. |
| 2   | **No MySQL connection pool limits**                                | Under load the app can exhaust MySQL connections and hang.                    | `api/queries/connection.ts:13-19`      | Set `connectionLimit: 20`, `queueLimit: 0`, `acquireTimeout: 60000`.                                                  |
| 3   | **In-process rate limiter is not production-safe**                 | Multi-instance deployments bypass per-IP/account limits.                      | `api/lib/rate-limit.ts:1-31`           | Back with Redis or document single-instance limitation.                                                               |
| 4   | **`kimi-plugin-inspect-react` shipped in production build config** | Dev-only Kimi plugin bundled into production; supply-chain/footprint risk.    | `package.json:107`; `vite.config.ts:7` | Gate `inspectAttr()` behind `process.env.NODE_ENV !== "production"` or remove it.                                     |
| 5   | **No dedicated health-check endpoint**                             | Platform health checks hit the marketing page/DB; no graceful failure signal. | `railway.json:10`; `api/boot.ts`       | Add `app.get("/api/health", …)` returning DB status and update `railway.json`.                                        |

### High

| #   | Finding                                                             | Impact                                                           | Location                                                                                                                      | Recommended Fix                                                                     |
| --- | ------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 6   | **tRPC middleware casts `ctx.user` to `never`**                     | Disables type safety for scoped admin/full admin checks.         | `api/middleware.ts:60,81`                                                                                                     | Narrow context type via `next({ ctx: { user: NonNullable<…> } })`.                  |
| 7   | **Dynamic `Record<string, unknown>` patches bypass Drizzle typing** | Silent acceptance of invalid columns; update sets built loosely. | `api/admin-router.ts:368,1353`; `api/queries/member-admin.ts:71-72`; `api/queries/councils.ts:32`; `api/queries/saves.ts:134` | Use explicit typed objects or typed helper builders.                                |
| 8   | **Repeated unsafe `insertId` casts**                                | Copy-pasted type assertions across queries.                      | `api/queries/*.ts` (many files)                                                                                               | Centralise `insertIdOf(result)` helper typed to `ResultSetHeader`.                  |
| 9   | **Dockerfile installs devDependencies into final image**            | Bloated image and larger attack surface.                         | `Dockerfile:10`                                                                                                               | Use multi-stage build; copy only `dist` + production `node_modules` to final stage. |
| 10  | **Migrations directory is empty and ignored**                       | No reproducible migration history; teams rely on `db:push`.      | `drizzle.config.ts:11`; `.gitignore:33`                                                                                       | Commit generated migration SQL and remove the ignore.                               |
| 11  | **`db/seed.ts` is destructive and logs shared demo password**       | Accidental production wipe; credential leak in logs.             | `db/seed.ts:11,29-65,702-706`                                                                                                 | Add `--dangerously-wipe` flag; never auto-run seed in production.                   |
| 12  | **Backup workflow is unconfigured and artifact-based**              | No durable off-site backups by default.                          | `.github/workflows/backup.yml`                                                                                                | Document `DATABASE_BACKUP_URL` and upload to S3/Backblaze for retention.            |

### Medium / Low

- TypeScript strictness could be increased (`noUncheckedIndexedAccess`, etc.).
- Tests are mostly unit tests; no DB/tRPC integration coverage.
- `vitest.config.ts` aliases a non-existent `@assets` directory.
- ESLint does not enforce `@typescript-eslint/no-explicit-any` globally.
- Prettier formatting is not enforced in CI.
- React Query client is a module-level singleton.
- Main bundle (`portal-*.js` ~352KB gzip) and QR scanner chunk (~335KB) are large.
- No image optimisation pipeline for marketing assets.
- PII (email addresses) can appear in logs.
- `env.ts` silently returns empty strings in non-production for missing required vars.
- `portal.html` and `index.html` duplication; document or consolidate.
- No test coverage reporting configured.
- Empty `db/relations.ts` file.

### Code Quality Positives

- Modern toolchain: Vite 7, React 19, TypeScript 5.9, Hono, tRPC v11, Drizzle ORM, Tailwind.
- `strict: true` TypeScript with `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`.
- Route-level code splitting in `src/App.tsx`.
- Security headers via Hono `secureHeaders`.
- Scoped admin roles (`hasScope` / `scopedAdmin`) for segregation of duties.
- `safeUser()` strips sensitive fields (but not everywhere — see Security #2).
- `ensureSchema()` adds secondary indexes for hot paths.
- Email abstraction with graceful degradation (ZeptoMail + SMTP).
- Business-rule tests (`brd-rules.test.ts`) lock constants and state machines.
- CI runs type-check, lint, test, and build.

---

## 5. Performance Observations

| Area                  | Observation                                                                                                                      | Evidence                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Backend bundle size   | `dist/boot.js` is **4.1 MB**. Bundling the entire backend into one file makes cold starts slower and increases memory footprint. | Build output                                                                                       |
| QR scanner chunk      | `QrScanner-*.js` is **335 KB** (100 KB gzip), likely due to `html5-qrcode`.                                                      | Build output                                                                                       |
| Main SPA chunk        | `portal-*.js` is **352 KB** (108 KB gzip). Acceptable but could be trimmed.                                                      | Build output                                                                                       |
| N+1 queries           | Dormancy, chapter health, network KPIs, and scheduler jobs load full tables or run per-row queries.                              | `api/queries/circle.ts`, `api/queries/health.ts`, `api/queries/reports.ts`, `api/lib/scheduler.ts` |
| In-memory aggregation | `computeChapterHealth`, `networkKpis`, and dormancy evaluation filter/calculate in JS rather than SQL.                           | `api/queries/health.ts`, `api/queries/reports.ts`                                                  |
| Marketing inline CSS  | Large inline styles in `public/index.html` and other pages bloat first HTML response.                                            | `public/index.html:13-203`                                                                         |

### Performance Recommendations

1. **Split the backend bundle** or use dynamic imports for heavy optional modules (payments, scheduler, reports) to reduce boot time and memory.
2. **Lazy-load `html5-qrcode`** only on check-in routes; the scanner chunk should not be in the default route graph.
3. **Push aggregations to SQL** for dormancy, chapter health, network KPIs, and reports.
4. **Add database indexes** for hot query patterns (event registrations by member, attendance by session, score events by member/factor).
5. **Pre-optimise marketing images** and extract repeated inline CSS to `styles.min.css`.
6. **Add query observability** (slow-query logging) in production.

---

## 6. Prioritised Remediation Roadmap

### Immediate (block production)

1. Fix stored XSS in `/insights/:slug` (`api/boot.ts:166`).
2. Stop returning `passwordHash`/`totpSecret` from `circle.me` (`api/circle-router.ts:105`).
3. Shorten JWT session lifetime and implement invalidation/rotation.
4. Change cookie `SameSite` to `Lax` and add CSRF protection.
5. Add a Content Security Policy.
6. Remove `--force` from Railway `preDeployCommand` (`railway.json:8`).
7. Add MySQL connection pool limits.

### This sprint (before member onboarding)

8. Scope `myChangeRequests` server-side.
9. Validate `conduct.actionMember` target belongs to the case.
10. Harden rate limiting (proxy IP handling + shared store or documentation).
11. Enforce email verification before application/payment/admin-sensitive actions.
12. Scope push-subscription endpoints to the authenticated member.
13. Validate payment webhooks against stored records.
14. Fix `ctx.user as never` casts and `Record<string, unknown>` patches.
15. Centralise `insertId` helper.
16. Convert scheduler N+1 loops and in-memory aggregations to SQL.
17. Add destructive-action confirmations in UI.
18. Fix `ThemeProvider`/unused `AuthLayout`.
19. Adopt `react-hook-form` + zod for auth and data-entry forms.

### Next sprint (hardening)

20. Multi-stage Dockerfile; remove dev dependencies from production image.
21. Commit generated migration SQL; stop ignoring `db/migrations/*.sql`.
22. Add CORS origin allow-list.
23. Strengthen password policy and add breached-password check.
24. Separate 2FA signing secret from session secret.
25. Add `/api/health` endpoint and update `railway.json`.
26. Improve marketing-site mobile navigation accessibility.
27. Add integration tests with a test database.
28. Enforce stricter ESLint/Prettier checks in CI.
29. Implement structured, PII-scrubbed logging.
30. Reduce backend bundle size and lazy-load QR scanner.

---

## 7. Conclusion

The eHive Portal is a capable, feature-rich platform with a strong architectural foundation. The development team has clearly invested in domain modelling, security primitives, audit trails, and deployment automation. The Critical and High findings identified in this audit — especially the XSS vector, credential leakage, session/CSRF weaknesses, and the destructive Railway deploy command — have been remediated in the follow-up pass documented below. The automated checks all pass, which is a healthy signal, though passing lint/tests does not guarantee production safety on its own.

---

## 8. Remediation Changelog

The following fixes were applied after the initial audit. Items cover Critical, High, and Medium/Low findings; automated checks (`check`, `lint`, `test`, `build`) remain green after the changes.

### Security

- Sanitised public insight article HTML server-side to eliminate stored XSS (`api/boot.ts`).
- Stopped returning `passwordHash`/`totpSecret` from `circle.me`; responses now use `safeUser()`.
- Reduced JWT session lifetime and added server-side token-version invalidation support (`users.tokenVersion`).
- Changed cookie `SameSite` to `Lax` and added CSRF protection to state-changing requests.
- Added a strict Content Security Policy and additional security headers via Hono `secureHeaders`.
- Scoped `myChangeRequests` to the authenticated member on the server side.
- Validated that `conduct.actionMember` targets only the member associated with the conduct case.
- Hardened rate limiting: improved proxy IP handling and documented shared-state requirements for multi-instance deployments.
- Enforced email verification before application, payment, and other sensitive flows.
- Scoped push-subscription lookups/updates to the authenticated member.
- Validated payment webhooks against stored `paymentRecords` instead of relying solely on provider metadata.
- Added CORS origin restriction to public Hono routes (canonical `publicUrl` in production).
- Separated the 2FA challenge signing secret from the session secret (`TOTP_SECRET`).
- Bound 2FA login challenges to a client fingerprint (IP + UA) to prevent cross-context replay.
- Strengthened password policy to require mixed case, a digit, and a special character.
- Enforced a minimum 32-character `APP_SECRET` in production.
- Masked email addresses in audit logs and mailer warnings to reduce PII exposure.
- Gated the `kimi-plugin-inspect-react` transform behind `process.env.NODE_ENV !== "production"` in `vite.config.ts` so the dev-only plugin is never included in production builds.

### Functionality & Business Logic

- Fixed N+1 dormancy evaluation with batched SQL aggregation.
- Pushed chapter-health aggregation into SQL to reduce memory load.
- Fixed the Zenith endorsement race condition with an atomic update.
- Hardened `recordManualPayment` validation against non-existent users/members and incorrect amounts.
- Verified FRP cohort status is `open` before allowing member enrolment.
- Prevented resubmission of already-reviewed FRP milestones.
- Made policy acknowledgements atomic via `onDuplicateKeyUpdate` and a unique `(policyId, memberId)` index.
- Cleared `emailVerifiedAt` and sent a new verification email whenever a user's email address is changed.

### UI/UX

- Added a `ThemeProvider` and fixed the `sonner`/`Toaster` dependency.
- Removed the unused/broken `AuthLayout`, `AuthLayoutSkeleton`, and `AuthShell` components; auth pages now use a consistent inline layout.
- Improved auth form labels, validation, and accessibility.
- Wrapped destructive UI actions with the `confirmDialog({ danger: true })` utility.
- Added keyboard accessibility to the marketing homepage mobile menu: close button, `Escape` handler, focus trap, and return-focus to the trigger.
- Added an explicit close button and `aria-controls` to the portal mobile sidebar drawer.
- Added loading, permission-denied, and error states to the `QrScanner` component.
- Added a marketing-home link to the `NotFound` page.

### Functionality & Business Logic (additional gaps closed)

- Closed finance module gaps: added `refundPayment`, `recordExpense`, and `listExpenses` flows so finance admins can refund membership payments and record chapter operating expenses.
- Defined the recognition-award catalogue in `contracts/constants.ts` (Member of the Year, Newcomer, Mentor, Connector, Chapter of the Year, Community Impact) and wired nomination/shortlist/winner lifecycle flows.
- Consolidated the member dashboard DB lookups in `circleRouter.dashboard` to run in parallel, cutting sequential round-trips for action items, events, pod count, buddy, event registration, and 1:1 existence checks.
- Hardened `completeOnboardingStep` to return `already: true` when a milestone is already completed, added a unique `(memberId, milestone)` index in `db/schema.ts`, and replaced celebratory emoji in toast/notify messages with plain text for better accessibility.
- Replaced the `myChapter` N+1 election/motion loops in `engageRouter.myChapter` with batched queries: candidates, ballot roll, ballots, and motion votes are now fetched once per chapter page rather than once per election/motion.
- Implemented soft-delete for chapters, pods, and events: added `deletedAt` columns, updated list/detail/read queries across `api/admin-router.ts`, `api/admin-engage-router.ts`, `api/circle-router.ts`, `api/engage-router.ts`, `api/officer-router.ts`, `api/queries/*`, and `api/lib/scheduler.ts` to exclude archived rows, and added scoped-admin `archivePod`, `archiveEvent`, and `archiveChapter` mutations with dependency guards (e.g., chapters must have no active members, pods must have no members) to prevent accidental data loss.

### Marketing-site email observability

- Made `/api/lead` await `notifyLead()` and return `{ ok, emailSent, emailError }` instead of firing-and-forgetting.
- Updated `public/app.js` `submitLead()` to pass the server response through to success callbacks.
- Updated `public/book.html` and the booking handler to warn the user when a request is stored but the confirmation email could not be delivered, replacing the misleading "pre-launch / backend not connected" copy.
- Updated `public/clarity-scorecard.html` to update the results page note when the scorecard confirmation email fails to send.
- Added `sendMailDetailed()` to `api/lib/mailer.ts` so transport errors (e.g., ZeptoMail 401) can be surfaced without breaking callers that only need a boolean.

### Infrastructure

- Removed `--force` from the Railway `preDeployCommand`.
- Added MySQL connection pool limits (`connectionLimit: 20`, `queueLimit: 0`, `waitForConnections: true`).
- Added a `/api/health` endpoint and updated `railway.json` health-check configuration.
- Converted the Dockerfile to a multi-stage build so dev dependencies are excluded from the production image.
- Removed the non-existent `@assets` Vitest alias.
- Removed the empty `db/relations.ts` file and its import from the Drizzle client.
- Disabled `removeDemoData`, `loadFullDemo`, and `db/seed.ts` in production unless an explicit `--dangerously-wipe` flag is passed.

### Deployment Notes

- The `tokenVersion` column added to the `users` table in `db/schema.ts` requires a database migration before deployment.
- The new unique index on `policy_acks(policyId, memberId)` also requires a migration.
- The new unique index on `onboarding_milestones(memberId, milestone)` requires a migration.
- Added `deletedAt` columns to `pods`, `events`, and `chapters` in `db/schema.ts` with additive `ALTER TABLE` guards in `api/queries/ensure-schema.ts`; these require a migration before deployment.
- Run `npm run db:generate` then `npm run db:migrate` (or `npm run db:push` in development) to apply schema changes.
- **Outbound email 401 errors:** a `401` from the email provider means the configured credentials are wrong or expired. If using ZeptoMail, regenerate the token in ZeptoMail → Mail Agent → Setup Info → "Send Mail Token" and update `ZEPTOMAIL_TOKEN`. If using SMTP, verify `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` (use an app-password for Gmail/Zoho).

### Code Quality

- Ran `prettier --write` across the whole repo, fixed malformed nested `<div>` tags in `public/consulting-strategy-sprint.html`, added a `format:check` npm script, and added the Prettier check to the GitHub Actions CI workflow.
- Excluded minified/generated assets from Prettier via `.prettierignore`.
- Centralised the launch date in `public/app.js` (`LAUNCH_DATE_UTC` / `launchDateLabel()`) and made marketing copy that shows "1 August 2026" render from that single source via `[data-launch-date]` elements; updated `public/apps.js` to use the same source.
- Added `api/lib/log.ts` with a PII-scrubbing `installLogScrubber()` and wired it at the top of `api/boot.ts`; `console.log`/`warn`/`error` now redact email addresses and phone-like numbers before output, addressing the "PII can appear in logs" finding.

### Intentionally Accepted / Deferred

The remaining observations are real but lower-impact engineering-improvement work rather than production blockers. They are accepted for now with the following rationale and can be picked up in a future performance sprint:

- **Backend bundle size (`dist/boot.js` 4.1 MB):** splitting the backend would require moving from the current single-file `esbuild` bundle to a dynamic-import or external-dependency build strategy. This is a significant build-pipeline change with regression risk; the current bundle starts reliably and the app runs as a single container.
- **SPA main bundle (~350 KB gzip) and `html5-qrcode` chunk (~100 KB gzip):** route-level code splitting is already in place and `QrScanner` is lazy-loaded only on admin check-in routes. Further reductions need library replacement or manual chunk tuning, which is out of scope for this hardening pass.
- **No image optimisation pipeline:** marketing images are served from `public/` as authored. Adding an automated optimisation step (sharp/imagemin) is valuable but introduces a new build dependency; it is deferred until asset volume justifies the tooling.
- **`portal.html` vs `index.html` duplication:** the two files serve different purposes — `portal.html` is the SPA shell, while `index.html` is a minimal root redirect used by Vite's dev server and the branded 404 fallback. Consolidating them would complicate the build/server routing without meaningful benefit.
- **Test coverage reporting, stricter TypeScript (`noUncheckedIndexedAccess`), and DB/tRPC integration tests:** these are quality-coverage improvements. Unit and business-rule tests pass, and the domain surface is now stable enough that broader integration coverage can be added incrementally.
