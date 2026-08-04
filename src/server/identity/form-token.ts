import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Signed form tokens, for the time gate in docs/server-validation.md §6:
 * "Submitted <2 s after page load → discard."
 *
 * The obvious implementation — have the client measure elapsed time and
 * send it — is worthless, because the number is the attacker's to
 * choose. So the server issues an HMAC-signed timestamp when the form
 * renders, and checks the signature and the age on submission. A bot
 * cannot forge a token, and a replayed old one fails the upper bound.
 *
 * Not a CSRF token: this proves *when* the form was served, not who it
 * was served to.
 */

const SECRET = process.env.AUTH_SECRET ?? "development-only-form-token-key";

/** Faster than this and nobody read the form. */
export const MIN_FILL_MS = 2_000;
/** Older than this and the page has been sitting open long enough to be stale. */
export const MAX_AGE_MS = 2 * 60 * 60 * 1000;

function sign(issuedAt: number): string {
  return createHmac("sha256", SECRET).update(String(issuedAt)).digest("base64url");
}

export function issueFormToken(now = Date.now()): string {
  return `${now}.${sign(now)}`;
}

export type FormTokenVerdict = "ok" | "malformed" | "too-fast" | "expired" | "bad-signature";

export function verifyFormToken(token: unknown, now = Date.now()): FormTokenVerdict {
  if (typeof token !== "string") return "malformed";

  const [issuedRaw, signature] = token.split(".");
  if (!issuedRaw || !signature) return "malformed";

  const issuedAt = Number(issuedRaw);
  if (!Number.isFinite(issuedAt)) return "malformed";

  const expected = sign(issuedAt);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "bad-signature";

  const age = now - issuedAt;
  // A token from the future means a tampered timestamp that happens to
  // carry a valid signature only if the secret leaked — treat as bad.
  if (age < 0) return "bad-signature";
  if (age < MIN_FILL_MS) return "too-fast";
  if (age > MAX_AGE_MS) return "expired";

  return "ok";
}
