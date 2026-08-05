import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Short-lived signed download links, per §5: "Serve only through
 * short-lived signed URLs".
 *
 * The signature is not the authorisation — the route re-checks the
 * viewer's entitlement on every request regardless. It exists so a link
 * cannot be constructed by hand, and so one that leaks (a copied URL, a
 * referrer header, a shared screenshot) stops working quickly.
 *
 * Binding the viewer into the signature is what stops a signed link
 * being passed to someone who is not entitled to it: a link minted for
 * one bidder is invalid for anyone else.
 */

const SECRET = process.env.AUTH_SECRET ?? "development-only-document-signing-key";

/** Long enough to click, short enough that a leaked link is stale fast. */
export const LINK_TTL_MS = 5 * 60 * 1000;

function sign(documentId: string, audience: string, expiresAt: number): string {
  return createHmac("sha256", SECRET)
    .update(`${documentId}.${audience}.${expiresAt}`)
    .digest("base64url");
}

/**
 * @param audience stable identifier for who the link is for — a user id,
 *                 or "anonymous" for a public document.
 */
export function signDocumentUrl(documentId: string, audience: string, now = Date.now()): string {
  const expiresAt = now + LINK_TTL_MS;
  return `/api/documents/${documentId}?exp=${expiresAt}&sig=${sign(documentId, audience, expiresAt)}`;
}

export type SignatureVerdict = "ok" | "expired" | "bad-signature";

export function verifyDocumentSignature(
  documentId: string,
  audience: string,
  exp: string | null,
  sig: string | null,
  now = Date.now(),
): SignatureVerdict {
  if (!exp || !sig) return "bad-signature";

  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt)) return "bad-signature";

  const expected = sign(documentId, audience, expiresAt);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on a mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "bad-signature";

  // Signature verified before expiry, so an attacker learns nothing from
  // the difference between "forged" and "stale".
  if (expiresAt < now) return "expired";

  return "ok";
}
