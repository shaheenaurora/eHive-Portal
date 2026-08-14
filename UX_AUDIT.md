# eHive Public Website — UX & Product Design Audit

**Date:** 2026-08-13  
**Repository:** `https://github.com/shaheenaurora/eHive-Portal`  
**Scope:** Public marketing website (`public/`): landing page, pillar pages, conversion flows, design system, motion, accessibility, mobile/responsive UX.  
**Audited files:** `public/index.html`, `public/styles.css`, `public/app.js`, `public/apps.css`, `public/apps.js`, plus all `.html` pages in `public/`.

---

## Executive Summary

The eHive public site has a clean visual foundation and some strong sections (the Circle waitlist, the Pillars grid, the booking card), but it currently behaves like **two different products**: the homepage is a self-contained light-theme experience with inline styles, while every other page uses a shared dark navy/gold design system. This fracture is the root of most UX problems.

For an ERP-grade portal, the site needs to feel **cohesive, trustworthy, and conversion-oriented**. Right now it is visually polished but conversion-weak: the value proposition is abstract, high-intent visitors lack a direct “talk to us” path, several sections dead-end without a next action, and there are material accessibility and form-UX risks.

**Primary recommendation:** unify the homepage onto the shared 2026 design system, then restructure the landing page around concrete outcomes and clear CTAs.

---

## 1. Design System & Visual Identity

### 1.1 Two competing design systems

| Aspect      | Homepage (`index.html`)                          | Rest of site                                   |
| ----------- | ------------------------------------------------ | ---------------------------------------------- |
| Theme       | Light paper (`#f3f1ea`) + navy ink               | Dark navy (`#0b1526`) + gold                   |
| Accent name | `--flag: #da3a22`                                | `--gold-500: #da3a22`                          |
| CSS         | ~1,200 lines inline                              | `styles.min.css` / `apps.min.css`              |
| Buttons     | `.btn-fill`, `.btn-flag`, `.btn-line`, `.btn-sc` | `.btn-primary`, `.btn-secondary`, `.btn-ghost` |
| Nav         | Sticky header with custom markup                 | Shared `.site-nav`                             |
| Footer      | Custom layout, no Privacy/Terms                  | Shared footer with legal links                 |

**Impact:** Users land on a page that looks and behaves differently from the pages they navigate to. This undermines trust for a premium B2B/ERP positioning.

**Recommendation:**

- **Short term:** Rebuild `index.html` on `styles.css`/`apps.css`/`app.js` with the shared nav and footer.
- **Long term:** Remove the inline CSS/JS entirely and componentize nav/footer so they cannot drift.

### 1.2 Color accessibility failures (Critical)

The dark-theme accent `#DA3A22` fails WCAG AA for normal text on navy backgrounds:

| Foreground | Background | Ratio | WCAG AA normal |
| ---------- | ---------- | ----- | -------------- |
| `#DA3A22`  | `#0B1526`  | 4.01  | ❌ fails       |
| `#DA3A22`  | `#0F1C3A`  | 3.69  | ❌ fails       |
| `#DA3A22`  | `#16264C`  | 3.26  | ❌ fails       |
| `#E4573F`  | `#0B1526`  | 4.99  | ✅ passes      |

This affects eyebrows, prices, stat labels, tags, and primary CTAs across `business-setup.html`, `consulting.html`, `circle.html`, etc.

Low-opacity ivory text is also widely below readable contrast (e.g. `.stat-num` at 34 % opacity, `.tstat b` at 35 % opacity).

**Recommendation:**

- Use `--gold-400` (`#E4573F`) for all accent **text** and foreground elements.
- Reserve `--gold-500` (`#DA3A22`) for large decorative strokes, hover states, or light-background CTAs.
- Never drop ivory text below ~78 % opacity on dark navy; introduce a solid muted token instead of relying on opacity.

### 1.3 Typography tokens are misleading

- `--font-mono` is set to `Archivo` (a grotesque sans, not monospace).
- `--serif` points to `--font-display`, which is also Archivo.
- A stale comment says _“Georgia headings, Calibri body”_ while the actual code uses Archivo/Hanken Grotesk.

**Recommendation:** Rename `--serif` → `--font-display`; fix or remove the stale comment; decide whether a real serif is part of the brand expression.

### 1.4 CSS architecture is unmaintainable

`styles.css` is 7,563 lines with duplicated component blocks: `.btn` is defined 4+ times, `.eyebrow` 3+ times, `footer` 3+ times, `.page-hero` 2+ times.

**Recommendation:** Refactor into:

- `tokens.css` — colors, type, spacing, motion
- `components.css` — buttons, cards, nav, footer, forms
- `pages/*.css` — only page-specific overrides

### 1.5 Favicon color drift

