# NEXT

State of the project, rewritten each session. Trust it, then verify
anything it claims about a file, a flag or a command before acting on
it — it was true when it was written.

Last written: 19 August 2026.

## Where things stand

Phase 1 and 2 are done and merged. `main` is the only branch, no open
pull requests, CI green, working tree clean at `3c941b8`.

Working end to end on a laptop: the public bilingual catalogue, admin
property/lot CRUD with image and legal-pack upload, bidder registration
with email verification, bidding with fixed banded steps and a flat
five-minute soft close that resets on every bid, the closing worker,
seller reporting, fee invoicing with gapless numbering, sales and
post-close workflow, `/admin/live` for lots mid-auction, and — since
18 August — a terms-acceptance page at `/[locale]/terms/accept`.

447 unit tests, 135 e2e, no schema drift.

**Nothing has ever run outside this laptop and CI.** No server, no
domain, no TLS, no backups. That is still the gap that matters most.

**No code was written on 19 August.** The session was a read of this
file; the work was deciding what tomorrow is for.

`docs/open-items.md` is the full open set with reasons.

## The single next action

**Stefan's, not the assistant's — and it is not code.**

**Buy the VPS.** Hetzner **CX33, €8.49/month**, Falkenstein or Helsinki.
Real disk, not ephemeral — legal packs and photographs are written to
the filesystem.

This was blocked for four weeks on the ЕГН question. **That is now
settled (16 September 2026): ЕГН is not collected at any stage**, so
hosting need only be *EU*, not Bulgarian specifically. Any of Hetzner's
three locations qualifies and nothing further is waiting.

Not confirmed, and worth a glance at the order page before paying:
whether IPv4 is charged separately, and the traffic allowance on the CX
line. Both were behind JavaScript that would not render.

## The plan for 20 August 2026

Written for a tired evening after a full day at the office. Forty-five
minutes, in this order. Stopping after item 1 is still a good day —
it unblocks more than the other three combined.

1. ~~**Decide the ЕГН question.**~~ **Done 16 September 2026** — not
   collected, at any stage. `CLAUDE.md`, `open-items.md` §1.4,
   `server-validation.md` and `lawyer-questions.md` §9 and §12 all now
   agree, and §12 became the record of the decision rather than of a
   contradiction. `architecture.md` had said so all along.
2. **Buy the VPS.** 20 minutes. Hetzner CX33, €8.49/month,
   Falkenstein or Helsinki — real disk, not ephemeral. **No longer
   conditional on anything:** item 1 is answered and EU hosting
   suffices.
3. **Buy the domain**, with DNS you control. 10 minutes.
4. **Create the Resend account** and start domain verification — it
   needs DNS records, so it follows 3 naturally. 10 minutes.

Anything past that is tomorrow's problem, not tomorrow evening's.

## Hold me to it

Next session opens by asking which of the four happened. Not "how did
it go" — which ones, by number.

Whatever did not happen gets one dated line appended below, and the
plan is not silently rewritten to match what was actually done. The
point is that slippage stays visible, the same way `docs/untested.md`
keeps a skip visible. Three sessions of "item 1 still open" is a fact
worth seeing; three rewrites that quietly drop it are not.

- 19 August 2026 — plan set for 20 August. Nothing attempted yet.
- 16 September 2026 — **none of the four happened**, confirmed by Stefan. Four weeks. The ЕГН question (item 1, five minutes) has now been open since 19 August and still blocks the hosting choice, the DPIA question and the retention obligation. The session went to AutoGlow instead: its van was bought and had to be driven back from the Netherlands.
- 16 September 2026, later the same evening — **item 1 is done.** ЕГН is not collected unless ЗМИП compels it; five documents were made to agree and §12 now records the decision. The remaining question is the lawyer's: is the platform an обязано лице under ЗМИП? If yes, this reverses and §4 becomes the most important section on the list.
- 19 September 2026 — **items 2, 3 and 4 still not done**, confirmed by Stefan. Nothing blocks them now; ЕГН was the last blocker, and it was settled three days ago. The ЕГН commit `e21d859` was also found unpushed on `egn-decided`.

## Needs Stefan, not the assistant

Beyond the four above:

- **Three legal documents from a Bulgarian lawyer** — seller agreement,
  bidder terms, conditions of sale. Book the meeting; take
  `docs/lawyer-questions.md`, which is written to be read in a meeting.
- **A separate bank account holding only deposits.** Money you must
  give back is client money.
- **The ДДС question for the accountant** — the fee schedule assumes
  20%; somebody has to confirm the business is registered to charge it.

## What the assistant should pick up, when asked

- **`docs/open-items.md` §3.10 has been marked Done** (19 August) — the
  acceptance page shipped on 18 August and the entry still read as open.
- The comment above `POLICY_VERSION` in `src/server/identity/terms.ts`
  still says the acceptance page must exist first. It now does; the
  comment is stale in that half and correct in the other half about
  retrievable old text. Worth a rewrite next time that file is open.
