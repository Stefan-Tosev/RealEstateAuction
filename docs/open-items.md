# Open items

Everything recommended but not yet done, as of 2026-08-06. Items that
have since been built or settled are deliberately absent — this is the
open set, not a history.

Each item says *why it matters*, because a list of tasks without reasons
rots into a list of tasks nobody can prioritise.

---

## 1. Blocking a real launch

These are the ones that make the difference between a working demo and
something you can put real property and real money through.

*(1.1, the undisclosed buyer's premium, was closed on 2026-08-06.)*

### 1.2 The three legal documents

None exist. The platform's entire liability position depends on them:

- **Seller agreement** — commission, entry fee, withdrawal fee, the
  seller's warranty of the legal pack, and what happens if a seller
  refuses to complete a sale that met the reserve.
- **Bidder terms** — that a bid is binding, that the deposit may be
  forfeited, that the buyer's premium is payable, and that the bidder is
  deemed to have reviewed the legal pack and taken their own advice.
- **Conditions of sale**, attached per lot.

A Bulgarian lawyer's job, and the one thing on this list that is
genuinely expensive to get wrong. The code already assumes these exist:
the deposit gate, the forfeiture status and the "deemed to have reviewed"
position are all unenforceable without them.

### 1.3 Where deposit money sits

Money you must give back is client money. Mixing it with operating funds
is what turns a dispute into something worse — if the business has a bad
month and the deposits have been spent, refunds fail.

**Minimum discipline whatever the legal form: a separate bank account
holding only deposits.** Whether it must be a formal доверителна сметка
depends on how the terms characterise the deposit and on Bulgarian rules
for auction houses. Lawyer and accountant.

### 1.4 Nothing is deployed

Every green suite so far has run on one Windows laptop and in CI. There
is no server, no domain, no TLS, no backups.

Recommendation: a single EU VPS (Hetzner Falkenstein or Helsinki, ~€5–8
a month). The constraint that decides it is that legal-pack documents and
property photographs are written to **disk** — an ephemeral filesystem
would lose them, which is the failure this project already hit once when
files went to `public/`. There is a `MediaStorage` interface so a move to
S3/R2 is contained, but a box with a disk needs no move at all.

EU residency matters: Stage 2 will hold ЕГН and identity documents.

**When it exists, back up Postgres *and* the `private/` directory.**
Deleting a row does not delete the file, and losing legal packs is
unrecoverable.

### 1.5 No email actually sends

The Resend transport, ten bilingual templates and the outbox dispatcher
are all built and tested. `RESEND_API_KEY` is empty, so every message is
queued and logged instead of delivered — verification emails included,
which means nobody can complete registration.

Needs: a Resend account (the free tier is ample), a domain, and the
domain verified in Resend. Until a domain is verified, Resend's sandbox
sender only delivers to the address you signed up with.

---

## 2. Legal and commercial decisions

### 2.1 Never certify the legal pack

Encoded as far as code can: publishing now requires a title deed and an
encumbrances certificate, and the check is on **presence only**.

What code cannot enforce is the wording. The terms must say the seller's
solicitor produces the pack, the seller warrants it, and the house gives
no warranty as to its contents. And listing copy must never characterise
legal status — never "clean title" or "no encumbrances". Link to the
document and let it speak. Misdescription by an agent is the *agent's*
liability.

### 2.2 The withdrawal fee covers only withdrawal

Three different situations, routinely conflated:

| Situation | Who bears it |
|---|---|
| Seller pulls a published lot | Withdrawal fee — built |
| Bidding **met** the reserve and the seller refuses to complete | **Not a fee.** The sale is binding; the winning bidder is the injured party. Contract remedy, and it needs to be written into the seller agreement |
| Bidding fell **below** reserve and the seller declines | Nothing. §10 is explicit that an unmet reserve is not to be penalised |

Only the first is implemented, correctly. The second needs drafting.

### 2.3 ДДС registration status

The fee schedule assumes 20%. A business below the registration threshold
charges none — the code handles a zero rate correctly, but somebody has
to set it.

Separately: decide now whether you quote fees inclusive or exclusive of
ДДС, and be consistent everywhere. The Bulgarian market quotes gross
("3.6%"); the system stores net. Both are right; mixing them in customer-
facing copy is not.

### 2.4 Deposit forfeiture rests entirely on the terms

Recording a forfeiture is built — a defaulted sale forfeits the deposit,
with a reason and a named operator against it. What is NOT built, because
it cannot be, is the right to keep the money. That exists only if the
bidder terms say so (see 1.2), and they do not yet exist.

---

## 3. Code, still open

### 3.2 Invoices are printed, not emailed

Invoices can now be raised, settled and cancelled, with gapless numbering
and a printable sheet. What is not built is sending one — a seller gets
no email with their invoice attached, so an operator prints it and sends
it themselves.

The outbox can already address a seller, so the missing piece is a
template and a PDF (or a signed link to the existing page).

### 3.4 No operations view of LIVE lots

Sales in progress now have one — /admin/sales answers what is
outstanding, what each is waiting on, and what is overdue.

The same was missing for lots mid-auction. Extension is uncapped by
design, so a lot scheduled to close at 18:00 can close at 19:30, and an
auctioneer could not see which lots were in extension, how many
extensions deep, or be told when one ran long.

**Done** — `/admin/live`, 2026-08-14. Extension depth, overrun against the
*scheduled* close, and a red banner when a lot is past its close and
still open, which is almost always the worker being down.

### 3.5 The rate limiter is per-instance

**Done** — moved to Postgres, 2026-08-14. Counted over a sliding window
in one statement so there is no gap between recording an attempt and
reading the total. Keys are hashed.

One consequence worth remembering: it is now durable, and durable state
outlives a test run. The e2e suite clears `rate_limit_hits` in its
reseed because the second run within an hour otherwise hit §6's five
registrations per IP and failed as though validation were broken.

### 3.6 Cosmetic: publish blockers shown on closed lots

**Done** — 2026-08-14. An exhaustive `Record<LotStatus, boolean>` rather
than reachability over the transition graph, which called an
actively-bidding lot "still publishable" because it can be cancelled and
redrafted. Warnings are deliberately still shown: the notary wants a
sketch and a tax valuation on a lot that sold.

### 3.7 The build needs Google Fonts to be reachable

`src/app/(public)/[locale]/fonts.ts` uses `next/font/google`, which
fetches Inter **at build time**. On 2026-08-15 that failed a CI run
outright — `NextFontError: Failed to fetch 'Inter' from Google Fonts` —
and passed on a re-run with no change.

CI flaking is the mild version. `deploy/deploy.sh` runs `npm run build`
**on the production server**, after `git pull` has already moved the
working tree, so an unreachable fonts CDN fails a deploy half way
through. Self-hosting the woff2 subsets behind `next/font/local` removes
a third-party dependency from the deploy path and makes the build
hermetic.

### 3.8 One assertion carries its own machinery

`playwright.prod.config.ts` sets `metadata: { mode: "prod" }` so a spec
can tell which build it is running against. It exists for exactly one
assertion — that a bidder's opaque id never reaches the page — which is
true of a production build and not of `next dev`, because dev serialises
the server component's own Prisma rows into the RSC payload.

The assertion is worth having: a refactor passing raw rows to a client
component would leak the id and correlate a bidder across every lot they
touch, while the email assertion beside it stayed green. But one
assertion is thin justification for a mechanism, and if a second use
never appears, deleting both is the right call.

### 3.9 No fallback metrics on the self-hosted fonts

Self-hosting the fonts (§3.7, done) gave up one thing `next/font` did
automatically: it generated a `size-adjust` fallback `@font-face` per
family, scaled so the substitute occupies almost exactly the space the
real font will, which limits the layout shift when the real one arrives.

Everything else is unchanged — the fallback stacks in `tokens.css` still
apply and `font-display: swap` still swaps — so the behaviour is today's
minus that optimisation. It is a CLS regression, not a correctness one,
and it is invisible on a fast connection, which is exactly why it needs
writing down rather than remembering.

Two ways to close it. Measure the metrics and hand-write the adjusted
fallback faces (`size-adjust`, `ascent-override`, `descent-override`,
`line-gap-override`) against Georgia, Arial and Courier New. Or drop the
serif and mono fallbacks to `font-display: optional` where a swap is
worse than not swapping. The first keeps the current behaviour and
removes the shift; the second is cheaper and changes what a slow visitor
sees.

Worth doing before real traffic, not before launch: Core Web Vitals only
starts mattering when someone is measuring them.

---

## 4. Content

The seven lots are demo data, including the photographs. Real listings
need real property, real photography, and real legal packs — and the
publish gate now enforces the last of those.
