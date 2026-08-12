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
- **Payments (Stripe):** self-serve online join & pay for the Horizon/Ascent/
  Vanguard tiers, with membership auto-activated on payment. Without it, everyone
  goes through the application flow. Any UAE gateway (Telr/PayTabs/Network
  International) can be dropped in later by implementing one `PaymentProvider`.

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
4. **Create the schema (one-time).** With the Railway CLI:
   `railway run npm run db:push` (and optionally `railway run npx tsx db/seed.ts`).
   Or add `npm run db:push` as a one-off in the service shell.
5. Railway gives you a public URL (`*.up.railway.app`). Add your custom domain
   next (see below).

### Connecting a custom domain

The app derives its URL from the incoming request, so **no code or env change
is needed** — verification, password-reset and payment links all use whatever
domain serves the request. Steps (example: `www.ehiveglobal.com`):

1. **Railway → app service → Settings → Networking → Custom Domain.** Enter
   `www.ehiveglobal.com`. Railway shows a **CNAME target** like `xxxx.up.railway.app`
   — copy it.
2. **At the domain's DNS provider** (registrar or Cloudflare for ehiveglobal.com),
   add a record:
   - Type `CNAME`, Name/Host `www`, Value the Railway target, TTL default.
3. **Root/apex** (`ehiveglobal.com` with no www) — optional but recommended:
   - Add `ehiveglobal.com` as a _second_ custom domain in Railway, then either point
     the apex at the Railway target using your provider's `ALIAS`/`ANAME`/
     CNAME-flattening (Cloudflare does this automatically), **or** set a
     registrar redirect `ehiveglobal.com → www.ehiveglobal.com`.
4. **SSL is automatic.** Railway provisions a Let's Encrypt certificate once DNS
   resolves — usually minutes, up to ~an hour. Nothing to configure.
5. **Verify:** open `https://www.ehiveglobal.com/`, then `/login` → register → confirm
   you reach `/portal`.

Notes: if `www.ehiveglobal.com` currently serves another site, this replaces it. DNS
propagation is usually fast but can take up to 48h. Once the domain is live and
you later add `SMTP_*` / `STRIPE_*`, their emails and checkout redirects use the
new domain automatically.

Render/Fly.io work the same way — point them at the `Dockerfile`, add a managed
MySQL, and set the same three variables (set `DATABASE_SSL=true` if that
provider's MySQL requires TLS).

## 2B. Deploy with Docker Compose (local or a single VM)

```bash
docker compose up -d --build          # build image + start app and MySQL
docker compose run --rm app npm run db:push     # one-time: create the schema
docker compose run --rm app npx tsx db/seed.ts  # optional: demo data
```

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

**Payments (Stripe).** Turn on self-serve online join:

1. Set `STRIPE_SECRET_KEY` (`sk_test_…` to trial, `sk_live_…` for real charges).
2. In the Stripe dashboard → **Developers → Webhooks → Add endpoint**, point it
   at `https://YOUR_DOMAIN/api/payments/webhook` and subscribe to
   `checkout.session.completed` (and `checkout.session.async_payment_succeeded`).
3. Copy the endpoint's **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.

The Apply page then shows a **Join & pay** button for the Horizon/Ascent/
Vanguard tiers; on successful payment the webhook activates the membership,
awards joining points, and auto-pairs a buddy. Prices come from
`TIER_PRICE_AED` in `contracts/constants.ts`. Zenith stays application-only.

---

## 3. Verify the launch

```bash
curl -fsS https://YOUR_DOMAIN/                 # marketing home (200)
curl -fsS https://YOUR_DOMAIN/api/insights     # {"posts":[...]} — DB reachable
```

Then in a browser: open `/login`, click **Create an account**, register with your
`OWNER_EMAIL`, and confirm you land in `/portal`. Because that email matches
`OWNER_EMAIL`, `/admin` is now reachable (it is role-gated server-side). If you
seeded demo data, you can also sign in as `amina@ehive.ae` / `ehive1234` (admin).

**Acceptance walkthroughs** (BRD §11.1) worth running once before go-live:
member joins → buddy paired → event QR check-in → Hive Score updates; Zenith
nomination → endorsements → approval; a chapter election with a secret ballot.

---

## 4. Operations

- **Availability target** (BRD §8.3): 99.5%/month, 3s core-journey loads on 4G.
- **Backups:** schedule MySQL dumps (the `ehive-db` volume holds all state).
- **Change the demo password:** the seed sets every demo account to `ehive1234`
  — never run the seed against production, or change it first.
- **Schema changes:** edit `db/schema.ts`, then `npm run db:push` (or
  `npm run db:generate` for a reviewed migration).
- **Score weights / point rules** are admin-configurable in `/admin/score` — no
  redeploy needed to tune them.

---

## 5. Hardening backlog (before real members join)

- **Email verification + password reset** — the schema and auth router are the
  natural place to add an OTP/verification flow (BRD §6.2 mentions OTP).
- **Rate-limit** `auth.login` / `auth.register` to slow credential stuffing.
- **PDPL compliance** (BRD §8.4): consent capture and data-subject requests —
  a `dataRequests` table already exists to build on.
