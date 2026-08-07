/*
 * Who the invoice is FROM.
 *
 * A Bulgarian фактура has to carry the issuer's registered name, ЕИК,
 * ДДС number where registered, and an address. None of that is
 * knowable from the code — it is the auction house's own registration —
 * so it lives in configuration and is checked before an invoice can be
 * raised.
 *
 * Refusing to issue rather than issuing a document with placeholders in
 * it. An invoice missing the issuer's ЕИК is not a defective invoice, it
 * is not an invoice — and one already sent to a seller cannot be
 * unsent.
 */

/**
 * Whether these are placeholder details rather than a real registration.
 *
 * Explicit rather than inferred from the values, because inferring it
 * means the day somebody types a real ЕИК into a demo deployment, every
 * safeguard silently switches off.
 */
export function isDemoIssuer(): boolean {
  return process.env.INVOICE_DEMO_MODE === "true";
}

/**
 * The numbering series.
 *
 * Demo invoices get their OWN series, and this is the part that actually
 * matters. Share a series and going live means the first real invoice is
 * number 0000000021, with 1 to 20 existing nowhere in the accounts — a
 * gap of exactly the kind the counter design exists to prevent, created
 * on purpose by the demo.
 *
 * A separate series means real numbering starts at 1 on the day it
 * becomes real.
 */
export function invoiceSeries(now = new Date()): string {
  const year = String(now.getFullYear());
  return isDemoIssuer() ? `DEMO-${year}` : year;
}

export type Issuer = {
  name: string;
  eik: string;
  /** Empty until the business is ДДС registered — see FeeSchedule. */
  vat: string;
  address: string;
  iban: string;
};

/*
 * Placeholders for demo mode, chosen so they cannot possibly belong to
 * anybody.
 *
 * Not generated. A plausible-looking ЕИК is the problem, not the goal:
 * any nine digits with a valid check digit stand a fair chance of being
 * a real registered Bulgarian company, and putting somebody else's
 * registration number on an invoice — even a specimen — is not a
 * hypothetical harm. The number below FAILS its own checksum on purpose,
 * which is asserted by a test, so it can never match a real company.
 *
 * The same reasoning applies to the name and the IBAN: both say DEMO in
 * them, because a demo document that reads as real is the failure.
 */
const DEMO: Issuer = {
  name: "DEMO Auction House (not a registered company)",
  // Fails the mod-11 check digit, asserted by a test. 000000000 does NOT
  // — it passes, which is exactly the assumption the test was written to
  // catch.
  eik: "999999999",
  vat: "",
  address: "DEMO — no registered address",
  iban: "BG00DEMO00000000000000",
};

export function issuer(): Issuer {
  /*
   * Env wins even in demo mode, so a real value can be tried one at a
   * time on the way to going live.
   */
  const configured: Issuer = {
    name: process.env.INVOICE_ISSUER_NAME ?? "",
    eik: process.env.INVOICE_ISSUER_EIK ?? "",
    vat: process.env.INVOICE_ISSUER_VAT ?? "",
    address: process.env.INVOICE_ISSUER_ADDRESS ?? "",
    iban: process.env.INVOICE_ISSUER_IBAN ?? "",
  };

  if (!isDemoIssuer()) return configured;

  return {
    name: configured.name || DEMO.name,
    eik: configured.eik || DEMO.eik,
    vat: configured.vat,
    address: configured.address || DEMO.address,
    iban: configured.iban || DEMO.iban,
  };
}

/** Exposed so a test can assert the demo ЕИК could never be a real one. */
export const DEMO_ISSUER = DEMO;

/**
 * What is still missing before an invoice may be raised.
 *
 * ДДС number is deliberately not required: a business below the
 * registration threshold has none, charges none, and its invoices are
 * correct without one.
 */
export function issuerBlockers(): string[] {
  /*
   * Demo mode supplies its own complete set, so nothing is missing —
   * that is the whole point of it: invoicing works end to end before the
   * company exists.
   */
  const details = issuer();
  const missing: string[] = [];

  if (!details.name) missing.push("registered name (INVOICE_ISSUER_NAME)");
  if (!details.eik) missing.push("ЕИК (INVOICE_ISSUER_EIK)");
  if (!details.address) missing.push("address (INVOICE_ISSUER_ADDRESS)");
  if (!details.iban) missing.push("IBAN for payment (INVOICE_ISSUER_IBAN)");

  return missing;
}
