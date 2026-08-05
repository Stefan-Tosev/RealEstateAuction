# Auction House — Architecture (v2)

Status: **proposed**, August 2026. Supersedes the static prototype currently in this repo, which becomes a design reference only.

Scope: an MVP to validate demand for online real-estate auctions in Bulgaria. Real listings, real registered bidders, real bidding. Refundable deposits only — no escrow through the platform.

---

## 1. The auction lifecycle

The single most important design decision here: **preview and bidding are separate phases.**

Reviewing a legal pack, booking a viewing, driving to the property, and getting KYC-approved are not bidding activities. They need weeks. Bidding needs days — nearly all real activity lands in the final hours no matter how long the window is, so a 30-day bidding window is 29 days of a lot that looks stale and dead.

```
DRAFT ──► PUBLISHED ──► BIDDING_OPEN ──► EXTENDING ──┬─► CLOSED_SOLD
  │       (preview)       (bidding)     (soft close)  │   (reserve met)
  │           │                                       │
  │           │                                       └─► RESERVE_NOT_MET
  │           │                                              │  (24–72h
  │           │                                              │   negotiation)
  │           │                                              ├─► CLOSED_SOLD
  │           │                                              └─► CLOSED_UNSOLD
  └───────────┴───────────────────────────────────────────► CANCELLED
```

An unmet reserve is **not** a terminal state. It opens a post-auction window — see §10.

| Phase | Recommended | What happens |
|---|---|---|
| **PUBLISHED** (preview) | **21 days** | Listing live. Legal pack downloadable. Viewings bookable and held. Bidders register and get approved. Deposits lodged. **No bidding.** |
| **BIDDING_OPEN** | **5 days** | Approved bidders bid. Visible countdown. |
| **EXTENDING** | indefinite | Soft close — see §3. |

**Total ≈ 26 days**, which lines up with the ~28-day norm for online property auctions. It gives your buyers three full weekends to view the property, and keeps the bidding window energetic.

If you want to move faster, **14 + 3** works. I would not go below a 14-day preview — that is roughly the minimum for a working person to arrange a viewing and have a lawyer glance at the title.

The durations are per-lot columns, not constants. Start at 21 + 5 and adjust from real data.

> **Why not a 30-day bidding window:** it does not buy deliberation time — the preview already provides that. It buys 29 days of an inert page, and it delays your feedback loop by a month per lot. For an MVP whose entire purpose is learning whether people bid, that is the expensive choice.

---

## 2. Data model

PostgreSQL. Money as **integer minor units** (`bigint`, stotinki/cents) — never floats. All timestamps `timestamptz`, all logic in UTC, displayed in `Europe/Sofia`.

### Identity

**`users`** — `id`, `email` (citext, unique), `password_hash` (Argon2id), `email_verified_at`, `phone`, `phone_verified_at`, `first_name`, `last_name`, `date_of_birth`, `account_type` (`individual|company`), `company_name`, `eik`, `vat`, `locale` (`bg|en`), `status`, `created_at`

**`bidder_approvals`** — `id`, `user_id`, `status` (`pending|approved|rejected|expired`), `kyc_provider`, `kyc_reference`, `reviewed_by`, `reviewed_at`, `notes`

> Separate table on purpose. An account is not a paddle. Approval is revocable, expires, and is audited independently of the login.

### Catalogue

**`properties`** (the physical asset) — `id`, `slug`, `title_bg`, `title_en`, `description_bg`, `description_en`, `address`, `city`, `region`, `lat`, `lng`, `area_sqm`, `rooms`, `floor`, `year_built`, `property_type`, `cadastral_id`

**`lots`** (an auction *of* a property) — one property can be auctioned more than once if it fails to sell:

| Column | Notes |
|---|---|
| `id`, `property_id`, `lot_number` | |
| `status` | the state machine in §1 |
| `preview_starts_at`, `bidding_opens_at` | |
| `scheduled_close_at` | the published close — never mutated |
| `effective_close_at` | **moves** on soft close; the authoritative one |
| `closed_at` | set once, when actually closed |
| `starting_price_minor`, `bid_increment_minor` | |
| `reserve_price_minor` | **secret**; never leaves the server |
| `soft_close_window_seconds` | default `300` |
| `soft_close_reset_seconds` | default `300` |
| `deposit_required_minor` | |
| `winning_bid_id` | |

Keeping `scheduled_close_at` and `effective_close_at` as two columns means you can always show "was due to close at X, actually closed at Y after N extensions" — which is exactly what a dispute needs.

### Bidding

**`bids` — APPEND ONLY. Never `UPDATE`, never `DELETE`.**

