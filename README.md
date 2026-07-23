# eHive Circle — Website + Member Portal + Admin Portal

The complete eHive web platform: the 18-page marketing site, the eHive Circle
member portal, and the admin portal that runs the community — one full-stack app.

## What's inside

| Area | URL | What it is |
|---|---|---|
| Marketing site | `/`, `/*.html` | 18 static pages (verbatim, unchanged URLs) |
| Member portal | `/portal/*` | React SPA — dashboard, pods, events, Hive Score, FRP, governance, library, offers, membership, application flow |
| Admin portal | `/admin/*` | React SPA (role-gated) — applications screening, member 360°, pods/sessions/attendance, events, score engine, FRP reviews, governance, library, offers, website leads |
| API | `/api/trpc/*` | tRPC 11, end-to-end typed |
| Lead capture | `POST /api/lead` | Marketing forms land in the admin Leads inbox |
| Auth | Kimi OAuth | `kimi_sid` JWT cookie; owner unionId auto-gets admin |

## Stack

React 19 + TypeScript + Vite (MPA: marketing from `public/`, SPA entry `portal.html`)
· Tailwind + custom eHive design system (`src/index.css`, `.eh-*`)
· Hono + tRPC + Drizzle ORM + MySQL
· Kimi OAuth 2.0

## Run locally

```bash
npm install
npm run db:push     # sync schema to MySQL (uses DATABASE_URL from .env)
npx tsx db/seed.ts  # demo data: members, pods, events, policies, library…
npm run dev         # http://localhost:3000
```

Production: `npm run build && npm start` — or build the included Dockerfile.

## Roles

- Any Kimi sign-in creates a `users` row.
- The account whose unionId matches `OWNER_UNION_ID` becomes **admin** automatically.
- Admin grants access to `/admin/*` (enforced server-side on every procedure).

## Domain model (BRD §9 community vertical)

- **Membership** — application → screening workflow (received → screening → interview →
  approved/rejected); approval creates the member. Tier changes, pause, cancel and renew
  are all recorded as membership events.
- **Pods & masterminds** — rosters, recurring sessions with video links, attendance
  (feeds the Hive Score), shared session notes, action items with owners and due dates.
- **Hive Score** — six weighted factors (attendance 30, action items 20, events 15,
  contribution 15, FRP 10, tenure 10). Weights are admin-configurable caps on a raw
  points ledger; every change recomputes the cached score and writes a history snapshot
  with a full breakdown.
- **FRP** — tier-gated cohorts, six-dimension readiness self-assessment, and the
  deck / model / data-room milestone review workflow.
- **Governance** — bodies, seats with terms, published minutes, versioned policies
  with member acknowledgment.
- **Events & library** — tier-gated everywhere; registrations and attendance feed
  the score.

## Useful scripts

| Command | Purpose |
|---|---|
| `npm run check` | Type-check everything (must stay clean) |
| `npm run build` | Vite frontend + esbuild backend bundle |
| `npm start` | Production server on :3000 |
| `npm run db:push` | Sync Drizzle schema to MySQL |
| `npx tsx db/seed.ts` | Reset + seed demo data |
