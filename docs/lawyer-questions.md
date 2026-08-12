# Questions for the lawyer

Every legal ⚠ in this repo, as a list to take to a meeting. Same purpose
as `accountant-questions.md` in AutoGlow: arrive with the questions
written down, leave with answers that unblock the build.

Ordered by what blocks the most work. **Question 1 decides whether this
is an auction house or a lead-generation site**, so ask it first and let
the rest follow from the answer.

Bring: `docs/architecture.md` §1 (lifecycle), §9 (Bulgaria), §10
(commercial model), and `docs/open-items.md` §1–2.

---

## 1. Is a winning bid legally binding? — **blocking everything**

The platform is built on the premise that a bid is binding. The deposit
gate, the forfeiture status, the "deemed to have reviewed the legal pack"
position and the entire seller pitch all assume it.

But transfer of real property requires a **нотариален акт**, and a
**предварителен договор** for real estate must be in written form.

**Ask:**

1. Does a click on a web form create *any* enforceable obligation to buy?
2. If not, does a bid signed with **КЕП** (Evrotrust / Borica) constitute
   a valid предварителен договор in written form under чл. 19 ЗЗД?
3. If КЕП works — must the *seller* also sign at the moment of the
   hammer, or can they pre-authorise acceptance of the winning bid before
   bidding opens?
4. If neither works, what is the strongest instrument available? A
   deposit-backed reservation with liquidated damages?
5. What wording makes the deposit forfeitable rather than merely held?

**Why it matters:** §9 sequences КЕП at Phase 5 as an identity feature.
If the answer to (2) is yes, КЕП is not an identity feature — it is the
legal mechanism of the whole business and moves to Phase 1.

---

## 2. Consumer withdrawal rights — **possibly fatal, ask explicitly**

EU distance-selling law gives consumers a 14-day right of withdrawal.
Public auctions are exempted — but the exemption is generally written
around auctions the consumer **can attend in person**.

**Ask:**

1. Does an online-only auction qualify for the public-auction exemption
   under Bulgarian implementation of the Consumer Rights Directive?
2. If not, does a winning consumer bidder have 14 days to walk away
   regardless of what our terms say?
3. Does it change if the bidder is a company rather than an individual?
4. Can a scheduled in-person viewing phase (we have one — 21 days) help
   establish the exemption?

**Why it matters:** if consumers retain a 14-day withdrawal right, the
binding-bid model does not exist for private buyers and the product has
to be re-shaped around professional bidders or reservation deposits.

---

## 3. The three documents that do not exist

From `open-items.md` §1.2. The code already assumes all three.

**Seller agreement** — commission, entry fee, withdrawal fee, the
seller's warranty of the legal pack, and the remedy when a seller refuses
to complete a sale that **met** the reserve (`open-items.md` §2.2 flags
this is drafted nowhere and is not a fee question but a contract one).

**Bidder terms** — that a bid is binding, that the deposit may be
forfeited, that the buyer's premium is payable, and that the bidder is
deemed to have reviewed the legal pack and taken their own advice.

**Conditions of sale**, attached per lot.

**Ask:** cost and turnaround for all three, drafted for a platform, not
copied from a single-transaction template. Can they be drafted so that
the answer to Q1 can change without a full rewrite?

---

## 4. Deposit money

From `open-items.md` §1.3. Money we must give back is client money.

**Ask:**

1. Must deposits sit in a **доверителна сметка**, or is a segregated
   ordinary account sufficient?
2. Does holding refundable deposits from the public bring us into AML
   obligations, and at what threshold or volume?
3. Does it make us a payment service under PSD2, or does the commercial
   agent exclusion cover us?
4. Does the answer change if deposits are held by an escrow agent or the
   seller's lawyer instead of by us?

**Note:** SEPA transfer is the realistic mechanism (§9) — card
pre-authorisation fails at property-deposit sizes — so this is manual
reconciliation of real money into a real account from day one.

---

## 5. The probate / делба route — **the target market**

We are pointing the product at inherited property held by multiple heirs,
where the alternative is a съдебна делба running for years and ending in
публична продан below market.

**Ask:**

1. Where all heirs consent, can they sell the whole property to a third
   party via auction **before** any делба, and divide the proceeds by
   quota afterwards? Is that cleaner than делба-then-sell?
2. What exactly must every heir sign, and when — at listing, or only at
   the нотариален акт?
3. If one of five heirs refuses **after** the hammer falls, what is the
   buyer's remedy and what is ours? This is our single most likely
   dispute.
4. Can a **съсобственик** sell only their идеална част through us, and is
   there a right of first refusal for the other co-owners?
5. Where a съдебна делба is already pending, may the parties agree to
   sell through us and ask the court to discontinue?
6. Does an auction price stand up as evidence of fair value if an heir
   later claims they were disadvantaged?

**Why it matters:** (3) and (6) are the whole product. We are selling a
price nobody can dispute. If an heir can unwind the sale afterwards, we
are not selling that.

---

## 6. Never certifying the legal pack

From `open-items.md` §2.1. Publishing requires a title deed and an
encumbrances certificate; the check is presence only.

**Ask:** confirm the wording that puts pack production and warranty on
the seller's solicitor and leaves the house with no warranty as to
contents. Confirm that our listing copy must never characterise legal
status ("clean title", "no encumbrances"). Where is the line between
describing a property and misdescribing it?

---

## 7. Licensing and status

**Ask:**

1. Does running property auctions require any licence, registration or
   professional qualification in Bulgaria?
2. Are we an estate agent for regulatory purposes, and does that carry
   obligations?
3. Any restriction on charging a **buyer's premium** in addition to
   seller's commission?
4. Professional indemnity insurance — required, or merely advisable?

---

## 8. Referral relationships

The sourcing plan is reciprocal referral with lawyers who handle делба:
they send us property, we send them legal-pack work.

**Ask:**

1. May an адвокат accept a referral fee from us? (Assumption: no — check
   the Етичен кодекс.)
2. Is reciprocal referral without money changing hands permissible?
3. May we name a lawyer as "recommended" on the platform?
4. Any conflict where the same lawyer represents the seller and prepares
   the pack we publish?

---

## 9. GDPR and sourcing

**Ask:**

1. Court records of pending делба cases are public. May we lawfully
   approach those parties? (We do not intend to — see the sourcing note —
   but confirm the boundary.)
2. Retention period for bidder KYC and identity documents on unsuccessful
   bidders.
3. Is a DPIA required, given identity documents plus financial data?

**Note:** ЕГН is deliberately not collected anywhere in the design (§9).
Confirm nothing in the KYC flow reintroduces it.

---

## What a good answer set unlocks

| Answer | Unblocks |
|---|---|
| Q1 yes, via КЕП | Phase 1 re-scoped; Evrotrust integration moves to the front |
| Q1 no | Product re-shapes to reservation deposits; seller pitch rewritten |
| Q2 exemption holds | Binding-bid model survives for consumer buyers |
| Q3 drafted | The platform can take real property and real money |
| Q4 answered | Deposit account opened; Phase 5 de-risked |
| Q5 answered | The probate pitch can be written without hedging |

---

**Budget expectation:** questions 1, 2 and 5 are the ones worth paying a
specialist for. Questions 3 and 4 are ordinary commercial drafting.
Expect the drafting to cost more than the advice.
