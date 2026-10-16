# eHive Circle — Launch-Readiness Gap Analysis

**Date:** 2026-10-14 · **Codebase:** `eHive-Portal-clone` @ `f144ec0` (2026-09-23) · **Reference:** Next.js prototype `ehive-portal` (assessed for build-vs-rewrite)
**Launch bar:** public **paid** launch — real paying members, Stripe live, transactional email delivering, security hardened, legal pages present, deploy/backup pipeline proven.
**Method:** 8 parallel investigators — prior-audit reconciliation (GAP_ANALYSIS, AUDIT_REPORT + REAUDIT, DEEP_AUDIT 08-30 → 09-13 V4, UX_AUDIT, FOLLOW_UP), feature completeness, security, payments/integrations, infra/deploy, quality gates (run, not read), marketing/legal, and Next.js-rewrite tracking. Every finding below was verified against current code (file:line cited).

---

## RESOLUTION UPDATE — 2026-10-17 (code pushed through `74f799a`)

The code-level findings below are now **fixed and pushed to GitHub main** across three commits (`562a223`, `afdcc67`, `74f799a`). All gates green on each: tsc 0 errors, 278/278 tests (up from 247), eslint 0 errors, build + Docker CI passing.

| Finding | Status |
|---|---|
| B4 URL split-brain | HTML canonicals/OG now `www.ehiveglobal.com`; **setting `PUBLIC_URL` on Railway remains an env task** |
| B6 Stripe config validation | ✅ boot refuses to start in production with key-but-no-webhook-secret or `sk_test_`; `/api/health` reports payments state |
| B7 Reconciler entitlement gap | ✅ shared `fulfillPayment()` used by webhook + reconciler (invoices, renewals, upgrades, activation, tickets, emails; failures marked failed) |
| B8 Demo-data pollution risk | ✅ load-demo disabled in production unless `ALLOW_DEMO_DATA=true`; remove-demo always available; DEPLOY.md demo content moved to local-only section |
| H2 Duplicate checkout charges | ✅ pending-conflict guards on all 5 checkout flows + Stripe idempotency keys |
| H3 KYC plaintext IDs | ✅ AES-256-GCM sealed at rest (migration 0034), legacy read fallback, PDPL exports decrypt |
| H5 Money/auth test coverage | ✅ 31 new tests (payments-fulfill ×8, auth-session ×12, kyc/pdpl ×11) |
| H6 DEPLOY.md drift | ✅ migrations-first runbook, PUBLIC_URL requirement, join/pay modes documented with source-of-truth constants, stale backlog cleared |
| Marketing design | ✅ self-hosted Space Grotesk/Manrope, aurora/hex art, expo-easing motion, count-up stats, featured pricing tile, journal empty state |
| Portal bugs (15 verified) | ✅ checkout-return confirmations, stale invalidations, FRP race, sold-out button, bell mark-read-on-close, admin nav/selection/focus fixes |
| Portal design/perf | ✅ AA contrast, single accent, `.eh-h2` defined, self-hosted fonts, admin nav gated by default, global document titles, skeleton/EhCrumbs components, gzip compression, immutable asset caching, staleTime 45s, bell 120s, vendor chunks, 43 dead components + 28 deps removed (−7.3k lines) |
| PWA | ✅ installable portal: manifest (maskable), app-shell offline, cache-first assets, install prompt, SW verified in headless Chromium |

**Still open (owner/env tasks, unchanged):** B1/B2/B3 legal pages · B5 backups (`DATABASE_BACKUP_URL`, Railway snapshots, restore rehearsal) · §0 launch-model decision · env vars on Railway (`PUBLIC_URL` first) · Stripe dashboard live-key + webhook registration + live-card test · ZeptoMail/Zoho sender verification · prod never demo-seeded (verify) · H1 analytics · H4 mail-failure surfacing · H8 portal support channel · H9 apply-funnel bridge.
**New follow-up backlog from portal audits:** wire `LoadError` into the ~24 pages still missing error states · wire `EhCrumbs` into detail pages · wire skeletons into the full-page-spinner pages · replace remaining `#b8862e`/Georgia literals in page files · optional QrScanner swap to BarcodeDetector · superjson re-render churn (`notifyOnChangeProps`) · server-bundle split (5.7MB boot.js).


