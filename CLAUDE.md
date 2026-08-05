# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## What this is

**Auction House** — a real-estate auction platform for the Bulgarian market: Next.js 15 (App Router), React 19, TypeScript, PostgreSQL via Prisma.

**`docs/architecture.md` is the authoritative spec.** Read it before starting anything substantial; it defines the lot lifecycle, the soft-close engine, the data model and the build order. **`docs/server-validation.md`** is the companion spec for bidder registration and remains binding.

The v1 static prototype (`index.html`, `css/`, `js/`) has been removed. Everything it established that was worth keeping — the design tokens, the bilingual pattern, the ЕИК and phone validators, the countdown format — now lives in `src/`.

## Running it

```bash
npm run dev            # http://localhost:3000
npm run db:migrate     # apply migrations
npm run db:seed        # demo catalogue; idempotent, refreshes relative dates
npm test               # unit (vitest)
npm run test:e2e       # e2e against next dev
npm run test:e2e:prod  # builds first, then runs against next start
npm run clean          # clear .next
```

PostgreSQL must be running on `localhost:5432` — the e2e suite hits the real database.

**Run `npm run clean` when switching between the dev and prod e2e suites.** The prod run leaves a production build in `.next`, and the dev run then recompiles from it slowly enough to produce dozens of spurious failures.

**Check nothing else holds port 3000.** If something does, Next silently binds 3001 while Playwright waits on 3000, and the run produces no output at all rather than an error.

## What exists (Phase 1 complete)

**Public catalogue** — lot index and detail pages, driven by the database, bilingual on separate URLs.
**Admin** — property and lot CRUD, image upload, legal-pack documents, viewing slots, publish workflow.
**Bidder accounts** — registration with email verification, sign-in, viewing bookings.

Not built: bidding itself, deposits, bidder approval (Phase 2), the soft-close engine (Phase 3).

## Architecture notes worth knowing before changing things

### Two root layouts

`src/app/(public)/[locale]/layout.tsx` and `src/app/(admin)/layout.tsx`. Only one component may own `<html>`, and the public one needs `params.locale` for its `lang` attribute, which a shared root cannot read. Route groups are URL-invisible, so `/admin/login` is still `/admin/login`.

### Route-based locales

`/bg/...` and `/en/...`, one language per URL, with real `hreflang` alternates. This replaced v1's render-both-and-hide-with-CSS approach, which doubled the DOM and showed search engines both languages in one document.

Dictionaries are typed objects read as `t.lot.closesIn`, never `t("lot.closesIn")` — a renamed key must be a build error, not `undefined` in the page.

### Two session kinds, one Auth.js instance

Operators come from `admin_users`, bidders from `users`. The session carries `kind: "admin" | "bidder"`, and **`requireAdmin()` asserts it** rather than inferring authority from a role field being present. Middleware checks it too. Never write a check that reasons "it has a role, so it must be staff".

### The reserve price never leaves the server

`docs/architecture.md` §3 invariant 7. Enforced structurally: `src/server/catalogue/select.ts` holds Prisma `select` allowlists that omit it, and the mappers type their input off those selects, so reading it does not compile. Never use `include` or a bare `findMany` for public lot queries.

`src/server/catalogue/admin.ts` may read it — and must never be imported by anything under `src/app/(public)`.

### Mappers are the serialization boundary

Prisma rows carry `bigint`, `Prisma.Decimal` and `Date`. All three break when passed to a client component. Everything crossing out of `src/server/catalogue/mappers.ts` is a string, number or plain object. Money crosses as a decimal string of minor units, never a number.

The same rule applies in the admin: pass plain values to client components, not rows.

### Preview and bidding are different phases

`derivePhase()` turns `LotStatus` into a discriminated union. A `PUBLISHED` lot counts down to `biddingOpensAt` and must offer **no bid affordance at all**; `BIDDING_OPEN` and `EXTENDING` count down to `effectiveCloseAt`. Components read `phase.kind` and never inspect `status` themselves.

It derives from the stored status, not from comparing timestamps to the clock — the soft-close engine will own those transitions.

