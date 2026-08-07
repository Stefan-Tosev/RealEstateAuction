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

### 2.4 Deposit forfeiture

The schema supports `forfeited` and nothing uses it. A forfeited deposit
is only enforceable if the bidder terms say so (see 1.2), and there is no
workflow to record one.

---

## 3. Code, still open

### 3.2 Invoices are printed, not emailed

Invoices can now be raised, settled and cancelled, with gapless numbering
and a printable sheet. What is not built is sending one — a seller gets
no email with their invoice attached, so an operator prints it and sends
it themselves.

The outbox can already address a seller, so the missing piece is a
template and a PDF (or a signed link to the existing page).

### 3.3 What happens between "you won" and the keys

The winner gets an email. After that the system has nothing: no payment
instructions, no completion tracking, no way to see which sales are
outstanding. Currently entirely off-system.

### 3.4 No operations view

Extension is uncapped by design, so a lot scheduled to close at 18:00 can
close at 19:30. That is the correct behaviour, but an auctioneer cannot
currently see which lots are in extension, how many extensions deep, or
get an alert when one runs long. A long endgame is an operations problem
and deserves an operations answer.

### 3.5 The rate limiter is per-instance

In-memory, so it holds for one box. The moment there are two application
instances it must move to Redis or Postgres. Flagged in the code rather
than left to be discovered under load.

### 3.6 Cosmetic: publish blockers shown on closed lots

A `CLOSED_SOLD` lot still displays "No auctioneer has agreed this
reserve, so the lot cannot be published." Harmless noise on a lot that
will never be published again. Pre-existing.

---

## 4. Content

The seven lots are demo data, including the photographs. Real listings
need real property, real photography, and real legal packs — and the
publish gate now enforces the last of those.
