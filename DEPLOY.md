# Deploying the eHive Portal

This is the operational runbook for taking the Portal live. The code is
build-clean and container-ready; what remains is provisioning infrastructure and
secrets, which only you can do. Work top to bottom.

Authentication is **email + password** (BRD §6.2) — self-contained, with no
third-party identity provider to register. The first account that signs up with
`OWNER_EMAIL` is automatically made an admin.

---

## 0. What the Portal needs to run (hard dependencies)

| #   | Dependency                                                      | Why it's required                                      | Who provides it                                  |
| --- | --------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| 1   | **MySQL 8** database                                            | All data (members, pods, events, scores…)              | You — managed DB or the bundled `db` container   |
| 2   | **`APP_SECRET`** (long random string)                           | Signs the session cookie (JWT)                         | You — generate once, e.g. `openssl rand -hex 32` |
| 3   | **`OWNER_EMAIL`**                                               | The account signing up with it becomes the first admin | You — your own email                             |
| 4   | A host that runs a Node 20 container on a public URL over HTTPS | Serves site + portal + API                             | You — VM, PaaS, or similar                       |

Optional integrations — the app runs fully without them, and each switches on
the moment its env vars are present (see §2C):

- **Email (SMTP):** lead notifications to the business + confirmation emails to
  people who submit website forms. Without it, leads are still stored in the DB.
- **Payments (Stripe):** online join & pay for the tiers in `SELF_SERVE_TIERS`
  (`contracts/constants.ts` — currently `["vanguard"]`). While
  `VANGUARD_FOUNDING_APPLICATION_ONLY` stays `true`, even Vanguard is
  application-only, with payment captured manually after admission. Without
  Stripe, everyone goes through the application flow. Any UAE gateway
  (Telr/PayTabs/Network International) can be dropped in later by implementing
  one `PaymentProvider`.

---

## 1. Configure secrets

```bash
cp .env.example .env
```

Fill in every value:

| Variable       | Example / source                                                        |
| -------------- | ----------------------------------------------------------------------- |
| `APP_SECRET`   | `openssl rand -hex 32` — signs session cookies                          |
| `DATABASE_URL` | `mysql://ehive:PASSWORD@db:3306/ehive` (compose) or your managed DB URL |
| `OWNER_EMAIL`  | your email → the account you register with it becomes admin             |

For the bundled MySQL container, also set `MYSQL_PASSWORD`,
`MYSQL_ROOT_PASSWORD` (and optionally `MYSQL_DATABASE`, `MYSQL_USER`,
`APP_PORT`). There are **no build-time secrets** — everything is runtime env.

---

## 2A. Deploy on Railway (recommended)

Railway runs this repo as-is from the `Dockerfile` (see `railway.json`) and
provides the MySQL database — no code changes, no TLS setup.

1. **New Project → Deploy from GitHub repo** → pick this repo. Railway detects
   the `Dockerfile` and builds it.
2. **Add a database:** in the project, **New → Database → MySQL**. Railway
   creates it on the private network.