---

## Verdict

**The platform is genuinely close — closer than any prior audit suggests — but it is not launch-ready for a paid public launch.** All six quality gates pass today (tsc 0 errors, 247/247 vitest, build, eslint, prettier, CI). Every README feature claim maps to real, working code; there are no stubs, no mocked screens, no dead nav. Security and the Stripe webhook core are unusually solid. Prior audits' fixes were verified in code (V4's "open" list is ~80% already fixed in later commits).

What remains is a short list of **launch-defining gaps**, most of which are *operational/config decisions and missing launch artifacts*, not missing code — plus **one launch-model decision only the owner can make** (finding 0).

**Estimated effort to launch-ready: ~1–2 weeks**, dominated by legal copy, domain/email setup, backup enablement + restore rehearsal, Stripe live verification, and a payments-reconciliation fix. See the pre-launch checklist at the end.

---

## 0. Launch-model decision required first (owner)

**Self-serve paid join is unreachable at current config — DEPLOY.md contradicts the code, and approval grants membership with zero payment.**

- `contracts/constants.ts:83` — `SELF_SERVE_TIERS = ["vanguard"]`; `contracts/constants.ts:90` — `VANGUARD_FOUNDING_APPLICATION_ONLY = true` → `startCheckout` throws for the only self-serve tier (`api/circle-router.ts:163-168`).
- Admin approval creates an **active** member with a 1-year `renewalAt` and **no payment record, invoice, or payment-request email** (`api/admin/membership.ts:158-208`). Manual payment capture (`api/admin/finance.ts:517`) is the only way money follows admission.
- `DEPLOY.md:27,138-149` promises "self-serve online join & pay for the Horizon/Ascent/Vanguard tiers" — none of that exists.

**Decide:** (a) founding cohort by application with manual invoicing — then fix DEPLOY.md and make approval trigger a payment request + dunning; or (b) self-serve paid join — then flip `SELF_SERVE_TIERS` / the founding flag and test the full pay-to-active loop. Either is legitimate; the current state satisfies neither the "paid" launch bar nor its own runbook.

---

## 1. BLOCKERS — must be resolved before taking money

