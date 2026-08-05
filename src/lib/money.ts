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
 * Parse an amount a person typed into minor units, or null if it is not
 * an amount.
 *
 * This exists because the obvious version is dangerous. Stripping spaces
 * and commas as group separators — which is what every call site used to
 * do — turns the Bulgarian way of writing money into a hundredfold
 * error: `formatMoney` renders €345,000.50 as "345 000,50 €", and a
 * bidder who types it back the way the site showed it bid €34,500,050.
 * The amount passes every downstream check, because it is above the
 * minimum, and a bid is binding.
 *
 * So the separators are decided rather than assumed:
 *
 *   - Spaces of every kind are always grouping. No locale uses one as a
 *     decimal point.
 *   - If both `.` and `,` appear, the later one is the decimal point and
 *     the earlier one groups. "1.234,56" and "1,234.56" both mean the
 *     same amount.
 *   - If only one appears once with one or two digits after it, it is a
 *     decimal point: "345,50".
 *   - If only one appears once with exactly three digits after it, it is
 *     grouping: "345,000" and "345.000" are both 345000. This is the one
 *     genuinely ambiguous case, and grouping is both conventions'
 *     reading; three decimal places is not a valid amount of money.
 *   - Anything else is refused rather than guessed at.
 */
export function parseMoneyInput(raw: string): bigint | null {
  // NFKC folds the narrow and non-breaking spaces Intl emits into plain
  // ones, so the strip below catches what formatMoney produced.
  let s = raw.normalize("NFKC").trim();
  s = s.replace(/€|EUR|лв\.?|лева/gi, "");
  s = s.replace(/[\s  ']/g, "");

  if (s.length === 0) return null;
  if (!/^[\d.,]+$/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decimalAt = -1;

  if (lastDot >= 0 && lastComma >= 0) {
    decimalAt = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const at = Math.max(lastDot, lastComma);
    const separator = s[at];
    const repeated = s.split(separator).length - 1 > 1;
    const digitsAfter = s.length - at - 1;

    if (repeated) decimalAt = -1;
    else if (digitsAfter === 3) decimalAt = -1;
    else if (digitsAfter === 1 || digitsAfter === 2) decimalAt = at;
    else return null; // "345," or "1.2345" — say so rather than pick one.
  }

  const cleaned =
    decimalAt >= 0
      ? `${s.slice(0, decimalAt).replace(/[.,]/g, "")}.${s.slice(decimalAt + 1)}`
      : s.replace(/[.,]/g, "");

  if (!/^\d*(\.\d{1,2})?$/.test(cleaned)) return null;

  const [whole, fraction = ""] = cleaned.split(".");
  if (whole === "" && fraction === "") return null;

  // String arithmetic throughout — Number("19.99") * 100 is
  // 1998.9999999999998, and this is money.
  return BigInt(whole || "0") * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

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
