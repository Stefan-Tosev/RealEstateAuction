import { BCP47, type Locale } from "./i18n/locales";

/*
 * Money is stored as integer minor units in bigint columns
 * (docs/architecture.md §2 — "never floats"). There is no currency
 * column anywhere in the schema, so the currency is a single constant
 * here. If a lot ever needs a different one, add `currency` to `lots`
 * and thread it through this one function — nothing else in the app
 * formats money.
 */
export const AUCTION_CURRENCY = "EUR" as const;

/**
 * Format minor units for display.
 *
 * Accepts a string as well as a bigint because DTOs carry money across
 * the server/client boundary as decimal strings — `bigint` is not JSON
 * serializable and `number` is lossy.
 *
 * Round amounts drop the decimals: "€100,000" reads as a price,
 * "€100,000.00" reads as an invoice.
 */
export function formatMoney(minor: bigint | string, locale: Locale): string {
  const value = typeof minor === "bigint" ? minor : BigInt(minor);
  const fractionDigits = value % 100n === 0n ? 0 : 2;

  /*
   * The division to major units is the only place this leaves exact
   * integer arithmetic, and it is the last step before display. Property
   * prices are nowhere near the safe-integer ceiling (2^53 minor units
   * is about €90 trillion), and the value travelled here exactly.
   */
  return new Intl.NumberFormat(BCP47[locale], {
    style: "currency",
    currency: AUCTION_CURRENCY,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(value) / 100);
}