| # | Gap | Evidence | Fix |
|---|-----|----------|-----|
| B1 | **Terms of Service is a placeholder.** "Full terms at launch — 1 October 2026" (date passed); no liability, governing law, cancellation/refund, or conduct terms | `public/terms.html:136-145` | Publish full ToS (in-code `COPY-NEEDED: terms-body` marker names the sections) |
| B2 | **Privacy policy is a placeholder** — no retention, no processor list (Stripe/ZeptoMail/push are in use), no data-rights procedure, while forms claim PDPL compliance | `public/privacy.html:139-148` vs `contact.html:280` | Publish PDPL-grade policy: processors, retention, rights process, DPO/contact |
| B3 | **No refund/cancellation policy anywhere** — backend refund machinery exists (event auto-refunds, grace windows), but nothing member-facing | no page exists; only a promise inside the placeholder ToS | Publish refund/cancellation policy; link from footer + checkout/membership flows |
| B4 | **Split-brain URLs: the custom domain is live, but production still runs on the fallback infra URL** — `ehiveglobal.com` IS registered and already serving the app (verified live 2026-10-14: GoDaddy NS, Zoho MX, `www.ehiveglobal.com/circle.html` and `/api/health` both 200), yet `PUBLIC_URL` is unset in production: the live robots.txt and sitemap.xml emit `https://ehive-portal-production.up.railway.app`, so password-reset/verify links, Stripe checkout return URLs, and the CORS allowlist all point at the infra host, and the static pages hardcode the same URL in canonical/OG/JSON-LD. A member who pays via the custom domain gets returned to the railway.app host, where they hold no session cookie. The "ehiveglobal.com is unregistered" comment in `env.ts:69` is stale | live sitemap/robots on `www.ehiveglobal.com`; `api/lib/env.ts:66-74`, `api/boot.ts:236`; `public/*.html` | Set `PUBLIC_URL=https://www.ehiveglobal.com` on Railway; replace hardcoded canonicals/OG URLs in `public/*.html`; fix the stale `env.ts` comment; verify the ZeptoMail/Zoho sender for the domain |
| B5 | **Only backup is inert; restore never rehearsed.** Workflow self-disables without a secret, dump is a 90-day GitHub artifact (full PII + password hashes, unencrypted), Railway snapshots unconfirmed | `.github/workflows/backup.yml:6-31,54-60`, `docs/DISASTER-RECOVERY.md:15-22,70-75` | Set `DATABASE_BACKUP_URL` + upload to S3/R2 **encrypted**; enable Railway snapshots; perform and record one scratch restore (RTO) |
| B6 | **Stripe config never validated — silent money-taking failure mode.** `paymentsEnabled()` checks only the secret key; `STRIPE_WEBHOOK_SECRET` defaults to `""`; no `sk_test_` guard in production; `/api/health` doesn't report payments | `api/lib/payments/index.ts:8-10`, `api/lib/env.ts:50`, `api/boot.ts:1114-1119,1552-1578` | Boot-check in production: secret key requires webhook secret; reject `sk_test_` in prod; add payments status to `/api/health` |
| B7 | **Reconciliation marks payments "paid" without granting the entitlement** — if a webhook is missed, money is taken, no membership/ticket/invoice/email is created, and "paid" status suppresses dunning. The backstop is worse than no backstop | `api/lib/scheduler.ts:912-938` vs the rich webhook path `api/boot.ts:1177-1351` | Route reconciled-paid records through the same shared entitlement handler the webhook uses |
| B8 | **Demo-data loader can pollute production** — admin "Load full demo" button sets a publicly documented password (`ehive1234`) on fake members; DEPLOY.md publishes the demo admin login and invites seeding during deploy | `api/queries/demo-data.ts:9-10,277`, `src/pages/admin/AdminAccess.tsx:343-382`, `DEPLOY.md:70,111,163,175` | Verify the `demo:full:loaded` marker is unset in prod; env-gate or remove the Load-demo button from production builds; move demo creds to a local-only doc section |

---

## 2. HIGH — fix before or within days of launch

| # | Gap | Evidence | Fix |
|---|-----|----------|-----|
| H1 | **No web analytics / conversion tracking** — raised in 4 audits (GAP 3.1/3.2 → V3 → V4-B1), still absent; a paid launch with ad spend is flying blind | no Plausible/PostHog/GA tag in `public/` | Add lightweight analytics snippet + conversion events on lead/booking/apply/checkout success |
| H2 | **No duplicate-checkout guard on membership/renewal/upgrade/activation** — double-click → two Stripe sessions → two charges, renewal stacks +1yr per payment (event tickets already have this guard) | `api/circle-router.ts:227-236,316-325,402-410,510-519`; unique `idempotencyKey` index unused `db/schema.ts:881` | Pending-conflict check on the four flows + Stripe idempotency key on `checkout.sessions.create` |
| H3 | **KYC national ID numbers stored in plaintext** — the codebase AES-256-GCM-seals TOTP secrets but not passport/Emirates-ID numbers (PDPL exposure if DB leaks) | `api/queries/kyc.ts:39` | Seal with the same AES-256-GCM helper pattern (`api/lib/totp.ts:48-58`) |
| H4 | **Email failure modes silently lock users out** — verification/reset send failures are catch-and-log; login hard-blocks unverified users; no admin "verify email" action; if ZeptoMail credits/SMTP fail at launch, registrations strand en masse | `api/auth-router.ts:72-83,162-168,264-274`, `api/lib/mailer.ts:153-157,176-180` | Surface send failures to UI; add admin verify-email action; alert on mail-health flips |
| H5 | **Zero test coverage on the money path (Stripe webhook) and thin auth coverage** — signature verify + CAS idempotency + entitlement grants are read-correct but never executed; auth tests cover only scrypt | no test references webhook/stripe/session issuance; `api/auth.test.ts:1-27` | Unit-test webhook handler with a mocked provider (interface exists for this); login/session/reset tests with fake DB |
| H6 | **DEPLOY.md runbook drift that breaks launch night** — prescribes `db:push` (no journal) which then makes the automated pre-deploy baseline fail on any fresh environment; also claims custom domains need "no code or env change" while `PUBLIC_URL` drives CORS, email/reset links, and Stripe redirect URLs; §5 "hardening backlog" is stale | `DEPLOY.md:70-71,77-79,178,186-189` vs `railway.json:8`, `scripts/pre-deploy.ts:39,177-180`, `api/lib/env.ts:70-74` | Rewrite DEPLOY.md: migrations auto-apply via preDeploy; schema changes via `db:generate` + commit; set `PUBLIC_URL` when attaching the domain; refresh §5 |
| H7 | **Backup workflow dumps full PII as a downloadable artifact** (when enabled) — 90-day retention in the repo's artifact store | `.github/workflows/backup.yml` | gpg-encrypt the dump and/or push to a restricted bucket; never `upload-artifact` the raw dump |
| H8 | **Paying members have no support channel in the product** — no mailto/WhatsApp/help link anywhere in portal or admin | none in `src/` | Add a support link/footer in the portal (real support inbox) + minimal help/FAQ page |
| H9 | **Marketing apply funnel is lead-capture only, with no bridge to the real application** — every "Apply" CTA posts to `/api/lead` ("we'll be in touch"); the actual screening workflow only runs from the portal and the site never mentions creating an account | `apply.html:565-577`, `src/pages/portal/Apply.tsx` | On apply.html confirmation, deep-link to `/login?next=/portal/apply`; add a Leads-inbox action "send portal application link" |