- `docs/open-items.md` §3.2 — emailing an invoice rather than printing
  it. Self-contained, blocked on nothing, good filler work.
- §10 of `docs/lawyer-questions.md` records two decisions not yet in the
  code: **sellers post a deposit too**, and **the runner-up is held for
  a window after close**. Both touch `Deposit`, which is on the
  irreversible list, so both need domain-level tests — and neither
  should start before the lawyer confirms the задатък / неустойка
  characterisation in §10 Q2.

## Traps

- **The terms-acceptance page renders placeholder text, not terms.**
  `t.termsAccept.placeholder`, verified 19 August. The mechanism is
  finished — append-only consent, exact wording stored, idempotent,
  bid refused without it — but the document is not there. Bumping
  `POLICY_VERSION` before the lawyer's text is dropped into that page
  records every bidder accepting a placeholder.
- **`RESEND_API_KEY` being empty fails silently and looks like
  nothing.** Every message is queued to `outbox` and logged instead of
  sent. No error anywhere — registration simply never completes.
- **Do not `npm run clean` immediately before a dev e2e run** unless you
  mean to. On 18 August a cold full suite took 25.5 minutes and failed
  four tests; the same tests passed warm, 78 in 7.3 minutes. Cold
  compiles push page loads past the 15s action timeout, and an
  uncompiled page has no `h1` and no `body` class — indistinguishable
  from the missing-shell bug this repo has hit twice. Re-run warm
  before believing such a failure.
- **A new route needs adding to `tests/e2e/global-setup.ts`.** Its
  warming list is hand-maintained and has fallen behind before.
- **Run `npm run clean` when switching between the dev and prod e2e
  suites.** The prod run leaves a production build in `.next` and the
  dev run recompiles from it slowly enough to produce dozens of
  spurious failures.
- **Run the prod e2e suite through `npm run test:e2e:prod`**, never
  Playwright directly with the prod config — that skips the build and
  tests a stale one.
- **Check nothing else holds port 3000.** Next silently binds 3001 while
  Playwright waits on 3000, producing no output rather than an error.
- **The e2e suite hits the real database** on `localhost:5432`.
  `docker compose up -d` provides one matching `.env`.
- **`docs/untested.md` is empty, and that is evidence of nothing.** Ask
  what the last thing we decided not to test was.
- **A green suite is blind to layout.** Twice a whole suite passed while
  a page rendered with no shell at all. Screenshot anything visual.

---

## Added 19 August 2026, after the wrap-up — two tasks for the assistant

Appended deliberately rather than folded into the plan above. Both are
the assistant's, not Stefan's, and we review the pair together tomorrow.

### Task 1 — remind Stefan to read `docs/open-items.md` §3.10

Open the session by putting §3.10 in front of him, not just naming it.
He wants to see what it was actually about, and it is marked **Done**
now, so it reads as a closed item and is easy to skip past. The part
worth his attention is the last paragraph: the mechanism is finished,
the document is not, and `POLICY_VERSION` must not move until the
lawyer's text is in the page.

This is a reminder, not a task with an outcome. It is done when he has
read it and said so.

### Task 2 — Hetzner pricing — **done on 19 August, review not required, just read it**

Scraped rather than deferred. Prices confirmed against Hetzner's own
price-adjustment notice, effective 15 June 2026 and therefore in force
today. Specs confirmed against the plan page. Both are Hetzner's, not
a third party's.

| Plan | vCPU | RAM | Disk | €/month |
|---|---|---|---|---|
| CX23 | 2 | 4 GB | 40 GB | 5.49 |
| CX33 | 4 | 8 GB | 80 GB | 8.49 |

Locations: Falkenstein, Nuremberg, Helsinki — all EU, so the residency
requirement is met either way, and the ЕГН answer only matters if it
turns out to demand *Bulgarian* hosting specifically.

**Recommendation: CX33 at €8.49.** Not for the CPU — for the disk.
Everything lands on one filesystem: Postgres, the legal packs, the
property photographs and the backups. 40 GB is the constraint you
cannot relieve later without a rebuild or bolting on a volume, and
photographs are the fastest-growing thing here. RAM is the second
reason: `sharp` re-encoding a full-size camera JPEG, a Node production
server, the worker and Postgres on 4 GB means the OOM killer eventually
picks one, and it will pick Postgres during an upload.

**This puts the cost €0.49 above the €5–8 band stated earlier in this
file.** That band was written before the June price rise; it is not a
budget Stefan set, so it is corrected here rather than treated as a
constraint to squeeze under. If €8.49 is genuinely the wrong number,
CX23 plus a separate volume for media is the fallback — cheaper to
start, more moving parts on day one.

**Not confirmed, and worth a glance at the order page before paying:**
whether IPv4 is charged separately, and the traffic allowance for the
CX line. Both were behind JavaScript that would not render.
