import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Signed links to an invoice, for the party it bills.
 *
 * Sellers are records rather than accounts — §11 — so there is no
 * session to authenticate a seller against, and an invoice has to reach
 * one by email or not at all. The link is therefore a bearer token: the
 * signature is the whole of the authorisation, which is exactly what it
 * is not in signed-url.ts, where the document route re-checks
 * entitlement on every request.
 *
 * That difference drives everything here:
 *
 *  - The invoice id is a uuid, so the link cannot be guessed, and the
 *    signature means it cannot be constructed from a known id either.
 *
 *  - The window is long, because an invoice is read when the recipient
 *    gets round to it, not within five minutes of being sent. Thirty
 *    days is the usual payment term; a link that dies before the money
 *    is due generates a support call rather than a payment.
 *
 *  - Nothing here exposes anything the recipient does not already have.
 *    An invoice names its own issuer and its own billed party, and it
 *    was sent to that party. There is no reserve price, no bidder
 *    identity, and no other lot on it.
 */

const SECRET = process.env.AUTH_SECRET ?? "development-only-invoice-signing-key";

/** A payment term, not a click window. See above. */
export const INVOICE_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sign(invoiceId: string, expiresAt: number): string {
  return createHmac("sha256", SECRET).update(`invoice.${invoiceId}.${expiresAt}`).digest("base64url");
}

/**
 * The path, without a locale. The caller prefixes the recipient's own
 * language, and the signature deliberately does not cover it: a
 * Bulgarian seller forwarding the link to an English-speaking accountant
 * should be able to switch language without the link dying.
 */
export function signInvoicePath(invoiceId: string, now = Date.now()): string {
  const expiresAt = now + INVOICE_LINK_TTL_MS;
  return `/invoices/${invoiceId}?exp=${expiresAt}&sig=${sign(invoiceId, expiresAt)}`;
}

export type InvoiceLinkVerdict = "ok" | "expired" | "bad-signature";

export function verifyInvoiceSignature(
  invoiceId: string,
  exp: string | null,
  sig: string | null,
  now = Date.now(),
): InvoiceLinkVerdict {
  if (!exp || !sig) return "bad-signature";

  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt)) return "bad-signature";

  const expected = sign(invoiceId, expiresAt);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Length first: timingSafeEqual throws when the two differ.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "bad-signature";

  /*
   * Checked after the signature, so a forged link and a stale one are
   * not distinguishable by which answer comes back. Someone holding a
   * genuine expired link is told it expired; someone guessing is told
   * nothing at all.
   */
  if (expiresAt < now) return "expired";

  return "ok";
}
