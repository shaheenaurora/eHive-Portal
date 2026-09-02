# eHive Portal — Remaining P2 Follow-ups

This document tracks the gaps from `GAP_ANALYSIS.md` that are intentionally deferred to a follow-up sprint. All P0/P1 blockers and ERP-grade functionality have been implemented and verified (`npm run check`, `npm run test`, `npm run build` pass).

## 1. CSP `style-src` — remove `'unsafe-inline'`

**Gap:** CSP currently allows inline styles (`'unsafe-inline'`) because the React/Tailwind SPA and several static marketing pages inject styles at runtime through `style` attributes and `<style>` blocks.

**Why deferred:** Removing `'unsafe-inline'` requires either:

- Nonces generated per request (difficult with a Vite-built SPA served as static files), or
- A full audit and migration of all inline `style` attributes in ~300+ React components and public HTML/JS to CSS classes.

Either approach is a large, high-risk UI refactor that should be done in a dedicated branch with visual regression testing.

**Recommended plan:**

1. Introduce a request-time nonce for server-rendered marketing pages and move their inline `<style>` blocks to external CSS or nonced blocks.
2. Audit the portal bundle for inline `style` props using an ESLint rule (`react/forbid-dom-props` or custom).
3. Migrate static inline styles to Tailwind utility classes or scoped CSS modules.
4. Add `style-src` hashes only for the few unavoidable inline styles, then drop `'unsafe-inline'`.
5. Verify with browser dev-tools CSP reports and add a `report-uri` endpoint.

**Files involved:** `api/boot.ts` (CSP builder), `public/*.html`, all `src/**/*.tsx` components.

## 2. Franchise readiness — UI and advanced workflows

**What already exists (partial implementation):**

- Org-unit hierarchy (`org_units`, `unit_roles`) and regional officer roles.
- Regional officer router with chapter overview, detail, council meetings, and finance reports (`api/officer/regional.ts`).
- Chapter budget, expenses, and event budget remaining logic (`api/lib/chapter-budget.ts`, `api/officer/finance.ts`).
- Admin finance scoped by chapter and org unit (`api/admin/finance.ts`).
- Franchise readiness checklist backend: `api/lib/franchise-readiness.ts` + `admin.chapters.franchiseReadiness` tRPC endpoint + tests.

**Remaining work:**

1. **Admin UI for readiness:** Surface the `admin.chapters.franchiseReadiness` score in `AdminChapters.tsx` (e.g., a per-chapter readiness badge and a detail drawer showing the checklist).
2. **Chapter P&L statement:** Build a dedicated chapter P&L view that rolls up membership revenue (from `paymentRecords` joined through `members.homeChapterId`), expenses (`chapterBudgets` spend rows), invoices, and credit notes.
3. **Budget carry-forward:** Add year-end logic to copy unspent approved allocations into the next fiscal year's opening balance.
4. **Franchisee onboarding checklist:** Persist a launch checklist per chapter (legal entity, bank account, brand kit, policy acks, first event) and track completion.
5. **Centralised policy distribution:** Allow policies to be assigned by chapter/region and track acknowledgement completion in a compliance dashboard.
6. **Chapter-level RBAC policy templates:** Let regional directors delegate scoped admin abilities (finance, events, membership) to chapter officers without granting full admin access.

**Recommended next step:** Build the AdminChapters readiness UI and the chapter P&L query, as these deliver the highest immediate value with existing schema.

## 3. World-class public-site UX / motion

**Gap:** Public site still relies on large static hero images and lacks the scroll-driven motion, micro-interactions, and benchmark-quality visual polish the user wants (reference: bcgbrighthouse.com).

**Why deferred:** A full redesign with animations, WebGL/Canvas interactions, and revised information architecture is a product-design project that should be specced separately.

**Recommended plan:**

1. Audit each public page against a design system and consolidate colours/typography.
2. Replace hero images with CSS gradients or smaller, art-directed imagery.
3. Add scroll-triggered reveal animations (e.g., Intersection Observer + CSS transitions) for sections and CTAs.
4. Add interactive elements (hover states, accordion FAQs, tabbed vertical pages) to reduce wall-of-text feel.
5. Verify mobile responsiveness and performance (Lighthouse) after changes.

## 4. Mobile UX polish

**Gap:** Although pages are responsive, mobile-specific UX (touch targets, bottom sheets, swipe gestures, reduced-motion) has not been systematically reviewed.

**Recommended plan:** Run a mobile audit on the portal and public site, fix tap-target sizes, and add bottom-sheet variants for modal dialogs on small screens.

## 5. Scheduled report subscriptions

**Gap:** Reports are generated manually; admins cannot subscribe to weekly/monthly email reports.

**Recommended plan:** Add a `report_subscriptions` table, a cron/scheduler job, and email templates for finance and membership reports.

## 6. CI / security hardening

**Gap:** CI does not build the Docker image or run security scans; docker-compose lacks healthchecks/resource limits.

**Recommended plan:** Add a GitHub Actions workflow that builds the Docker image, runs `npm run check && npm run test && npm run build`, and scans with Trivy or docker-scout. Update `docker-compose.yml` with healthchecks, `mem_limit`, and log rotation.
