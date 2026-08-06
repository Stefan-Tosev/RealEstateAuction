/*
 * What the auction house charges — §10.
 *
 * Every rate is here and nowhere else. §11 lists fee levels as an open
 * pricing decision, so these will change; the point of one file is that
 * changing them is a one-line diff with a reviewer, and that no number
 * gets hard-coded into a page or a template where it can drift.
 *
 * ### The positioning
 *
 * Bulgarian agency convention is 3% + 20% ДДС, quoted to the public as
 * 3.6%, charged to each side. Both rates here are 2.5% + ДДС = 3.0%
 * gross, deliberately undercutting that by 0.6 points on both sides —
 * €600 on a €100,000 sale, to each party. That is the pitch, and it only
 * holds if BOTH sides are cut: a seller comparing quotes is looking at
 * the seller rate, and they are the side that chooses the auction house.
 *
 * ### Basis points, not floats
 *
 * 2.5% is 250 bps and 20% is 2000 bps, so every calculation stays in
 * integers. `0.025 * 34_500_000` is exact today and will not be on some
 * other amount, and this is money.
 */

/** Statutory ДДС. Not a constant of nature — see `vatRateBps` on each fee row. */
export const VAT_RATE_BPS = 2000;

/**
 * Seller's commission on the hammer price.
 *
 * 2.5% + ДДС = 3.0% gross, against a 3.6% market norm.
 */
export const SELLER_COMMISSION_BPS = 250;

/**
 * Buyer's premium on the hammer price.
 *
 * Cut to match the seller side. Bulgarian buyers already pay an agent
 * around 3.6% gross, so this is a familiar shape at a better number —
 * but it is the least familiar fee in an auction to a market that has
 * not seen many, so it has to be disclosed next to every price rather
 * than in the terms alone.
 *
 * No floor. §10 notes premiums often carry one; on a catalogue of
 * six-figure property the smallest plausible lot still clears a
 * worthwhile fee, and a floor is one more number to explain.
 */
export const BUYER_PREMIUM_BPS = 250;

/**
 * Entry fee, charged when a lot is published. Non-refundable.
 *
 * §10: "The entry fee is what protects you when a lot fails to sell. It
 * covers costs you incur regardless of outcome — legal pack,
 * photography, listing, staffing viewings — and it is defensible
 * precisely because it is disclosed and charged BEFORE the lot goes
 * live, not levied as a penalty afterwards."
 *
 * Starting at the low end of §10's €200–800 on purpose: a first seller
 * is taking a chance on an auction house with no track record. Raising
 * it later, with the legal and administrative costs to point at, is a
 * much easier conversation than starting high.
 *
 * A note on what this fee buys: compiling, hosting and publishing the
 * legal pack. NOT approving it. Certifying that a pack is sound takes on
 * liability for defects in title on a six-figure transaction, which no
 * entry fee could ever cover — the seller's solicitor produces it, and
 * the terms must say so.
 */
export const ENTRY_FEE_NET_MINOR = 30_000n;

/**
 * Charged when a seller withdraws a lot after publication.
 *
 * Entry fee plus a fixed sum: it recovers the wasted marketing and
 * staffing and deters casual withdrawal, while remaining a number that
 * can be stated plainly in the terms and defended as a genuine estimate
 * of loss rather than a penalty.
 *
 * This applies to withdrawal only. A seller refusing to complete a sale
 * that MET the reserve is not a fee question at all — the sale is
 * binding, the winning bidder is the injured party, and it is a matter
 * for the contract. A seller declining below reserve owes nothing: §10
 * is explicit that an unmet reserve is not to be penalised.
 */
export const WITHDRAWAL_FIXED_NET_MINOR = 100_000n;

/** Human-readable rate for display and for the record on each fee row. */
export function bpsToRate(bps: number): string {
  return (bps / 10_000).toFixed(4);
}
