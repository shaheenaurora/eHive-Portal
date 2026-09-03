# Disaster Recovery & Operations Runbook

This runbook covers backup, restore, and the operational levers for the eHive
Portal. It exists so recovery is a documented procedure, not an improvisation.

The stack: a single Node process (Hono + tRPC) serving the API and the built
SPA, backed by one MySQL 8 database, deployed on Railway. State lives entirely in
MySQL — the app process is stateless and disposable, so **the database is the
only thing that must be backed up**.

---

## 1. Backups

### Primary: Railway managed backups

MySQL on Railway supports automated daily snapshots. Confirm they are enabled:

1. Railway dashboard → the MySQL service → **Backups**.
2. Ensure scheduled backups are **on** and note the retention (how many days).
3. If they are off, enable them. This is the single most important recovery
   control and must not be left unconfigured.

### Secondary: manual logical dump

Before a risky migration or as an off-platform copy, take a logical dump. Use the
same `DATABASE_URL` the app uses (from Railway → Variables):

```bash
# From the connection details in DATABASE_URL (mysql://USER:PASS@HOST:PORT/DB)
mysqldump \
  --host=HOST --port=PORT --user=USER --password=PASS \
  --single-transaction --quick --routines --triggers \
  DB > ehive-$(date +%Y%m%d-%H%M).sql
```

`--single-transaction` gives a consistent snapshot without locking the tables.
Store the dump somewhere off Railway (encrypted object storage). Dumps contain
member PII — treat them as confidential and delete old copies on a schedule.

---

## 2. Restore

### RTO / RPO targets

- **RPO (max data loss):** ≤ 24h with daily backups. Take a manual dump before
  any risky change to tighten this to near-zero for that window.
- **RTO (time to restore):** aim ≤ 1h. The bound is almost entirely the database
  restore time; the app redeploys from `main` in minutes.

### Restore from a Railway snapshot

1. Railway → MySQL service → **Backups** → choose the snapshot → **Restore**.
2. Once the database is back, redeploy the app service (or let the next deploy
   run) so `node dist/pre-deploy.js` reconciles the migration journal against the
   restored schema. The pre-deploy runner is idempotent and self-healing, so a
   restored database with a partial journal is repaired automatically.
3. Verify: `GET /api/health` should report `db: "up"`, `mail.ok: true`, and a
   recent `scheduler.lastSuccessAt`.

### Restore from a logical dump

```bash
mysql --host=HOST --port=PORT --user=USER --password=PASS DB < ehive-YYYYMMDD-HHMM.sql
```

Then redeploy and run the same `/api/health` verification.

### Rehearse it

An untested restore is a hope, not a plan. **Restore the latest backup into a
scratch Railway environment at least once** and confirm the app boots and
`/api/health` is green against it. Record how long it took — that is your real
RTO. Repeat after any major schema change.

---

## 3. Health & monitoring

- **Liveness:** `GET /api/health` → `{ status, db, mail, scheduler }`. `mail.ok`
  now reflects **live delivery** — after a real send failure (e.g. ZeptoMail
  credit exhausted) it goes `false` with the reason, so wire an uptime monitor to
  alert on it, not just on HTTP 200.
- **Readiness:** `GET /api/ready` → 200 only when the DB is reachable; use it for
  load-balancer rotation.
- Point an external synthetic monitor (e.g. an uptime service) at `/api/health`
  and alert when `db` is `down` or `mail.ok` is `false`.

---

## 4. Email delivery

- Primary transport is ZeptoMail (`ZEPTOMAIL_TOKEN` + `MAIL_FROM`, a verified
  sender). ZeptoMail is **prepaid** — if credit runs out it returns
  `429 Credit exhausted` and all mail stops. Keep credit topped up.
- Configure SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT`,
  `SMTP_SECURE`) as well: when ZeptoMail rejects a send, the mailer automatically
  falls back to SMTP, so a single-provider outage no longer drops mail silently.
- Diagnose from the admin console's **Send test email** — it surfaces the live
  transport error.

---

## 5. Operational config keys (`app_config` table)

These are runtime levers set directly in the `app_config` table (key/value). They
default to safe behaviour when unset.

| Key                            | Effect                                                                                                                                | Default |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `governance:motion_quorum_pct` | Percent of active chapter members whose vote is needed for a motion to carry; below it a closed motion is "failed".                   | 50      |
| `retention:lead_pii_days`      | Anonymise PII (email, payload) on leads older than N days. **Unset/0 = disabled** — set a positive value to enable the retention job. | 0 (off) |
| `scheduler:lastDaily`          | Internal — the distributed guard marker for the daily pass. Do not edit.                                                              | —       |

---

## 6. Deploy & rollback

- Deploys are from `main`; Railway runs `node dist/pre-deploy.js` (migrations)
  then `node dist/boot.js`, with a healthcheck on `/api/health`.
- **Rollback:** redeploy the previous known-good commit from the Railway
  dashboard. Migrations are additive and forward-only — a rollback of code is
  safe, but do **not** assume a schema change reverts; if a migration must be
  undone, write a new forward migration.
- On an uncaught exception the process now logs the stack and exits non-zero so
  Railway restarts a clean instance rather than serving from corrupted state.
