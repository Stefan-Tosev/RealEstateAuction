import { describe, expect, it } from "vitest";
import {
  INVOICE_LINK_TTL_MS,
  signInvoicePath,
  verifyInvoiceSignature,
} from "@/server/fees/invoice-link";

/*
 * This link is a bearer token: unlike a document link, nothing behind it
 * re-checks who is holding it. Every test here is therefore about the
 * signature being the only thing standing between an emailed URL and
 * somebody else's invoice.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

function parts(path: string): { exp: string; sig: string } {
  const query = new URL(path, "https://example.test").searchParams;
  return { exp: query.get("exp")!, sig: query.get("sig")! };
}

describe("invoice links", () => {
  it("verifies a link it just minted", () => {
    const { exp, sig } = parts(signInvoicePath(A, NOW));
    expect(verifyInvoiceSignature(A, exp, sig, NOW)).toBe("ok");
  });

  it("refuses a link minted for a different invoice", () => {
    // The failure this prevents: a seller with one genuine link editing
    // the id in the address bar and reading somebody else's invoice.
    const { exp, sig } = parts(signInvoicePath(A, NOW));
    expect(verifyInvoiceSignature(B, exp, sig, NOW)).toBe("bad-signature");
  });

  it("refuses a tampered expiry", () => {
    // Extending the window must not be something the holder can do.
    const { sig } = parts(signInvoicePath(A, NOW));
    const later = String(NOW + INVOICE_LINK_TTL_MS * 10);
    expect(verifyInvoiceSignature(A, later, sig, NOW)).toBe("bad-signature");
  });

  it("refuses a tampered signature of the right length", () => {
    const { exp, sig } = parts(signInvoicePath(A, NOW));
    const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    expect(verifyInvoiceSignature(A, exp, flipped, NOW)).toBe("bad-signature");
  });

  it("refuses a missing signature or expiry", () => {
    const { exp, sig } = parts(signInvoicePath(A, NOW));
    expect(verifyInvoiceSignature(A, null, sig, NOW)).toBe("bad-signature");
    expect(verifyInvoiceSignature(A, exp, null, NOW)).toBe("bad-signature");
  });

  it("refuses an unparseable expiry rather than treating it as zero", () => {
    const { sig } = parts(signInvoicePath(A, NOW));
    expect(verifyInvoiceSignature(A, "soon", sig, NOW)).toBe("bad-signature");
  });

  it("holds for the whole payment term and expires after it", () => {
    const { exp, sig } = parts(signInvoicePath(A, NOW));

    // A day before the term is up, and on the last millisecond of it.
    expect(verifyInvoiceSignature(A, exp, sig, NOW + INVOICE_LINK_TTL_MS - 86_400_000)).toBe("ok");
    expect(verifyInvoiceSignature(A, exp, sig, NOW + INVOICE_LINK_TTL_MS)).toBe("ok");

    expect(verifyInvoiceSignature(A, exp, sig, NOW + INVOICE_LINK_TTL_MS + 1)).toBe("expired");
  });

  it("tells a forged link from a stale one only when the signature is genuine", () => {
    // An expired link is answered "expired"; a forged one is answered
    // "bad-signature" whether or not its expiry has passed, so guessing
    // learns nothing from the difference.
    const { exp } = parts(signInvoicePath(A, NOW));
    const forged = "x".repeat(43);
    expect(verifyInvoiceSignature(A, exp, forged, NOW + INVOICE_LINK_TTL_MS + 1)).toBe(
      "bad-signature",
    );
  });
});