The homepage favicon uses `#DA3A22`; other pages use `#D4A24C` — a color that does not appear in any CSS token.

**Recommendation:** Generate favicons from a single SVG source using the chosen brand accent.

---

## 2. Landing-Page Conversion & Information Architecture

### 2.1 Hero value proposition is abstract

Current H1 (`index.html:994–997`):

> “Every successful business has one thing in common. It doesn't grow alone.”

A visitor cannot tell in five seconds what eHive is, where it operates, or what they will get.

**Recommendation:** Rewrite to foreground outcome and geography:

> “Start, run, and scale your UAE business — with setup, consulting, and a founder community in one place.”

Add a tertiary CTA above the fold: **“Book a free consultation”** (mirroring `business-setup.html` and `consulting.html`).

### 2.2 Hero stats are structural, not outcome-based

Current stats: 1 ecosystem, 6 products, 4 tiers.

**Recommendation:** Swap or supplement with proof points that reduce risk:

- “Dubai-based · UAE-wide”
- “Founded by operators”
- “Vetted specialists”
- Real numbers when available: founders served, businesses formed, NPS.

### 2.3 No customer social proof on the homepage

The only “voice” is a quote from the founder. The `.proof` CSS block exists but is unused.

**Recommendation:**

- Activate `.proof` or replace the founder-only “Voices” block with a mixed social-proof section.
- Until real testimonials exist, use the honest placeholder pattern from `circle.html` but styled as social proof, not an empty slot.
- Add a trust bar below the hero (model: `business-setup.html:127–154`).

### 2.4 Several sections dead-end without a next action

| Section            | Location               | Missing action       |
| ------------------ | ---------------------- | -------------------- |
| Manifesto / Belief | `index.html:1049–1065` | No next step         |
| What eHive is      | `index.html:1068–1089` | No next step         |
| How it works       | `index.html:1170–1217` | No CTA after 4 steps |
| Voices             | `index.html:1220–1241` | No CTA after quote   |

**Recommendation:** End every section with a contextual CTA:

- Manifesto → “See how it works →”
- What eHive is → “Explore the ecosystem →”
- How it works → “Find your door →” (`get-started.html`)
- Voices → “Join the founders building here →” (`circle.html`)

### 2.5 No risk reversal near CTAs

Primary CTAs lack reassurance: no “no obligation”, “free consultation”, data-privacy, or money-back language.

**Recommendation:** Add microcopy under primary CTAs:

- Hero: _“No commitment. Two-minute pathfinder.”_
- Circle waitlist: _“No charge to apply. Vetting is a conversation, not a filter.”_
- Book a sprint: _“No charge — a conversation, not a commitment.”_

### 2.6 Lead capture is buried

Email capture only appears in the footer.

**Recommendation:** Move a higher-value lead magnet above the fold or after the Pillars section, e.g.:

> _“Get the UAE Business Setup Cost Guide + founder updates.”_

---

## 3. Pop-ups, Lead Capture & Forms

### 3.1 Homepage does not use the shared modal stack

`index.html` does not load `app.js`/`styles.css`, so the Scorecard/Brand-Check modal logic never runs there. The homepage “Take the Scorecard” link does a full-page navigation while sub-pages open a modal.

**Recommendation:** Load the shared CSS/JS on the homepage, or copy the modal IIFEs into the inline script. Unify the behavior.

### 3.2 Modals lack focus traps

Scorecard, Brand-Check, Pathfinder, and Command-Palette dialogs close on `Escape` but do not trap keyboard focus. Users can Tab outside the modal.

**Recommendation:**

- Add `keydown` focus-loop logic.
- Move focus to the first focusable element on open.
- Return focus to the triggering element on close.

### 3.3 Misleading success states on backend failure

The Get Started wizard and booking form show a “You’re all set / request is ready” panel even when `submitLead` errors.

**Locations:**

- `app.js:1029–1035`
- `app.js:1285–1313`
- `get-started.html:443–471`
- `book.html:253–284`

**Recommendation:** Render a distinct failure panel with a retry CTA. Do not show checkmark icons for failed submissions.

### 3.4 No loading or disabled state during submission

Buttons remain active while `fetch` is in flight; users can double-submit.

**Recommendation:** Disable the button and swap its label to _“Sending…”_ / _“Confirming…”_ during submission.

### 3.5 Weak validation and missing privacy signals

- Email regex is `/.+@.+
.+/`, accepting `a@b.c`.
- Phone fields have no validation.
- No privacy-policy or consent copy appears beside email fields.

**Recommendation:**

- Use `type="email"` plus a stricter regex.
- Add phone validation for UAE/international formats.
- Add a one-line privacy note under every email field.

### 3.6 Booking form ignores native submit