`id`, `lot_id`, `user_id`, `amount_minor`, `received_at` (server clock), `status` (`accepted|rejected`), `reject_reason`, `idempotency_key` (unique per user+lot), `caused_extension_to` (nullable), `previous_bid_id`, `client_ip`, `user_agent`

Rejected bids are stored too. When someone insists they bid in time, the rejected row with its server receive timestamp is the answer.

Enforce append-only at the database level with a trigger, not by convention.

### Supporting

**`lot_documents`** — `id`, `lot_id`, `kind` (`title_deed|sketch|tax_valuation|encumbrances|floor_plan|energy_cert|other`), `filename`, `storage_key`, `size`, `mime`, `sha256`, `visibility` (`public|registered|approved_bidders`), `uploaded_by`, `uploaded_at`

**`viewings`** — `id`, `lot_id`, `starts_at`, `duration_minutes`, `capacity`, `kind` (`private|open_house`)
**`viewing_bookings`** — `id`, `viewing_id`, `user_id`, `status`, `booked_at`

**`deposits`** — `id`, `user_id`, `lot_id`, `amount_minor`, `method` (`sepa|card_hold`), `status` (`pending|held|released|forfeited|refunded`), `provider_ref`

**`audit_log`** — append only: `actor_user_id`, `action`, `entity_type`, `entity_id`, `before` (jsonb), `after` (jsonb), `ip`, `created_at`

**`outbox`** — durable notification queue: `user_id`, `channel` (`email|push|sms`), `template`, `payload`, `send_after`, `sent_at`, `attempts`

---

## 3. The soft-close engine

The rule, stated the way it should be explained to bidders:

> **A lot closes only after 5 minutes pass with no new bids.**

Reset the clock; do not add to it. Adding lets ten rapid bids pile on fifty minutes. Resetting gives a guarantee that is both simple to implement and simple to state: *there will always be five quiet minutes before the gavel.*

**The extension only fires inside the trigger window.** A bid placed on day 2 of a 5-day bidding period moves nothing. Only a bid arriving within `soft_close_window_seconds` of `effective_close_at` resets the clock. Normal price discovery happens across the whole window at no time cost.

### Extension window

**Revised 2026-08-05: flat five minutes. The decay is available per lot but is no longer the default.**

The original design shrank the window as extensions accumulated — 5 minutes for the first two, then 3, then a 2-minute floor — on the grounds that two determined bidders grinding the minimum increment can drag a close out for hours. Thirty rounds at a flat five minutes is 2.5 hours.

Three things overtook that reasoning:

1. **The increments moved.** The grind argument assumed a €5,000 step at €345,000, about 1.4%. At the revised bands it is €10,000, and every band opens at 4–5%. Thirty rounds now means the price moved €300,000. That is not a pathology to defend against.
2. **The 2-minute floor was conditional on §4.** It was permitted only "provided outbid notifications are working". Until those ship, a two-minute window means keeping your lot depends on happening to be at the screen — the exact unfairness soft close exists to remove.
3. **Reflection time is the product.** Five minutes is already thin for committing to a six-figure purchase. Two invites the emotional bid, which is the kind of sale that comes back as a dispute.

A hard cap on total extension was considered instead and rejected: it bounds the operational risk but reintroduces sniping at the cap, breaking the anti-snipe guarantee exactly where it matters most. A long endgame is an operations problem — solve it by alerting the auctioneer, not by rushing bidders.

The guarantee is therefore the simple one, and it is the one to state publicly: **there will always be five quiet minutes before the gavel.**

`soft_close_schedule` (jsonb, per lot) still accepts a decaying schedule, and `windowFor` still honours it, so a lot whose endgame genuinely drags can be given one without a deploy. `extension_count` is tracked on the row for it.

The schedule value is the length of the **quiet period the clock resets to**, not merely the width of the trigger window. Both, in fact: a bid extends only if it lands within that many seconds of the close, and it then resets the close to that many seconds away.

This was implemented as trigger-window-only at first, with the reset left at a flat `soft_close_reset_seconds`. That decays *which* bids extend but never *by how much*, so a decaying schedule never actually shortened anything. `soft_close_reset_seconds` now acts as a cap on the schedule rather than as the reset itself.

### Placing a bid

Every bid is exactly one transaction, serialized per lot:

