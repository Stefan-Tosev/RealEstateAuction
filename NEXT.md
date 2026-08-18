# NEXT

State of the project, rewritten each session. Trust it, then verify
anything it claims about a file, a flag or a command before acting on
it — it was true when it was written.

Last written: 18 August 2026.

## Where things stand

Phase 1 and 2 are done and merged. `main` is the only branch, no open
pull requests, CI green.

Working end to end on a laptop: the public bilingual catalogue, admin
property/lot CRUD with image and legal-pack upload, bidder registration
with email verification, **bidding** with fixed banded steps and a flat
five-minute soft close that resets on every bid, the closing worker,
seller reporting, fee invoicing with gapless numbering, sales and
post-close workflow, and `/admin/live` for lots mid-auction.

447 unit tests, 135 e2e, no schema drift.

**Nothing has ever run outside this laptop and CI.** No server, no
domain, no TLS, no backups. That is the gap that matters now — every
remaining code item is small next to it.

`docs/open-items.md` is the full open set with reasons. Read it before
picking anything up.

## The single next action

**Stand up the VPS and take `deploy/README.md` end to end** — bare
Ubuntu to a running site: Postgres, migrations, the app unit, the
worker unit, Caddy for TLS, and the backup script on a timer.

It is first because it is the only thing standing between a finished
build and something real can be put through, and because every hour
spent on features first is an hour spent on a system nobody has proven
can start from cold.

If the hosting decision has not landed yet, the next best is
`docs/open-items.md` §3.2 — emailing an invoice rather than printing
it. Self-contained, and blocked on nothing.

## Needs Stefan, not the assistant

- **A VPS.** Hetzner Falkenstein or Helsinki, €5–8/month. EU residency
  is not a preference: Stage 2 will hold ЕГН and identity documents.
  It must have a real disk — legal packs and photographs are written to
  the filesystem, and an ephemeral one loses them.
- **A domain**, with DNS you control.
- **A Resend account** and the domain verified in it. Until then
  `RESEND_API_KEY` stays empty and nobody can complete registration.
- **Three legal documents from a Bulgarian lawyer** — seller agreement,
  bidder terms, conditions of sale. The deposit gate, forfeiture and the
  "deemed to have reviewed the pack" position are all unenforceable
  without them, and the code already assumes they exist.
- **A separate bank account holding only deposits.** Money you must give
  back is client money.
- **The ДДС question for the accountant** — the fee schedule assumes
  20%; somebody has to confirm the business is registered to charge it.

## Traps

- **`RESEND_API_KEY` being empty fails silently and looks like
  nothing.** Every message is queued to the outbox and logged instead of
  sent. There is no error anywhere — registration simply never
  completes, and the cause is invisible unless you know to look in
  `outbox`.
- **Do not bump `POLICY_VERSION`** in
  `src/server/identity/terms.ts` until there is a page where a bidder
  can accept the new terms. `placeBid` refuses anyone whose latest
  granted consent names an older version, so moving the string locks
  every existing bidder out of bidding at once. The day the lawyer's
  real terms arrive is exactly the day this fires — see
  `docs/open-items.md` §3.10.
- **Do not `npm run clean` immediately before a dev e2e run** unless you
  mean to. On 18 August 2026 a cold full suite took 25.5 minutes and
  failed four tests; the same tests passed warm, 78 in 7.3 minutes.
  Cold compiles push individual page loads past the 15s action timeout,
  and an uncompiled page has no `h1` and no `body` class — which is
  indistinguishable from the missing-shell bug this repo has hit twice.
  Judge such a failure by re-running warm before believing it.
- **A new route needs adding to `tests/e2e/global-setup.ts`.** Its
  warming list is not derived from anything; it is hand-maintained, and
  the file says it has already fallen behind once.
- **Run `npm run clean` when switching between the dev and prod e2e
  suites.** The prod run leaves a production build in `.next` and the
  dev run then recompiles from it slowly enough to produce dozens of
  spurious failures that have nothing to do with the change.
- **Run the prod e2e suite through `npm run test:e2e:prod`, never
  Playwright directly with the prod config** — that skips the build and
  tests a stale one.
- **Check nothing else holds port 3000.** Next silently binds 3001 while
  Playwright waits on 3000, and the run produces no output at all rather
  than an error.
- **The e2e suite hits the real database** on `localhost:5432`.
  `docker compose up -d` provides one matching `.env`.
- **`docs/untested.md` is empty, and that is evidence of nothing.** An
  absence of entries reads exactly like health. The question to ask is
  what the last thing we decided not to test was.
- **A green suite is blind to layout.** Twice a whole suite passed while
  a page rendered with no shell at all. Screenshot anything visual.
