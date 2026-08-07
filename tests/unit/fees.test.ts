import { describe, expect, it } from "vitest";
import { addVat, fixedFee, percentFee } from "@/server/fees/calculate";
import { premiumOn, premiumRateLabel } from "@/server/fees/disclosure";
import { formatMoney } from "@/lib/money";
import {
  BUYER_PREMIUM_BPS,
  ENTRY_FEE_NET_MINOR,
  SELLER_COMMISSION_BPS,
  VAT_RATE_BPS,
  WITHDRAWAL_FIXED_NET_MINOR,
  bpsToRate,
} from "@/server/fees/schedule";

/*
 * Fee arithmetic (§10).
 *
 * Pure, so no database — which is the point of keeping the sums out of
 * the service that writes the rows.
 */

const eur = (n: number) => BigInt(Math.round(n * 100));

describe("ДДС", () => {
  it("is worked out on the net, and both parts are kept", () => {
    /*
     * A Bulgarian invoice shows base and ДДС as two lines. A row
     * carrying only the gross cannot produce one, which is why nothing
     * here returns a single blended number.
     */
    const fee = addVat(eur(10_000), VAT_RATE_BPS);

    expect(fee.netMinor).toBe(eur(10_000));
    expect(fee.vatMinor).toBe(eur(2_000));
    expect(fee.grossMinor).toBe(eur(12_000));
  });

  it("charges nothing when the rate is zero", () => {
    // A business below the registration threshold. The row still exists
    // and still reconciles; the ДДС is simply zero.
    const fee = addVat(eur(500), 0);
    expect(fee.vatMinor).toBe(0n);
    expect(fee.grossMinor).toBe(eur(500));
  });

  it("rounds to the cent, half away from zero", () => {
    // 20% of 1 cent is 0.2 of a cent.
    expect(addVat(1n, VAT_RATE_BPS).vatMinor).toBe(0n);
    // 20% of 3 cents is 0.6 of a cent.
    expect(addVat(3n, VAT_RATE_BPS).vatMinor).toBe(1n);
    // Exactly half.
    expect(addVat(25n, VAT_RATE_BPS).vatMinor).toBe(5n);
  });

  it("refuses a negative amount rather than rounding it the wrong way", () => {
    // Integer division truncates toward zero, so the half-up trick is
    // only correct for positives. Better to throw than to be plausibly
    // wrong about money.
    expect(() => addVat(-100n, VAT_RATE_BPS)).toThrow(/negative/);
  });
});

describe("percentage fees", () => {
  it("takes ДДС of the commission, not of the sale", () => {
    /*
     * Compounding the two would overcharge by 0.5% of the hammer at
     * these rates — €1,725 of somebody's money on a €345,000 lot.
     */
    const fee = percentFee(eur(345_000), SELLER_COMMISSION_BPS, VAT_RATE_BPS);

    expect(fee.netMinor).toBe(eur(8_625)); // 2.5%
    expect(fee.vatMinor).toBe(eur(1_725)); // 20% of 8,625
    expect(fee.grossMinor).toBe(eur(10_350)); // 3.0% of the hammer
  });

  it("comes to 3% gross on both sides, which is the whole pitch", () => {
    /*
     * Bulgarian agency convention is 3% + ДДС, quoted as 3.6%, charged
     * to each party. Undercutting it by 0.6 points is only true if BOTH
     * sides are cut — a seller comparing quotes looks at the seller
     * rate, and they are the side that chooses the auction house.
     */
    const hammer = eur(100_000);

    const seller = percentFee(hammer, SELLER_COMMISSION_BPS, VAT_RATE_BPS);
    const buyer = percentFee(hammer, BUYER_PREMIUM_BPS, VAT_RATE_BPS);

    expect(seller.grossMinor).toBe(eur(3_000));
    expect(buyer.grossMinor).toBe(eur(3_000));

    // The saving against a 3.6% broker, per side, on a €100,000 sale.
    expect(eur(3_600) - seller.grossMinor).toBe(eur(600));
  });

  it("stays exact on an amount a float would not survive", () => {
    // 0.025 * 19.99 is 0.49975000000000003 in floating point. All of
    // this is integers, so the answer is the answer.
    const fee = percentFee(eur(19.99), SELLER_COMMISSION_BPS, VAT_RATE_BPS);
    expect(fee.netMinor).toBe(50n); // 49.975 cents, rounded
  });

  it("handles a hammer price beyond the safe-integer range", () => {
    // 2.5% of 9,999,999,999,999,999 is 249,999,999,999,999.975 — past
    // Number.MAX_SAFE_INTEGER, so a float would already have given up on
    // the last few digits before rounding.
    const fee = percentFee(9_999_999_999_999_999n, SELLER_COMMISSION_BPS, VAT_RATE_BPS);
    expect(fee.netMinor).toBe(250_000_000_000_000n);
  });
});

describe("the schedule", () => {
  it("prices the entry and withdrawal fees as decided", () => {
    expect(fixedFee(ENTRY_FEE_NET_MINOR, VAT_RATE_BPS).grossMinor).toBe(eur(360));

    // Entry fee plus the fixed sum, per §10's shape.
    const withdrawal = fixedFee(ENTRY_FEE_NET_MINOR + WITHDRAWAL_FIXED_NET_MINOR, VAT_RATE_BPS);
    expect(withdrawal.netMinor).toBe(eur(1_300));
    expect(withdrawal.grossMinor).toBe(eur(1_560));
  });

  it("records rates in a form an invoice can quote", () => {
    expect(bpsToRate(SELLER_COMMISSION_BPS)).toBe("0.0250");
    expect(bpsToRate(VAT_RATE_BPS)).toBe("0.2000");
  });
});

describe("what the bidder is told", () => {
  /*
   * The premium was billed before this existed and disclosed nowhere —
   * the word did not appear on a single public page. Charging a fee
   * somebody was never shown is a consumer-protection problem before it
   * is a trust problem, and these assertions are what stop it silently
   * disappearing again.
   */
  it("quotes the GROSS rate, because that is what leaves the buyer's account", () => {
    // 2.5% net is what the house keeps; 3% is what the buyer pays.
    expect(premiumRateLabel()).toBe("3%");
  });

  it("spells out the premium and the real total, not just a percentage", () => {
    const disclosed = premiumOn(eur(350_000), "en");

    expect(disclosed.amountFormatted).toBe("€10,500");
    expect(disclosed.totalFormatted).toBe("€360,500");
  });

  it("agrees exactly with what raiseSaleFees will bill", () => {
    /*
     * The disclosure and the invoice are derived from the same
     * constants. A disclosure computed from its own copy of the rate is
     * one that eventually tells a buyer the wrong number.
     */
    const hammer = eur(345_000);
    const billed = percentFee(hammer, BUYER_PREMIUM_BPS, VAT_RATE_BPS);
    const disclosed = premiumOn(hammer, "en");

    expect(disclosed.amountFormatted).toBe(formatMoney(billed.grossMinor, "en"));
    expect(disclosed.totalFormatted).toBe(formatMoney(hammer + billed.grossMinor, "en"));
  });

  it("says it in Bulgarian too", () => {
    // formatMoney drops the decimals on a round amount by design.
    expect(premiumOn(eur(350_000), "bg").amountFormatted).toBe("10 500 €");
  });
});