```sql
BEGIN;

-- Serializes all bids on this lot. Also blocks the closing worker.
SELECT * FROM lots WHERE id = :lot_id FOR UPDATE;

-- Server clock is the only clock, evaluated inside the lock.
now := clock_timestamp();

-- Gates
IF lot.status <> 'BIDDING_OPEN'        -> reject NOT_OPEN
IF now >= lot.effective_close_at       -> reject CLOSED
IF bidder not approved                 -> reject NOT_APPROVED
IF deposit required and not held       -> reject NO_DEPOSIT
IF bidder is the seller                -> reject SELF_BIDDING

-- Amount
highest  := SELECT max(amount_minor) FROM bids
            WHERE lot_id = :lot_id AND status = 'accepted';
min_next := COALESCE(highest + increment_for(highest), lot.starting_price_minor);
IF :amount < min_next                  -> reject TOO_LOW
IF :amount > min_next                  -> reject NOT_ON_STEP
-- NB: min_next is a STEP, not a floor. It is the ONLY valid amount;
-- an amount above it is rejected NOT_ON_STEP. See "Bid increments".

-- Idempotency: a retry or double-click returns the original bid
IF EXISTS (bid WITH idempotency_key)   -> RETURN existing

-- Soft close
new_close := lot.effective_close_at;
IF (lot.effective_close_at - now) <= lot.soft_close_window_seconds THEN
    new_close := now + lot.soft_close_reset_seconds;
END IF;

INSERT INTO bids (...) RETURNING id;
UPDATE lots SET effective_close_at = new_close,
                status = CASE WHEN new_close <> effective_close_at
                              THEN 'EXTENDING' ELSE status END;

COMMIT;
```

**Only after commit:** broadcast to subscribers, then enqueue outbid notifications. Broadcasting inside the transaction shows bids that may still roll back.

### Closing a lot

A worker every few seconds:

```sql
SELECT id FROM lots
WHERE status IN ('BIDDING_OPEN','EXTENDING')
  AND effective_close_at <= now()
FOR UPDATE SKIP LOCKED;
```

Then per lot: re-check `effective_close_at` **inside the lock** (a bid may have extended it in the meantime), compare the highest bid against the secret reserve, set `CLOSED_SOLD` or `CLOSED_UNSOLD`, set `winning_bid_id` and `closed_at`.

`FOR UPDATE` on the same row is what makes the race between "final bid" and "close the lot" impossible. Both paths contend for one lock, and the database decides the order.

Must be idempotent and safe with several workers running.

### Bid increments

**Revised 2026-08-05: the increment is a fixed step, not a floor.**

The original design made `min_next` a floor and allowed any amount above it, on the reasoning that jump bids keep endgames short. That requires a free-text amount field, and a free-text amount field means a bidder can type an extra zero into something legally binding — €3,450,000 where €345,000 was meant, comfortably above the floor and therefore accepted by every check. There is no undo on a binding bid.

So exactly one amount is valid at any moment, and the interface offers a single button carrying it. `NOT_ON_STEP` exists to record the case where a request arrives with something else, which cannot come from the interface.

The cost is real and was accepted knowingly: no jump bids means a contested lot climbs one rung at a time, and each rung resets the clock. Steeper bands are the compensation — step size is now the only control on how fast price moves.

| Current bid | Step | % at band start | % at band end |
|---|---|---|---|
| under €100,000 | €2,000 | — | 2.0% |
| €100,000 – €250,000 | €5,000 | 5.0% | 2.0% |
| €250,000 – €500,000 | €10,000 | 4.0% | 2.0% |
| above €500,000 | €25,000 | 5.0% | — |

Each band opens at 4–5% of the standing bid and decays to 2% before the next takes over. That is above the conventional 1.5–2%, deliberately: at the old €5,000 step a €345,000 → €600,000 contest is 51 bids and 51 clock resets, against 20 here.

The risk this carries is a rung that overshoots the top bidder's limit, ending a lot below what it would have made. That is a revenue question for the auctioneer, and the reason the bands live in a table.

A lot may override the band with `lots.bid_increment_minor`. The override wins — and it must win **everywhere**. The lot page and the engine resolve the increment through the same function for exactly this reason: a page advertising a step the engine would refuse is worse than no figure at all.

Stored as a table, not constants, so bands are tunable without a deploy. Replaced wholesale on seed rather than merged: the bands partition the price line, so an obsolete lower bound does not sit quietly beside the new ones — it wins for its slice of the range.

### Invariants — these are the tests that matter

1. Server clock only. A client timestamp never influences anything.
2. Judge by **server receive time**, re-checked inside the lock. A valid bid must not be rejected by its own processing latency.
3. Two bids in the same final second: both serialize; the second extends from the *already extended* time.
4. A bid 50ms after close loses — cleanly, with a clear reason, and is still recorded.
5. The bidder's countdown is derived from **server time offset**, never the device clock. Phones drift by minutes.
6. `bids` is append-only, enforced by trigger.
7. The reserve price never appears in any API response.