`#bkConfirm` is `type="button"`; pressing `Enter` in the form does nothing.

**Recommendation:** Convert the booking card to a real `<form>` and listen for `submit`.

### 3.7 WhatsApp is a placeholder

`WA_NUMBER = null` and multiple pages show `<span class="soon-chip">WhatsApp — at launch</span>`.

**Recommendation:** Either wire a real WhatsApp number or hide the chips until launch.

---

## 4. Mobile & Responsive UX

### 4.1 Minified CSS is stale

Pages load `styles.min.css` / `apps.min.css`, but both are older than the source files. Recent fixes are not shipped.

**Recommendation:** Rebuild minified assets from source before every deploy, or reference the unminified files in development.

### 4.2 Homepage mobile menu lacks overlay/scroll lock

`index.html:970–983` uses a relative-positioned menu. It does not lock body scroll or close on overlay tap.

**Recommendation:** Align with the rest of the site: full-screen fixed overlay, body scroll lock, close on overlay tap.

### 4.3 Booking day grid touch targets can be cramped

Days collapse to 4 columns below 560 px but may still be smaller than 44 × 44 px.

**Recommendation:** Add a 320 px breakpoint stacking 2–3 days per row with minimum 44 px touch targets.

### 4.4 No sticky mobile CTA

On sub-pages, the primary “Get Started” button disappears into the hamburger menu on mobile.

**Recommendation:** Add a sticky bottom bar on key conversion pages (Business Setup, Consulting, Circle) with primary “Get Started” and secondary “Book a call” actions.

---

## 5. Navigation & Cross-Page Consistency

### 5.1 Navigation labels drift

- Homepage calls the blog **“Journal”**; other pages use **“Insights — The Hive Journal”**.
- `consulting.html` adds a **“Brand Check”** nav item absent everywhere else.
- `aria-current="page"` is only hard-coded on some pages; `app.js` dynamic matching misses `/`, `book.html`, `get-started.html`, `about.html`, `insights.html`.

**Recommendation:**

- Standardize on one label everywhere.
- Decide whether Brand Check belongs globally.
- Normalize paths in `app.js:88` so `/` maps to `index.html` and all pages get correct active states.

### 5.2 Broken links

| Link                                | Problem                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `/login`                            | Referenced site-wide but static hosting 404s; `login.html` exists but redirects to `/login` |
| `/insights/`                        | Linked from `insights.html` but no directory exists                                         |
| `book.html?product=clarity-sprint`  | Wrong product for GapNavigator (`consulting.html:478`)                                      |
| `book.html?product=strategy-sprint` | Wrong product for Brand 3D (`consulting.html:523`)                                          |
| `home-v2.html`                      | Empty placeholder (451 bytes)                                                               |

**Recommendation:**

- Change `/login` → `login.html` site-wide (or add a server rewrite).
- Fix `/insights/` links or create the directory.
- Correct the two consulting booking URLs.
- Delete or finish `home-v2.html`.

### 5.3 Footer inconsistency

`index.html` footer lacks Privacy/Terms, uses a different newsletter form, and shows social platforms as plain text (`<span class="soc-soon">`).

**Recommendation:**

- Replace the homepage footer with the shared footer from `about.html`/`book.html`.
- Replace placeholder social spans with real `<a>` links or remove the row.

### 5.4 No page transitions or prefetching

Every click is a full reload with no prefetch, view transitions, or loading indicator.

**Recommendation:**

- Add `<link rel="prefetch">` for likely next pages (e.g. from `index.html` to `get-started.html`, `consulting.html`, `business-setup.html`).
- Consider a lightweight page-loading indicator once the design system is unified.

---

## 6. Motion & Animation

### 6.1 Homepage duplicates animation logic

`index.html:1487–1521` has its own IntersectionObserver reveals and count-up logic. It does not respect `prefers-reduced-motion` for count-up.

**Recommendation:** Move the homepage onto `app.js` or add `matchMedia('(prefers-reduced-motion: reduce)')` checks to the inline script.

### 6.2 Continuous ambient motion

- Infinitely spinning rings (`styles.css:3815–3835`).
- Pulsing Concierge FAB (`apps.css:214`).
- Ken Burns image banner (`styles.css:2258–2307`).

These are tasteful but can distract. The global `prefers-reduced-motion` media query exists and should be verified for all three.

### 6.3 Scroll reveals feel slow

Reveals use `1.05s` duration with 36 px slide and 7 px blur.

**Recommendation:** For an ERP audience, reduce to ~0.6–0.8s and 3–4px blur to feel crisper.

---

## 7. Hero & Banner Imagery

### 7.1 Homepage hero is conceptually strongest

