import { formatMoney } from "@/lib/money";
import type { Locale } from "@/lib/i18n/locales";
import { percentFee } from "./calculate";
import { BUYER_PREMIUM_BPS, VAT_RATE_BPS } from "./schedule";

/*
 * Telling a bidder what they will actually pay.
 *
 * The premium was charged before this existed and disclosed nowhere: the
 * word did not appear on a single public page. A buyer's premium is
 * ordinary in an auction and indefensible as a surprise — and Bulgarian
 * buyers have not met the model, so "everyone knows" does not hold here.
 * Charging a fee somebody was never shown is a consumer-protection
 * problem before it is a trust problem.
 *
 * So it appears next to every price a bidder sees, and the total they
 * would actually owe is spelled out rather than left as arithmetic.
 *
 * Derived from the same constants raiseSaleFees bills from. A disclosure
 * computed from its own copy of the rate is a disclosure that will
 * eventually be wrong.
 */

export type PremiumDisclosure = {
  /** "3%" — the gross rate, which is the number to put next to a price. */
  rateLabel: string;
  /** The premium itself on this amount, ДДС included. */
  amountFormatted: string;
  /** Hammer plus premium: what the buyer actually pays. */
  totalFormatted: string;
};

/**
 * The gross premium rate as a percentage string.
 *
 * Gross, not net: 2.5% + ДДС is what the business keeps, but 3% is what
 * leaves the buyer's account, and the buyer is who this is for.
 */
export function premiumRateLabel(): string {
  const gross = (BUYER_PREMIUM_BPS * (10_000 + VAT_RATE_BPS)) / 10_000 / 100;
  // Trim a trailing ".0" so the common case reads "3%" and not "3.0%".
  return `${Number(gross.toFixed(2))}%`;
}

export function premiumOn(hammerMinor: bigint | string, locale: Locale): PremiumDisclosure {
  const hammer = typeof hammerMinor === "bigint" ? hammerMinor : BigInt(hammerMinor);
  const fee = percentFee(hammer, BUYER_PREMIUM_BPS, VAT_RATE_BPS);

  return {
    rateLabel: premiumRateLabel(),
    amountFormatted: formatMoney(fee.grossMinor, locale),
    totalFormatted: formatMoney(hammer + fee.grossMinor, locale),
  };
}