3. **Wire the app's variables** (app service → Variables):
   - `DATABASE_URL` = `${{ MySQL.MYSQL_URL }}` ← reference the MySQL service
   - `APP_SECRET` = output of `openssl rand -hex 32`
   - `OWNER_EMAIL` = your email
   - (leave `DATABASE_SSL` unset — the private network doesn't need TLS)
     Railway injects `PORT` automatically; the server already binds `0.0.0.0`.
4. **Schema & migrations — automatic, nothing to run.** Every deploy runs
   `node dist/pre-deploy.js` first (`railway.json` → `preDeployCommand`), which
   applies the versioned migrations in `db/migrations/` — including on a fresh
   database. **Never run `db:push` against any environment**: `drizzle-kit push`
   writes no migration journal, so it desyncs the pre-deploy baseline and
   deploys fail. For schema changes see §4.
5. Railway gives you a public URL (`*.up.railway.app`). Add your custom domain
   next (see below) — and set `PUBLIC_URL`, which is **required** for the
   domain to work correctly.

### Connecting a custom domain

**This REQUIRES an env change:** set `PUBLIC_URL=https://<your-domain>` on the
app service (Railway → Variables), then redeploy. `PUBLIC_URL` drives the
absolute URLs in verification / password-reset emails, Stripe checkout redirect
URLs, CORS, and robots.txt + the sitemap — without it those keep emitting the
fallback `*.up.railway.app` origin even though the site is served on your
domain. Steps (example: `www.ehiveglobal.com`):

1. **Set `PUBLIC_URL`.** Railway → app service → Variables →
   `PUBLIC_URL=https://www.ehiveglobal.com`. Redeploy so it takes effect.
2. **Railway → app service → Settings → Networking → Custom Domain.** Enter
   `www.ehiveglobal.com`. Railway shows a **CNAME target** like `xxxx.up.railway.app`
   — copy it.
3. **At the domain's DNS provider** (registrar or Cloudflare for ehiveglobal.com),
   add a record:
   - Type `CNAME`, Name/Host `www`, Value the Railway target, TTL default.
4. **Root/apex** (`ehiveglobal.com` with no www) — optional but recommended:
   - Add `ehiveglobal.com` as a _second_ custom domain in Railway, then either point
     the apex at the Railway target using your provider's `ALIAS`/`ANAME`/
     CNAME-flattening (Cloudflare does this automatically), **or** set a
     registrar redirect `ehiveglobal.com → www.ehiveglobal.com`.
5. **SSL is automatic.** Railway provisions a Let's Encrypt certificate once DNS
   resolves — usually minutes, up to ~an hour. Nothing to configure.
6. **Verify:** open `https://www.ehiveglobal.com/`, then `/login` → register → confirm
   you reach `/portal`. Also check `/robots.txt` and `/sitemap.xml` — they must
   emit your domain, not `*.up.railway.app`; if they don't, `PUBLIC_URL` is
   still unset or the redeploy hasn't happened.

Notes: if `www.ehiveglobal.com` currently serves another site, this replaces it. DNS
propagation is usually fast but can take up to 48h. Once `PUBLIC_URL` is set and
the domain is live, any `SMTP_*` / `STRIPE_*` you add later use the new domain
automatically.

Render/Fly.io work the same way — point them at the `Dockerfile`, add a managed
MySQL, and set the same three variables (set `DATABASE_SSL=true` if that
provider's MySQL requires TLS).

## 2B. Deploy with Docker Compose (local or a single VM)

```bash
docker compose up -d --build            # build image + start app and MySQL
docker compose run --rm app npm run db:migrate  # one-time: apply the migrations
```

Migrations are versioned and journaled — `db:migrate`, never `db:push`. Demo
seeding is **local development only** (see the dedicated section below).

App is on `http://<server>:3000`. Put it behind a reverse proxy
(Caddy/nginx/Traefik) for TLS and your domain. Update: `git pull && docker compose up -d --build`.

## 2C. Optional: email + payments

Both are off until their variables are set. Add them anytime (Railway → app
service → Variables, or your `.env`) — no code change, just redeploy.

**Email (SMTP).** Turn on lead notifications + submitter confirmations:

| Variable                  | Example / source                                                       |
| ------------------------- | ---------------------------------------------------------------------- |
| `SMTP_HOST`               | `smtp.gmail.com`, `smtp.zoho.com`, `email-smtp.<region>.amazonaws.com` |
| `SMTP_PORT`               | `587` (STARTTLS) or `465` (implicit TLS)                               |
| `SMTP_SECURE`             | `true` for port 465; leave empty for 587                               |
| `SMTP_USER` / `SMTP_PASS` | mailbox login. For Gmail, create an **App Password** (2FA required)    |
| `MAIL_FROM`               | `hello@ehiveglobal.com` (defaults to `SMTP_USER`)                      |
| `LEAD_NOTIFY_EMAIL`       | where new-lead alerts go (defaults to `OWNER_EMAIL`)                   |

Every website form (newsletter, Get Started, booking, setup calculator, the
Clarity Scorecard) then emails a formatted alert to `LEAD_NOTIFY_EMAIL` and a
branded confirmation to whoever submitted it. Mail failures never break a
submission — the lead is stored first, mail is fire-and-forget.

**Payments (Stripe).** Which admission mode is live is decided by two
constants in `contracts/constants.ts` — treat them as the source of truth and
**decide before launch**:

- `SELF_SERVE_TIERS` — tiers that can be joined and paid online instantly.
  Currently `["vanguard"]`: Horizon and Ascent open later; Zenith is
  application-only.
- `VANGUARD_FOUNDING_APPLICATION_ONLY` — while `true` (the founding cohort),
  **even Vanguard is application-only**: applicants apply, the team screens and
  admits them, and payment is captured manually (recorded against the
  membership by an admin). Flip to `false` after the founding cohort to restore
  instant pay-to-join for the tiers in `SELF_SERVE_TIERS`.

Stripe setup (needed for either mode, so payment can be recorded and — once
self-serve is on — collected online):

1. Set `STRIPE_SECRET_KEY` (`sk_test_…` to trial, `sk_live_…` for real charges).
2. In the Stripe dashboard → **Developers → Webhooks → Add endpoint**, point it
   at `https://YOUR_DOMAIN/api/payments/webhook` and subscribe to
   `checkout.session.completed` (and `checkout.session.async_payment_succeeded`).
3. Copy the endpoint's **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.

When self-serve is active for a tier, the Apply page shows a **Join & pay**
button; on successful payment the webhook activates the membership, awards
joining points, and auto-pairs a buddy. Prices come from `TIER_PRICE_AED` in
`contracts/constants.ts`. In application-only mode there is no pay button —
the flow is apply → screen → admit → record payment manually.

---

## 3. Verify the launch

```bash
curl -fsS https://YOUR_DOMAIN/                 # marketing home (200)
curl -fsS https://YOUR_DOMAIN/api/insights     # {"posts":[...]} — DB reachable
```

Then in a browser: open `/login`, click **Create an account**, register with your
`OWNER_EMAIL`, and confirm you land in `/portal`. Because that email matches
`OWNER_EMAIL`, `/admin` is now reachable (it is role-gated server-side).

> Demo / seed data has no place in a production launch — see **Local development
> only** below. The load-demo endpoint is disabled in production.

**Acceptance walkthroughs** (BRD §11.1) worth running once before go-live:
member joins → buddy paired → event QR check-in → Hive Score updates; Zenith
nomination → endorsements → approval; a chapter election with a secret ballot.

---

## 4. Operations

- **Availability target** (BRD §8.3): 99.5%/month, 3s core-journey loads on 4G.
- **Backups:** schedule MySQL dumps (the `ehive-db` volume holds all state).
- **Schema changes:** edit `db/schema.ts`, run `npm run db:generate`, commit the
  generated migration in `db/migrations/` — the pre-deploy step applies it
  automatically on the next deploy. **Never run `db:push`** against any
  environment: it writes no migration journal, which desyncs the pre-deploy
  baseline and fails deploys.
- **Score weights / point rules** are admin-configurable in `/admin/score` — no
  redeploy needed to tune them.

---

## 5. Local development only: demo & seed data

> **Everything in this section is for a local / throwaway environment only —
> never against production.** The demo dataset exists so you can explore the
> portal with realistic data. Every seeded account uses the publicly
> documented password `ehive1234`.

- **Load the demo dataset** — with the app running against a throwaway
  database, sign in as your `OWNER_EMAIL` admin and use **Team & access →
  Load full demo** in the admin UI, or run `npx tsx db/seed.ts` (compose:
  `docker compose run --rm app npx tsx db/seed.ts`; Railway CLI:
  `railway run npx tsx db/seed.ts`). The seed's demo admin login is
  `amina@ehive.ae` / `ehive1234`.
- **The load-demo endpoint is disabled in production.** The server refuses
  "Load full demo" whenever `NODE_ENV=production` unless `ALLOW_DEMO_DATA=true`
  is explicitly set — leave that unset on any paid/production environment. The
  **Remove demo data** button stays available to full admins everywhere, so
  demo rows can always be cleaned up if they ever get in.
- **Change the demo password** before exposing any seeded environment beyond
  your own machine — the seed sets every demo account to `ehive1234`.

---

## 6. Hardening backlog (before real members join)

Already shipped — **email verification, password reset, and auth rate limiting
all exist now** (`api/auth-router.ts` issues verification/reset tokens and
rate-limits register, login, 2FA, verify, reset and password change;
`api/middleware.ts` adds per-user tRPC limits on top), so they are no longer
open items.

- **PDPL compliance** (BRD §8.4): consent capture and data-subject requests —
  a `dataRequests` table already exists to build on.