---

## 3. MEDIUM — schedule within the first launch weeks

- **Node version mismatch:** CI tests Node 20, production runs floating `node:22-slim`, `@types/node ^24`, no `engines` — tested ≠ shipped. Pin `engines >=22`, align CI, pin the image digest. (`Dockerfile:4,18`, `ci.yml:17,47,95`)
- **`.env.example` omits 13+ code-read vars** including all alerting/monitoring knobs (`SENTRY_DSN`, `ALERT_WEBHOOK_URL`, `METRICS_TOKEN`, `PUBLIC_URL`, `CLAMAV_URL`, `INTEGRATION_API_KEYS`, rate-limit knobs) — alerting will never be set, and without `PUBLIC_URL` prod links/CORS default to the railway.app domain. (`api/lib/env.ts`, `api/boot.ts:1597`)
- **No HTTP request logging or correlation IDs; 5xx never reach alerting** — the PII-redacting JSON logger is only used by the scheduler; Sentry/webhook alerting consumed only in `api/lib/scheduler.ts:88-127`. Add one access-log middleware with request IDs; route 5xx to the existing alert hook.
- **Register issues a live 7-day session before email verification** — enables email-pumping and registration blocking under a victim's address. Don't set the cookie in `register`, or globally gate unverified sessions. (`api/auth-router.ts:136-139`)
- **Session fingerprint recorded but never validated** — stolen cookie usable from any IP/UA. Compare `clientFingerprint` in `authenticateRequest` with a tolerance decision. (`api/queries/sessions.ts:80-88`)
- **scrypt at Node defaults (N=16384)** — below OWASP N≥2^17; format has no params slot. Pass explicit params + version the format (async/threadpool, so safe). (`api/lib/password.ts:39-43`)
- **Rate-limit identity trusts rightmost X-Forwarded-For** — correct only if Railway overwrites XFF and the origin is unreachable directly; verify against the live deploy. (`api/auth-router.ts:61-70`, `api/boot.ts:167-175`)
- **Public booking endpoint confirms bookings for arbitrary emails** — spam/abuse vector burning calendar slots; require one-click email confirm or a CAPTCHA at traffic levels. (`api/boot.ts:758-906`)
- **Post-payment landing is dead** — success URLs pass `?paid=1`/`?renewed=1`/etc. that no client code reads; users return from Stripe to silence. Render a "processing, you'll be confirmed by email" state or poll payment status. (`api/circle-router.ts:219,308,397,502,1899`)
- **No 2FA recovery path** — enrol/disable complete, but no recovery codes and the admin reset helper has no callers; lost phone = lockout. (`api/auth-router.ts:414-465`, `api/queries/users.ts:132`)
- **Cookie notice/consent absent** — auth cookies + PDPL launch expect an explicit notice; add lightweight banner + cookie section in the privacy policy.
- **Launch copy engine targets the now-past 1 Oct 2026 date** — `LAUNCH_DATE_UTC = 2026-09-30T20:00Z` (`public/app.js:19`), vanguard "opens 1 October · Forty seats". Set the real date and align cohort copy.
- **WhatsApp CTA permanently disabled** (`WA_NUMBER = null`, `public/app.js:14`) — highest-converting Gulf channel dark; also confirm ownership of the hardcoded number `971555126996`.
- **docker-compose passes through none of the SMTP/Stripe/ZeptoMail vars** DEPLOY.md says to use — compose-path launches get silent no-mail/no-payments. (`docker-compose.yml:42-49`)
- **`retention:lead_pii_days` PDPL anonymisation is unset (= off)** — decide intent before collecting real lead PII. (`docs/DISASTER-RECOVERY.md:113`)
- **Repo quiet for 21 days pre-launch** — clean tree, `main` == `origin/main`, but confirm nothing is parked elsewhere.

