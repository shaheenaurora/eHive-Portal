# Deploying the eHive Portal

This is the operational runbook for taking the Portal live. The code is
build-clean and container-ready; what remains is provisioning infrastructure and
secrets, which only you can do. Work top to bottom.

Authentication is **email + password** (BRD §6.2) — self-contained, with no
third-party identity provider to register. The first account that signs up with
`OWNER_EMAIL` is automatically made an admin.

---

## 0. What the Portal needs to run (hard dependencies)

| # | Dependency | Why it's required | Who provides it |
|---|---|---|---|
| 1 | **MySQL 8** database | All data (members, pods, events, scores…) | You — managed DB or the bundled `db` container |
| 2 | **`APP_SECRET`** (long random string) | Signs the session cookie (JWT) | You — generate once, e.g. `openssl rand -hex 32` |
| 3 | **`OWNER_EMAIL`** | The account signing up with it becomes the first admin | You — your own email |
| 4 | A host that runs a Node 20 container on a public URL over HTTPS | Serves site + portal + API | You — VM, PaaS, or similar |

Deferred per BRD §10 (not blockers for a first launch, but plan for them):
payment gateway selection (Telr/PayTabs/Network International/Stripe UAE) for
self-serve tier purchase, WhatsApp/email platform for nudges, and the Emirates
First integration for Business Setup status.

---

## 1. Configure secrets

```bash
cp .env.example .env
```

Fill in every value:

| Variable | Example / source |
|---|---|
| `APP_SECRET` | `openssl rand -hex 32` — signs session cookies |
| `DATABASE_URL` | `mysql://ehive:PASSWORD@db:3306/ehive` (compose) or your managed DB URL |
| `OWNER_EMAIL` | your email → the account you register with it becomes admin |

For the bundled MySQL container, also set `MYSQL_PASSWORD`,
`MYSQL_ROOT_PASSWORD` (and optionally `MYSQL_DATABASE`, `MYSQL_USER`,
`APP_PORT`). There are **no build-time secrets** — everything is runtime env.

---

## 2A. Deploy with Docker Compose (single VM — simplest)

```bash
docker compose up -d --build          # build image + start app and MySQL
docker compose run --rm app npm run db:push     # one-time: create the schema
docker compose run --rm app npx tsx db/seed.ts  # optional: demo data
```

App is now on `http://<server>:3000`. Put it behind a reverse proxy
(Caddy/nginx/Traefik) for TLS and your domain (BRD sitemap: `app.ehive.com`).

Update later: `git pull && docker compose up -d --build`.

## 2B. Deploy on a managed PaaS (Railway / Render / Fly.io)

1. Provision a **MySQL 8** add-on; copy its connection string into `DATABASE_URL`.
2. Point the platform at this repo's **Dockerfile** (no build args needed).
3. Set the runtime env vars from §1 (`APP_SECRET`, `DATABASE_URL`, `OWNER_EMAIL`).
4. After the first deploy, run the schema push once from a one-off shell /
   release command: `npm run db:push` (and optionally `npx tsx db/seed.ts`).

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
