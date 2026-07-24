# Deploying the eHive Portal

This is the operational runbook for taking the Portal live. The code is
build-clean and container-ready; what remains is provisioning infrastructure and
secrets, which only you can do. Work top to bottom.

---

## 0. What the Portal needs to run (hard dependencies)

The app will **not** function without these — they are external to the codebase:

| # | Dependency | Why it's required | Who provides it |
|---|---|---|---|
| 1 | **MySQL 8** database | All data (members, pods, events, scores…) | You — managed DB or the bundled `db` container |
| 2 | **Kimi OAuth app** (`APP_ID`, `APP_SECRET`, auth + open URLs) | The **only** sign-in method — no login works without it | You — register on the Kimi/Moonshot platform |
| 3 | **Owner union ID** (`OWNER_UNION_ID`) | First admin is auto-granted to this Kimi account | You — your Kimi account's unionId |
| 4 | A host that runs a Node 20 container on a public URL over HTTPS | Serves site + portal + API | You — VM, PaaS, or the platform it was built on |

> **Login depends entirely on Kimi OAuth.** If you do not have Kimi OAuth
> credentials, no one can sign in to the member or admin portal. See
> §5 "If you don't have Kimi OAuth" for the alternative.

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
| `APP_ID` | Kimi OAuth application ID |
| `APP_SECRET` | Kimi OAuth application secret (also signs the session JWT) |
| `DATABASE_URL` | `mysql://ehive:PASSWORD@db:3306/ehive` (compose) or your managed DB URL |
| `KIMI_AUTH_URL` | Kimi OAuth server, e.g. `https://auth.kimi.com` |
| `KIMI_OPEN_URL` | Kimi Open Platform, e.g. `https://open.kimi.com` |
| `VITE_KIMI_AUTH_URL` | same auth URL — **baked into the client at build time** |
| `VITE_APP_ID` | same app ID — **baked into the client at build time** |
| `OWNER_UNION_ID` | your Kimi account's unionId → becomes the first admin |

For the bundled MySQL container, also set `MYSQL_PASSWORD`,
`MYSQL_ROOT_PASSWORD` (and optionally `MYSQL_DATABASE`, `MYSQL_USER`).

> The two `VITE_*` values are compiled into the JavaScript bundle — changing
> them later means rebuilding the image, not just restarting the container.

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
2. Point the platform at this repo's **Dockerfile**.
3. Set the **build arguments** `VITE_KIMI_AUTH_URL` and `VITE_APP_ID`
   (build-time — this is the step most PaaS deploys miss).
4. Set the runtime env vars from §1.
5. First deploy, then run the schema push once from a one-off shell / release
   command: `npm run db:push` (and optionally `npx tsx db/seed.ts`).

---

## 3. Verify the launch

```bash
curl -fsS https://YOUR_DOMAIN/                 # marketing home (200)
curl -fsS https://YOUR_DOMAIN/api/ping         # {"ok":true,...} via tRPC? use:
curl -fsS https://YOUR_DOMAIN/api/insights     # {"posts":[...]} — DB reachable
```

Then in a browser: open `/login`, click **Sign in with Kimi**, complete OAuth,
and confirm you land in `/portal`. Sign in with the `OWNER_UNION_ID` account and
confirm `/admin` is reachable (it is role-gated server-side).

**Acceptance walkthroughs** (BRD §11.1) worth running once before go-live:
member joins Horizon → buddy paired → event QR check-in → Hive Score updates;
Zenith nomination → endorsements → approval → invoice; a chapter election end to
end with a secret ballot.

---

## 4. Operations

- **Availability target** (BRD §8.3): 99.5%/month, 3s core-journey loads on 4G.
- **Backups:** schedule MySQL dumps (the `ehive-db` volume holds all state).
- **Schema changes:** edit `db/schema.ts`, then `npm run db:push` (or generate a
  migration with `npm run db:generate` for a reviewed change).
- **Score weights / point rules** are admin-configurable in `/admin/score` — no
  redeploy needed to tune them.

---

## 5. If you don't have Kimi OAuth

The auth layer lives in `api/kimi/` and `api/context.ts`, and the frontend
redirect in `src/pages/Login.tsx`. Swapping to a standard provider
(Google/GitHub OAuth, or email + password) is a contained change to those files
plus the `users` table — the rest of the app already keys off `ctx.user`. This
is a development task, not a config change; flag it and it can be implemented.
