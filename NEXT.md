# NEXT

State of the project, rewritten each session. Trust it, then verify
anything it claims about a file, a flag or a command before acting on
it — it was true when it was written.

Last written: 21 September 2026.

## Where things stand

Phases 1 and 2 are done and merged. CI green on `main` at the ЕГН merge.

Working end to end on a laptop: the public bilingual catalogue, admin
property/lot CRUD with image and legal-pack upload, bidder registration
with email verification, bidding with fixed banded steps and a flat
five-minute soft close that resets on every bid, the closing worker,
seller reporting, fee invoicing with gapless numbering, sales and
post-close workflow, `/admin/live`, the terms-acceptance page, and —
since today — an invoice that emails itself to the party it bills.

510 unit tests, 135 e2e, no schema drift.

**Two things changed outside the code today, and they were the ones
that mattered.** Both domains are bought: **autoglow.bg** and
**auctionhouse.bg**. Registered in Stefan's own name for now, to be
moved to the company when it exists.

**Nothing has ever run outside this laptop and CI.** No server, no TLS,
no backups. That is still the gap that matters most.

`docs/open-items.md` is the full open set with reasons.

## The single next action

**Stefan's, not the assistant's — and it is not code.**

**Buy the VPS.** Hetzner **CX33, €8.49/month**, Falkenstein or Helsinki.
Real disk, not ephemeral: legal packs and photographs are written to the
filesystem.

Nothing blocks it. The ЕГН question was settled on 16 September — not
collected at any stage — so hosting need only be EU, and the domain,
which the server needs pointing at it, now exists.

Worth a glance at the order page before paying: whether IPv4 is charged
separately, and the traffic allowance on the CX line. Both were behind
JavaScript that would not render.

Then, in order: point `auctionhouse.bg` at the server's IP with an A
record, and create the Resend account — its domain verification needs
DNS records and runs on somebody else's clock, so it wants starting
early rather than last.

## Hold me to it

The plan set on 19 August had four items. Item 1 (ЕГН) is done. Items 2,
3 and 4 were the VPS, the domain and Resend.

Whatever does not happen gets one dated line appended below, and the
plan is not silently rewritten to match what was actually done.

- 19 August 2026 — plan set for 20 August. Nothing attempted yet.
- 16 September 2026 — none of the four happened. Four weeks. The session
  went to AutoGlow: its van was bought and driven back from the
  Netherlands.
- 16 September 2026, later — **item 1 done.** ЕГН is not collected
  unless ЗМИП compels it; five documents were made to agree.
- 19 September 2026 — items 2, 3 and 4 still open, nothing blocking.
- 21 September 2026 — **item 3 done: both domains bought** at the
  registrar, `autoglow.bg` and `auctionhouse.bg`. Items 2 (VPS) and 4
  (Resend) still open. Domains were registered personally rather than
  to a company, which does not yet exist.

## Needs Stefan, not the assistant

- **Move both domains to the company** once it is registered. It is a
  change of registrant, not a sale, and the registrar wants a signed
  form from both sides. Do it **before the auction goes live**: a
  platform holding deposits should own the domain its terms name. Ask
  the accountant whether it should be a sale, a contribution or a free
  transfer — the same conversation as the ДДС question.
- **Three legal documents from a Bulgarian lawyer** — seller agreement,
  bidder terms, conditions of sale. Take `docs/lawyer-questions.md`,
  which is written to be read in a meeting.
- **A separate bank account holding only deposits.** Money you must give
  back is client money.
- **The ДДС question for the accountant.** The fee schedule assumes 20%;
  somebody must confirm the business is registered to charge it.
- **An accountant should read the invoice sheet** before the first real
  invoice leaves. It is headed ФАКТУРА and carries the issuer details
  from the environment. `INVOICE_DEMO_MODE` stamps every invoice ОБРАЗЕЦ
  until then, which is what makes this safe to have shipped.

## What the assistant should pick up, when asked

- **The invoice route now has a spec** (23 September):
  `tests/e2e/invoice-link.spec.ts`, 8 cases, proven to fail when the
  signature check is removed. The full e2e suite has still not been run
  since the invoice-by-email merge — only this file.
- The comment above `POLICY_VERSION` in `src/server/identity/terms.ts`
  is stale in its first half: it says the acceptance page must exist
  first, and it now does.
- `docs/lawyer-questions.md` §10 records two decisions not yet in the
  code: **sellers post a deposit too**, and **the runner-up is held for
  a window after close**. Both touch `Deposit`, so both need
  domain-level tests — and neither should start before the lawyer
  confirms the задатък / неустойка characterisation in §10 Q2.
- **AutoGlow is waiting on Render, not on code**: Starter plan, a 10 GB
  disk mounted at `/opt/render/project/src/data`, and `CREW_TOKEN`
  rotated in the same sitting because the current one is public. Its own
  `NEXT.md` has the detail.

## Traps

- **Check Postgres is actually running before anything that touches
  it.** `docker compose ps`. Today the whole unit suite failed nineteen
  tests in 82 seconds with `Can't reach database server`, which reads at
  a glance like the change under test being broken. Docker Desktop
  itself was closed, so `docker compose up -d` failed too — with a
  message about a named pipe, not about Docker.
- **`bidding.test.ts` and `dispatch.test.ts` both write `outbid` rows,
  in parallel.** Three assertions that counted the whole outbox table
  are now scoped to their own bidders. If a suite-wide count appears in
  a new test, it is an assertion about another file's timing. One full
  run failed on this and the next passed unchanged — re-run before
  believing a cross-file failure.
- **The terms-acceptance page renders placeholder text, not terms.**
  Bumping `POLICY_VERSION` before the lawyer's text is in that page
  records every bidder accepting a placeholder.
- **`RESEND_API_KEY` being empty fails silently.** Every message is
  queued to `outbox` and logged instead of sent, with no error anywhere.
  That now includes invoices.
- **The 404 a bad invoice link gets says "Лотът не е намерен" — "the lot
  was not found"** — because it is the shared public not-found page. It
  is wrong wording for an invoice, and nobody has decided whether to fix
  it.
- **Do not `npm run clean` immediately before a dev e2e run.** A cold
  full suite took 25.5 minutes and failed four tests that passed warm.
- **Run `npm run clean` when switching between the dev and prod e2e
  suites**, and run the prod suite through `npm run test:e2e:prod`,
  never Playwright directly with the prod config.
- **Check nothing else holds port 3000.** Next silently binds 3001 while
  Playwright waits on 3000, producing no output rather than an error.
  A dev server was started and stopped during today's session.
- **`docs/untested.md` is empty, and that is evidence of nothing.** Ask
  what the last thing we decided not to test was.
- **A green suite is blind to layout.** Twice a whole suite passed while
  a page rendered with no shell at all. Screenshot anything visual —
  today's invoice page was checked that way, and by fetching four URLs
  from a running dev server rather than by writing a spec.
