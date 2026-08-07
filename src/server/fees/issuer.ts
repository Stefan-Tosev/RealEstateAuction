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

export type Issuer = {
  name: string;
  eik: string;
  /** Empty until the business is ДДС registered — see FeeSchedule. */
  vat: string;
  address: string;
  iban: string;
};

export function issuer(): Issuer {
  return {
    name: process.env.INVOICE_ISSUER_NAME ?? "",
    eik: process.env.INVOICE_ISSUER_EIK ?? "",
    vat: process.env.INVOICE_ISSUER_VAT ?? "",
    address: process.env.INVOICE_ISSUER_ADDRESS ?? "",
    iban: process.env.INVOICE_ISSUER_IBAN ?? "",
  };
}

/**
 * What is still missing before an invoice may be raised.
 *
 * ДДС number is deliberately not required: a business below the
 * registration threshold has none, charges none, and its invoices are
 * correct without one.
 */
export function issuerBlockers(): string[] {
  const details = issuer();
  const missing: string[] = [];

  if (!details.name) missing.push("registered name (INVOICE_ISSUER_NAME)");
  if (!details.eik) missing.push("ЕИК (INVOICE_ISSUER_EIK)");
  if (!details.address) missing.push("address (INVOICE_ISSUER_ADDRESS)");
  if (!details.iban) missing.push("IBAN for payment (INVOICE_ISSUER_IBAN)");

  return missing;
}
