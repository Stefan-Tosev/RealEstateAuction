/*
 * Fee arithmetic — the only place a percentage or a ДДС amount is
 * worked out.
 *
 * Same rule as src/lib/money.ts formatting: one owner, so two parts of
 * the system cannot round differently and produce an invoice that does
 * not add up. All of it is integer arithmetic on minor units.
 */

/**
 * Round half away from zero, on integers.
 *
 * `(a + b/2) / b` is the usual trick, and it is only correct for
 * positives — integer division in JS truncates toward zero, so a
 * negative would round the wrong way. Fees are never negative, and this
 * throws rather than quietly returning a plausible wrong number if that
 * ever stops being true.
 */
function scale(amount: bigint, numerator: bigint, denominator: bigint): bigint {
  if (amount < 0n) throw new Error("Fee arithmetic is not defined for negative amounts.");
  return (amount * numerator + denominator / 2n) / denominator;
}

export type FeeAmount = {
  netMinor: bigint;
  vatMinor: bigint;
  /** What an invoice totals. Never stored — it is always net + vat. */
  grossMinor: bigint;
};

/** ДДС on a net amount. Rounded once, here. */
export function addVat(netMinor: bigint, vatRateBps: number): FeeAmount {
  const vatMinor = scale(netMinor, BigInt(vatRateBps), 10_000n);
  return { netMinor, vatMinor, grossMinor: netMinor + vatMinor };
}

/**
 * A percentage fee on the hammer price, plus ДДС.
 *
 * The percentage is taken of the hammer, and ДДС of the result — not of
 * the hammer. Compounding the two would overcharge, by 0.5% of the sale
 * at these rates, which on a €345,000 lot is €1,725 of somebody's money.
 */
export function percentFee(
  baseMinor: bigint,
  rateBps: number,
  vatRateBps: number,
): FeeAmount {
  const netMinor = scale(baseMinor, BigInt(rateBps), 10_000n);
  return addVat(netMinor, vatRateBps);
}

/** A fixed fee, plus ДДС. */
export function fixedFee(netMinor: bigint, vatRateBps: number): FeeAmount {
  return addVat(netMinor, vatRateBps);
}