### Countdowns use server time

`/api/time` plus a provider that syncs once per page and corrects for the round-trip midpoint. The device clock supplies elapsed time only. The timestamp is deliberately not embedded in page HTML: cached output would make the offset wrong by the cache age.

### Money and dates

Money is `bigint` minor units; `src/lib/money.ts` is the only place it is formatted. There is no currency column — everything is EUR, as one constant.

All absolute dates are formatted **server-side** in `Europe/Sofia` and cross to the client as strings. The only browser time arithmetic is the countdown, which is a duration and therefore timezone-free. This removes the whole hydration-mismatch class.

Age is computed by integer comparison of civil calendar parts in Sofia, so no offset or DST transition can perturb it. The "18th birthday is today" case must pass.

### Media versus documents

**Property photographs** are public marketing assets: `media/`, served by `src/app/media/[...key]/route.ts` with no auth.

**Legal-pack documents** are not: `private/`, gitignored, served only through `src/app/api/documents/[id]/route.ts` with a signed short-lived link, entitlement re-checked per request, `Content-Disposition: attachment` unconditionally. Never render a user-supplied PDF inline from our own origin — that is same-origin XSS. The route answers 404, never 403, because "this exists and you cannot have it" is itself a disclosure.

Neither lives in `public/`. Next serves that directory from a manifest built at build time, so anything written there at runtime is invisible to `next start` — uploads worked in dev and 404'd in production.

### Uploads

Format is decided by magic bytes, never the filename or the browser-supplied type. Photographs are re-encoded through sharp, which strips EXIF — a camera JPEG of a property carries the coordinates it was taken at, often the seller's home. Documents are stored byte-identical, because a legal document must stay what the notary produced; its sha256 is recorded so that can be proven.

### Colour: two accent roles

Royal blue is **structure** (borders, focus, hover, labels, counts). Champagne gold is **value** (prices, countdowns, primary CTA, logo). Gold is deliberately scarce — that scarcity is the effect. Ask whether a new element is structure or value and use the matching token.

`--color-royal` is a fill/border colour only; use `--color-royal-bright` for blue text. In the light theme the `-bright` variants are *darker* — "bright" means "more prominent", not lighter. Do not "fix" this.

Four tokens deliberately do not flip between themes: `--color-band`, `--color-on-band`, `--color-urgent`, `--color-on-urgent`.

`src/styles/tokens.css` is the single source. `admin.css` maps those onto `--admin-*` names; it must not restate the values.

### Forms

`novalidate` on every form. Native constraint bubbles render in the browser's locale and ignore the site's language, and leaving them on means the server rules never get exercised.

Errors never rely on colour alone — a `⚠` glyph plus `aria-invalid` and `aria-describedby`. Consent checkboxes start unticked and marketing is separately refusable; pre-ticked consent is invalid under GDPR.

When two forms share a page, give their fields distinct DOM ids. Duplicate ids mean the label points at whichever element comes first.

### Registration is Stage 1 only

Account creation. ЕГН, identity documents and proof of funds belong to Stage 2, behind manual review. The API returns **error codes, never prose** — the client owns the copy so it can render in either language.

Duplicate and new addresses are indistinguishable in status, body **and timing**. Both paths do the Argon2 work and are padded to a common floor. Do not add a "check email availability" endpoint; it is an enumeration oracle by construction.

Passwords follow NIST SP 800-63B: length over composition, no character-class rules, no rotation, all printable Unicode. There is a test asserting no composition rules exist — that is deliberate.

## Testing

`tests/unit` (vitest) for pure logic; `tests/e2e` (Playwright) for behaviour and security boundaries. `tests/fixtures/registration-cases.json` is the shared parity matrix from `docs/server-validation.md` §9 — the unit tests read it rather than restating its cases.

Specs that create data clean up after themselves. **Deleting a row that owns a file is not the same as deleting the file** — that has leaked twice.

The e2e suite is strong on behaviour and blind to layout. Twice a whole suite was green while a page rendered with no shell at all. Screenshot the result when the change is visual.