`assets/img/ehive-hero.svg` combines a Gulf skyline with network nodes and aligns with the “ecosystem” narrative. However, it is the only photographic/illustrative hero.

### 7.2 Interior page hero SVGs feel repetitive

`business-setup.html` and `consulting.html` embed nearly identical lattice SVGs. `about.html`, `circle.html`, and `get-started.html` use thin-line motifs that read as wireframes.

**Recommendation:** Extend the skyline/network illustration language across pillar pages with bespoke chapter imagery, or unify on a consistent photographic/video treatment.

### 7.3 Cinematic image banner uses continuous motion

The `.img-banner img` Ken Burns loop should pause when off-screen and respect reduced motion.

---

## 8. Severity Summary

| Severity     | Count | Examples                                                                                                                                                                |
| ------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Critical** | 6     | Two design systems; accent contrast failure; stale minified CSS; misleading success states; missing focus traps; homepage off shared stack                              |
| **High**     | 8     | No customer social proof; abstract hero value prop; dead-end sections; weak validation; no sticky mobile CTA; broken `/login`; inconsistent nav/footer; no privacy copy |
| **Medium**   | 6     | Continuous ambient motion; slow reveals; placeholder WhatsApp; no prefetch; footer social placeholders; booking grid touch targets                                      |
| **Low**      | 3     | Favicon color drift; `home-v2.html` stub; px/rem mixing                                                                                                                 |

---

## 9. Quick Wins vs. Redesign Items

### Quick wins (can ship in 1–2 sprints)

1. **Rebuild minified CSS/JS** from current source files.
2. **Fix broken links:** `/login` → `login.html`, `/insights/`, wrong booking product URLs in `consulting.html`.
3. **Rewrite hero H1 and lede** on `index.html` to be concrete and outcome-focused.
4. **Add a “Book a free consultation” CTA** to the hero and to dead-end sections.
5. **Add risk-reversal microcopy** under primary CTAs.
6. **Fix misleading post-submit copy** in `#bkDone` and `#gsErr` panels.
7. **Disable buttons and show “Sending…”** during `submitLead` calls.
8. **Strengthen email validation** and add privacy notes under every email field.
9. **Standardize nav labels** — pick “Insights” or “Journal”; decide on Brand Check globally.
10. **Fix active-state matching** in `app.js` for all pages including `/`.
11. **Fix dark-theme accent text** — replace `--gold-500` with `--gold-400` for foreground usage.
12. **Raise low-opacity ivory text** to ≥78 % or use solid muted tokens.

### Larger redesign items (need planning)

1. **Rebuild `index.html` on the shared 2026 design system** — external CSS, shared nav/footer, shared JS. This is the single biggest lever for cohesion.
2. **Componentize nav and footer** into a build step or server-side include so they cannot drift.
3. **Refactor `styles.css`** into tokens/components/pages.
4. **Unify hero art direction** across all pillar pages.
5. **Build a real social-proof section** with testimonials, case studies, and partner logos.
6. **Add a homepage FAQ/objection-handling section**.
7. **Implement robust focus traps** and screen-reader announcements across all modals and wizards.
8. **Design a sticky mobile CTA bar** for conversion pages.
9. **Resolve typography strategy** — serif vs. sans, real font tokens.
10. **Formalize motion tokens** (duration, easing, stagger) and apply consistently.

---

## 10. Product-Design Roadmap (recommended order)

### Phase 1 — Unify & stabilize (week 1–2)

- Rebuild `index.html` on shared CSS/JS.
- Fix broken links, stale minified assets, and booking URL bugs.
- Unify nav/footer across all pages.
- Fix critical color-contrast and accessibility issues.

### Phase 2 — Conversion (week 2–3)

- Rewrite hero value proposition.
- Add outcome proof and social proof.
- Add CTAs to dead-end sections.
- Add risk-reversal microcopy and privacy notes.

### Phase 3 — Trust & motion (week 3–4)

- Add FAQ/objection handling.
- Implement real loading/error states in forms.
- Improve focus traps and screen-reader support.
- Tighten motion timing and ensure reduced-motion support everywhere.

### Phase 4 — Scale (month 2)

- Componentize CSS and templates.
- Add sticky mobile CTAs.
- Build real testimonials/case studies.
- Add prefetch/page-transition strategy.

---

## Bottom Line

The website looks professional but is not yet cohesive or conversion-optimized. The highest-leverage changes are:

1. **Unify the homepage with the rest of the site** (fixes the “two products” problem).
2. **Make the hero concrete and outcome-focused** (fixes the 5-second comprehension test).
3. **Fix accessibility and form UX** (focus traps, loading states, failure states, validation).
4. **Add trust and action to every section** (social proof, risk reversal, CTAs).

These changes will move the site from “polished brochure” to “ERP-grade conversion experience.”