---

## 4. Real-time

Bidders subscribe to a per-lot channel; the server publishes after commit.

Use a **managed service** (Ably or Pusher) for the MVP. At your scale it is roughly €0–25/month and removes the entire problem of running, scaling and reconnecting WebSocket infrastructure. Migrating to self-hosted later is a contained change because publishing already happens behind one interface.

**On reconnect the client refetches lot state** rather than assuming it received every message. Treat the channel as a latency optimisation over a source of truth that lives in Postgres — never as the source of truth itself.

### Notifications are not optional

Indefinite extension is only fair if outbid bidders *know*. Without email and push on outbid, the soft close protects whoever happens to be staring at the screen. That is a fairness defect, not a missing nicety.

Delivered through the `outbox` table so a mail provider outage cannot lose them.

---

## 5. Documents and viewings

This is what earns the 21-day preview.

**Legal pack per lot** — нотариален акт (title deed), скица (cadastral sketch), данъчна оценка (tax valuation), удостоверение за тежести (encumbrances), floor plan, energy certificate.

Tiered visibility: headline info **public**; the full pack requires **registration**. That captures serious leads and gives you a demand signal before anyone bids — genuinely useful for an MVP.

Storage rules: private bucket, never in the web root. Verify magic bytes, not extensions. Serve only through short-lived signed URLs with `Content-Disposition: attachment`. Never render a user-supplied PDF inline from your own origin — that is same-origin XSS.

**Viewings** are bookable slots with capacity. Private appointments and open-house windows. Booking requires a registered account; confirmations and reminders ride the same outbox.

---

## 6. Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + React + TypeScript |
| Backend | Next.js route handlers, extracted to a Node service if load demands |
| Database | PostgreSQL 16 |
| Access | Prisma |
| Real-time | Ably or Pusher (managed) |
| Jobs | pg-boss (Postgres-backed) — no extra infrastructure |
| Auth | Auth.js, email + password, TOTP before paddle issue |
| Files | S3-compatible (Hetzner Object Storage / Cloudflare R2), EU region |
| Email | Resend or Postmark |
| Tests | Playwright (E2E) + Vitest (unit) |
| Hosting | Vercel + Neon, or a single Hetzner VPS in EU |

TypeScript throughout so there is one language to learn, and because Playwright — already your strongest tool — is native to it.

### Layout

```
src/
  app/                  routes (public catalogue, bidder area, admin)
  server/
    auction/            bidding engine, soft close, closing worker  ← the core
    catalogue/          properties, lots, documents, viewings
    identity/           registration, KYC approval, sessions
    payments/           deposits
    notifications/      outbox + senders
    audit/
  lib/                  money, time, validation, i18n
prisma/                 schema + migrations
tests/
  e2e/                  Playwright
  unit/                 Vitest
  fixtures/             shared validation cases (client/server parity)
```

`server/auction/` is the part that must be right. It should be small, boring, heavily tested, and touched rarely.

---

## 7. Testing

You own this layer — it is where your existing skill is worth the most.

**Concurrency is the whole game.** These need real tests, not manual clicking:

- Two bidders, same lot, same millisecond → exactly one wins, the other gets a clean rejection
- A bid at T−100ms extends; a bid at T+50ms is rejected and recorded
- Ten rapid bids in the final minute → close moves to *last bid + 5 min*, not +50 min
- Double-clicked submit with one idempotency key → one bid
- Closing worker and a final bid racing → no lot closes with a valid unprocessed bid
- Kill the connection mid-endgame, reconnect → state is correct

Postgres-level tests can drive two concurrent transactions directly. That is how you prove the lock works — the UI cannot demonstrate it.

Plus the Bulgarian validation fixtures already built for the prototype (ЕИК checksum, БГ phone formats, 18-today boundary), shared between client and server so they cannot drift.

---

## 8. Build order

| Phase | Deliverable | Why here |
|---|---|---|
| **0** | Schema, auth, admin shell | Foundation |
| **1** | Catalogue, legal packs, viewings | **Shippable alone.** A real listing site — you can start gauging interest before any bidding exists |
| **2** | Bidder registration + manual approval | Manual review is correct at MVP volume; no KYC vendor contract yet |
| **3** | **Bidding engine + soft close** | The core. Slowest phase. Do not rush it |
| **4** | Real-time + outbid notifications | Makes the endgame fair and exciting |
| **5** | Deposits | First point money is touched — first point real regulatory weight lands |
| **6** | Post-auction: winner pack, notary handoff | |

Phase 1 is deliberately independently valuable. If you learn nobody wants this, you learn it there, cheaply.