## 4. LOW — backlog

- `@aws-sdk/client-s3` + `s3-request-presigner` declared, **zero usage** — no S3 code exists; uploads are base64-in-MySQL. Remove the dead deps (shrinks the Trivy-gated CVE surface) and fix the stale "S3 storage" description. (`package.json:27-28`)
- **Insights page falls back to fake-looking journal cards** if the DB has no posts — hide the fallback grid when the API returns zero, or guarantee the seed runs in prod. (`public/insights.html:248-283`)
- Stale comment in `api/lib/rate-limit.ts:2-3` (claims in-memory fallback; actually fails closed in prod).
- `bodyLimit` 5MB vs 6MB receipt cap — effective ceiling ~3.5MB; harmless but unintended. (`api/boot.ts:241`, `api/lib/receipt-scan.ts:44`)
- `/metrics` bearer token compared non-constant-time — use `timingSafeEqual`. (`api/boot.ts:1603`)
- CSP: `style-src 'unsafe-inline'` (raised in 4 audits, partial) and `img-src … https:` — narrow when the asset strategy settles. (`api/boot.ts:145-149`)
- Server bundle 5.7MB single file; QrScanner chunk 336KB (lazy-loaded) — cold-start/perf note, not blocking.
- `public/styles.css` dead file remains (issue resolved, file not deleted).
- Deferred-by-design (accepted): Redis/scheduler scale-out, recurring event templates, scheduled report subscriptions, public awards page, non-calendar fiscal year, bank reconciliation import, multi-device event check-in.

---

## 5. What's solid (verified in code — do not re-litigate)

- **Quality gates, today:** tsc 0 errors · 247/247 vitest across 32 files · build exit 0 · eslint 0 errors · prettier pass · CI enforces all + `npm audit --audit-level=high` + Trivy image scan + real-MySQL migration job. Zero TODO/FIXME/HACK in `src/`/`api/`.
- **Money paths (webhook core):** raw-body signature verification, compare-and-swap idempotency, userId/tier/amount mismatch rejection, invoice-in-same-transaction, sold-out row-lock with auto-refund, promo claim/release atomicity, prorated upgrades, refunds with credit notes + grace windows, atomic invoice numbering, AED integer-fils throughout. (`api/boot.ts:1105-1397`, `api/queries/finance.ts`)
- **Security:** scrypt+salt with timingSafeEqual, `__Host-eh_sid` (Secure/HttpOnly/SameSite=Strict), per-device sessions + revoke-others, tokenVersion mass invalidation, 2FA with AES-256-GCM-sealed TOTP secrets, MySQL rate limiter that **fails closed** in production, Origin-vs-Host CSRF check + locked CORS, hash-based CSP nonces for scripts, HSTS/preload, full-admin segregation-of-duties scopes with audit log, zod everywhere, parameterized SQL, PII-redacting logger, zero secrets in tracked files or history.
- **Features:** every nav item and README claim maps to a real, DB-backed implementation — application→screening→membership (with onboarding lifecycle + buddy pairing + rejection email), Hive Score engine (ledger × weighted factors × history snapshots), pods/sessions/attendance, events (paid tickets), FRP, governance, library, offers, awards (with fraud detection), chapters, KYC, conduct, referrals, data export, admin 360°. 27 public pages, all links/assets resolve, real copy, per-page OG images, DB-backed sitemap/robots, production-grade lead capture (rate limit + honeypot + dedupe + auto-assign).
- **Ops:** genuine multi-stage Dockerfile (non-root, `npm ci`, secret-excluding .dockerignore), `npm start` == Dockerfile CMD == railway.json, pre-deploy migrations with baseline reconciliation + unit test, 34 committed migrations, graceful SIGTERM drain, health/readiness/metrics endpoints, DR runbook + integration API docs. Most V4-audit "open" items are verified fixed in code (tier upgrades, promo codes, franchise royalties, paid events, testimonials, per-page OG, WhatsApp button plumbing, session hardening, nurture jobs).

