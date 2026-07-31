# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Auction House — a static landing page + property detail page for a luxury real estate auction platform. Plain HTML/CSS/JS, no framework, no build step, no package.json, no dependencies.

## Running locally

No build step. Serve the directory with any static file server:

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000`. There is no lint/test/build tooling in this repo — changes are verified by opening the pages in a browser.

## Architecture

Three pages share a header/footer shell and all load `js/main.js`; `property.html` additionally loads `js/property.js`, and `register.html` loads `js/register.js`.

- **`index.html`** — the landing page. Contains the featured hero lot and a static grid of lot `<article class="lot-card">` cards, hand-authored directly in the HTML (this is duplicated data — see below).
- **`property.html`** — a single detail-page template for *any* listing. It has no hardcoded content; `<div id="property-root">` is populated entirely by `js/property.js` at runtime based on the `?id=` query param.
- **`register.html`** — Stage 1 bidder registration (account creation). See "Registration form" below.
- **`js/main.js`** — site-wide behavior loaded on every page:
  - Bilingual BG/EN toggle (see below) — persisted to `localStorage` under `auctionhouse-lang`.
  - Light/dark theme toggle (see below) — persisted to `localStorage` under `auctionhouse-theme`, defaulting to the OS `prefers-color-scheme` on first visit.
  - Mobile nav toggle.
  - Countdown timers: reads `data-close` (ISO datetime) off any `[data-close]` element and live-updates its `[data-countdown]` child every second; tags the countdown with `[data-urgent]` inside 48 hours of close.
  - Exposes `window.AuctionHouse = { setLanguage, getLanguage, setTheme, getTheme, initCountdowns }` so other scripts (i.e. `property.js`) can reinitialize countdowns on content it injects after the fact.
- **`js/property.js`** — owns the `LISTINGS` array, the **single source of truth for all listing data** (id, title, location, price, bid type, close date, images, bilingual description, etc.). It renders the entire property detail page client-side from this array (gallery, header, price panel, key details, description, location, "similar properties").

### Important: listing data is duplicated between index.html and js/property.js

The lot cards on `index.html` are static HTML, hand-written per lot. The same listings also exist as objects in the `LISTINGS` array in `js/property.js` (used to render `property.html?id=<id>`), including a `renderLotCard()` function there that generates markup equivalent to the homepage cards (used for the "Similar Properties" section).

**When adding, editing, or removing a lot, update both places**: the `<article class="lot-card">` block in `index.html` (using the next lot number/id) and the matching object in the `LISTINGS` array in `js/property.js`. Keep `data-close`/`closeDate` (ISO 8601 with offset) and the id (`?id=011`, etc.) consistent between the two, since price, meta, and status fields aren't otherwise validated against each other.

### Bilingual content pattern (BG default / EN)

All user-facing copy is written twice, inline, using paired spans:

```html
<span data-bg>Българският текст</span><span data-en>The English text</span>
```

CSS (`.lang-bg [data-en] { display: none; }` / `.lang-en [data-bg] { display: none; }`) shows only the active language; `main.js` toggles a `lang-bg`/`lang-en` class on `<body>`. `js/property.js` builds this same pattern programmatically via its `bilingual(bg, en)` helper when generating markup. Any new user-facing string must follow this pattern in both languages — don't add English- or Bulgarian-only text.

### Color system: two accent roles

The palette is Oxford navy with **two accents that carry different jobs**. Keeping them in their lanes is what makes the page read as a luxury auction house rather than a generic blue site:

- **Royal blue** (`--color-royal`, `--color-royal-bright`) = **structure**: eyebrows, step numbers, lot counts, footer headings, focus ring, borders, hover states, active language button.
- **Champagne gold** (`--color-brass`, `--color-brass-bright`) = **value**: prices, countdowns, the primary CTA (`.btn-brass`), the `em` emphasis word in headings, the logo mark, lot-number chips, the featured card glow, and the price panel's top edge.

Gold is deliberately scarce — that scarcity is the effect. When adding a new accented element, ask whether it is *structure* or *value* and use the matching token; defaulting everything to gold is what made an earlier revision look cheap.

`--color-royal` is a fill/border color only — it does **not** pass contrast as text on the page background. Use `--color-royal-bright` for any blue text.

### Light/dark theme

`:root` holds the dark theme (default); `body.theme-light` overrides only the tokens that must flip. Four tokens are intentionally *not* overridden, because their surfaces stay dark in both modes:

- `--color-band` / `--color-on-band` — the stats band stays a deep navy contrast block in light mode too.
- `--color-urgent` / `--color-on-urgent` — the "Closing Soon" chip sits on top of a photo, so it keeps its amber fill and dark ink regardless of page theme.

Note the naming quirk: in the light theme `--color-brass-bright` and `--color-royal-bright` are *darker* than their base tokens. "Bright" means "more prominent," not literally lighter — these are the text-safe variants in each theme.

Urgency is signalled by **hue and weight together** (`.lot-countdown[data-urgent]` gets `font-weight: 500`), because amber and champagne sit adjacent in every lot card's price row and are close in luminance.

`main.js` toggles `theme-dark`/`theme-light` on `<body>` via `.theme-toggle` buttons (sun/moon SVGs swapped by CSS on the body class) in the header and mobile nav. Prefer existing tokens over new hardcoded hex values so both themes stay correct.

### Registration form (`register.html` + `js/register.js`)

**Stage 1 only — account creation.** ЕГН, ID documents and proof of funds are deliberately *not* collected: this is a static site with nowhere lawful to store them. That split is intentional; don't "complete" the form by adding them without a backend.

**Nothing is submitted.** There is no server, so `submit` is stubbed and the success notice says plainly that no account was created. Do not replace it with a fake success message — it would lie to the user about a password they just typed.

Everything in `register.js` is a **UX control, not a security control**. Every rule must be re-run server-side before it can be trusted — see **`docs/server-validation.md`** for the matching server spec (endpoint contract, normalisation order, enumeration resistance, retention, and the CI parity-testing requirement that keeps the two from drifting).

Key decisions worth preserving:

- **`novalidate` is required, on every form.** Native constraint-validation bubbles render in the *browser's* locale and ignore the site's БГ/EN toggle. The same applies to the landing-page CTA form, validated in `main.js`.
- **Error messages are injected as paired `data-bg`/`data-en` spans**, so switching language is handled by the existing CSS alone — no re-render, no stale-language errors. `display:none` also hides the inactive copy from screen readers, so this stays a11y-correct. Note this only works for *content*; `aria-label`, `placeholder` and `setCustomValidity()` are plain strings and would need `AuctionHouse.getLanguage()`.
- **Names accept Cyrillic and Latin** via `\p{L}` — an `[A-Za-z]` pattern is a guaranteed defect on a Bulgarian site.
- **Dates are parsed from `YYYY-MM-DD` parts, never `new Date(string)`**, which parses as UTC and shifts the day backwards east of Greenwich — the off-by-one that lets 17-year-olds through. The "18th birthday is today" case must pass.
- **ЕИК/BULSTAT** uses the real two-pass mod-11 checksum (9- and 13-digit forms).
- **Phone** is permissive by design (BG mobile, BG landlines of varying length, and generic E.164 for foreign bidders); real validation is possession via SMS OTP server-side.
- **Password follows NIST SP 800-63B**: length over composition, no forced character classes, no rotation, ≥64 accepted, and paste is never blocked. The breach check that matters needs a server.
- **Consent checkboxes are unticked** and marketing is separately refusable — pre-ticked consent is invalid under GDPR.
- **Errors never rely on colour alone** — `.field-error` carries a `⚠` glyph via `::before` plus `aria-invalid` and `aria-describedby`.
- Hidden company fields are **cleared and their errors dropped** on account-type switch; leaving a hidden field invalid produces a form that won't submit with no visible reason.

### Images

`js/property.js` supports two image sources per listing, both handled by `imageMarkup()`:
- A real photo: a path string like `'assets/images/dvustaen-ribbon.jpg'` → renders an `<img>`.
- A placeholder: `'gradient:<css-class>'` (e.g. `'gradient:lot-image-2'`) → renders a `<div>` styled by that CSS class (gradients defined in `css/styles.css`) for lots that don't have a real photo yet.

### Styling

Single stylesheet at `css/styles.css`, token-driven via CSS custom properties defined in `:root` (colors, fonts, container width, transitions). Respects `prefers-reduced-motion` globally. No CSS build step/preprocessor — edit the file directly.