---

## 9. Bulgaria

**Identity:** Evrotrust and Borica are Bulgarian eIDAS-qualified trust providers, already used by BG banks, and support КЕП for signing bidder agreements. EU alternatives: Veriff, Sumsub, iDenfy. Phase 2 uses manual review; wire a provider at Phase 5.

**Deposits:** Stripe supports Bulgaria; myPOS is Bulgarian. Note that card pre-authorisation holds generally fail at property-deposit sizes — **SEPA transfer is the realistic mechanism**, which means manual reconciliation. Budget the operational time; this surprises people.

**Deferred, not ignored:** holding deposits puts you in AML territory. That is a reason to sequence it at Phase 5, not to pretend it away. Get a lawyer before Phase 5 ships, not after.

**GDPR:** ЕГН is not collected at all in this design. Documents and personal data stay in EU regions. Consent records carry policy version and exact wording.

---

## 10. Commercial model and unsold lots

### Fee structure

| Fee | Paid by | When | Typical (EU property) |
|---|---|---|---|
| **Entry / marketing fee** | Seller | Upfront, **non-refundable** | €200–800 |
| Seller's commission | Seller | Only on sale | 1.5–3% of hammer |
| Buyer's premium | Buyer | Only on sale | 2–5% of hammer, often with a floor |
| Withdrawal fee | Seller | If pulled after publication | Entry fee + fixed sum |

The entry fee is what protects you when a lot fails to sell. It covers costs you incur regardless of outcome — legal pack, photography, listing, staffing viewings — and it is defensible precisely because it is disclosed and charged **before** the lot goes live, not levied as a penalty afterwards.

**A bidder is never charged when a lot fails to sell.** Deposit refunded in full, no exceptions. They bid in good faith and the lot did not reach its threshold. Charging them would be indefensible and would do more reputational damage than any single lot is worth.

### Reserve discipline is the real protection

Lots miss reserve almost entirely because the reserve was unrealistic. The structural fix is policy, not fees:

- **The auctioneer must agree the reserve.** Sellers do not set it unilaterally.
- Convention: **reserve ≤ ~110% of the published guide price**, with the guide set jointly from comparables.
- A seller insisting on a fantasy reserve is a lot you decline. Taking it wastes your marketing budget and puts a dead lot in your catalogue, which costs more than the entry fee earns.

Model this as a `reserve_agreed_by` / `reserve_agreed_at` pair on `lots`. If it is null, the lot cannot be published.

### Post-auction negotiation window

When the highest bid falls below reserve, the lot enters `RESERVE_NOT_MET` for a configurable **24–72 hours**:

- The highest bidder's deposit stays held (with their consent, disclosed in the terms) for the duration of the window.
- The auctioneer takes the bid to the seller and attempts to bridge the gap.
- Seller accepts → `CLOSED_SOLD` at the bid amount, normal commission and premium apply.
- Window expires or either side declines → `CLOSED_UNSOLD`, deposit released immediately.

A meaningful share of unsold lots close this way. An unmet reserve is not a failure to be penalised — it is a warm lead with a known price and an already-verified buyer. Build it as real functionality, not an afterthought.

**`fees`** — `id`, `lot_id`, `party` (`seller|buyer`), `kind` (`entry|commission|premium|withdrawal`), `amount_minor`, `basis` (`fixed|percent`), `rate`, `status` (`due|invoiced|paid|waived`), `charged_at`

---

## 11. Open decisions

### Decided

- **Lot sourcing** — admin-curated at launch (Stefan lists lots himself); an agency submission flow with an approval queue comes second. No self-service seller portal in the MVP. *Design implication: keep listing creation behind a service boundary so an agency-facing submission form can call the same path later.*
- **Proxy / max bidding** — **not** in the MVP. Every bid is a deliberate human action. Simpler engine, far simpler soft-close reasoning, and a more dramatic endgame. The bid path stays behind one interface so it can be added later without a rewrite.
- **Unsold lots** — entry fee covers the downside; post-auction negotiation window recovers the upside. See §10.

### Still open

1. **Reserve price disclosure** — hidden, or show a met/not-met flag? Showing the flag drives bidding toward the threshold while preserving negotiating room. Recommend the flag.
2. **Phase durations** — recommendation is 21 preview + 5 bidding. Per-lot columns either way, so the default is cheap to change.
3. **Fee levels** — the *structure* in §10 is settled; the actual numbers are a pricing decision.
4. **Fee levels** — structure settled (§10); the numbers are a pricing decision.
5. **Withdrawal rights** — can a seller pull a lot mid-auction, and at what cost? Needs a written policy before it happens live rather than after.