---

## 6. Next.js rewrite (`ehive-portal`) — recommendation: **do not launch it**

A July-2025 prototype, **abandoned ~14 months, zero git commits ever**, ~7% of the code volume (5.2k LOC vs 77.5k; 33 Prisma models vs 99 tables), SQLite-only, and zero commercial capability: no payments (memberships saved as `PENDING_PAYMENT_STUB`), no email, no push, no tests/CI/deploy pipeline, free self-serve signup into any tier including Zenith, and **demo credentials published on the sign-in page**. It shares no code with the clone (both descend from the same BRD).

**Recommendation:** harden and launch the clone. Keep the rewrite at most as a design reference — its route-group access-control pattern, append-only Hive Score ledger, and benefit-class access model are worth cribbing. Reaching clone parity from it is re-implementation, not migration. If it is truly dead, consider deleting it (or at least the demo-credentials sign-in page) to prevent it ever being deployed by mistake.

---

## 7. Pre-launch checklist (in order)

1. **Owner decision:** founding-cohort-by-application vs. self-serve paid join (§0) — everything downstream depends on it.
2. Fix the URL split-brain: the domain is registered and already serving the app — set `PUBLIC_URL=https://www.ehiveglobal.com` on Railway; fix `MAIL_FROM`; regenerate canonicals/OG URLs in `public/*.html`; verify the transactional-mail sender for the domain; fix the stale `env.ts:69` comment.
3. Publish ToS, privacy policy, refund/cancellation policy; add cookie notice; link all from footer + checkout.
4. Enable backups: set `DATABASE_BACKUP_URL`, encrypt + off-platform storage, enable Railway snapshots, **perform and record a test restore**.
5. Stripe: confirm `sk_live_` + matching webhook secret in production; add boot validation (B6); register the webhook endpoint in the Stripe dashboard; run one live-card end-to-end test (join/renew/ticket/refund).
6. Fix the reconciliation entitlement gap (B7) and add duplicate-checkout guards (H2) **before** any live traffic.
7. Verify prod was never demo-seeded; remove/env-gate the Load-demo button; move demo credentials out of DEPLOY.md.
8. Add the support channel to the portal (H8) and the analytics snippet (H1).
9. Rewire DEPLOY.md to the migration flow and correct the domain/env instructions (H6).
10. Environment-only verifications (need dashboards): CI green + branch protections on `main`; Sentry/alert webhook set; ClamAV decision; Stripe webhook registered; Insights articles present (or seed guaranteed).
11. Stretch before traffic spikes: webhook + auth tests (H5), KYC field encryption (H3), mail-failure surfacing (H4), Node pinning, request logging.

**Open questions only the owner/deploy console can answer:** `DATABASE_BACKUP_URL` set? Railway snapshots on? Stripe live pair + webhook registered? Production DB seeded at any point? `retention:lead_pii_days` intent? WhatsApp number ownership? (Resolved since first publication: the launch domain IS registered and serving — but `PUBLIC_URL` is verifiably unset in production.)
