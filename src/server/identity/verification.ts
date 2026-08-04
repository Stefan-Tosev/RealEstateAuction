import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

/*
 * Email verification tokens, per docs/server-validation.md §5:
 * "valid 24 h, single-use, >=128 bits entropy, hashed at rest".
 */

const TOKEN_BYTES = 32; // 256 bits, comfortably above the 128 required
const TTL_MS = 24 * 60 * 60 * 1000;

/** The database stores only this. The plaintext exists once, in the email. */
function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function issueVerificationToken(userId: string): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");

  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });

  return token;
}

export type VerifyOutcome =
  | { ok: true; userId: string }
  | { ok: false; reason: "unknown" | "expired" | "already_used" };

/**
 * Redeem a token.
 *
 * The distinction between "unknown" and "already used" is deliberate and
 * safe: it is only reachable by someone already holding a valid token,
 * and telling them "you have already confirmed this" is far better than
 * an unexplained failure. Used tokens are kept rather than deleted for
 * exactly this.
 */
export async function redeemVerificationToken(token: string): Promise<VerifyOutcome> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!record) return { ok: false, reason: "unknown" };
  if (record.usedAt) return { ok: false, reason: "already_used" };
  if (record.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  /*
   * Mark used and verify the account together. Without the transaction a
   * crash between the two leaves a spent token and an unverified user —
   * an account that can never be confirmed.
   */
  await prisma.$transaction([
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    }),
  ]);

  return { ok: true, userId: record.userId };
}

/**
 * Constant-time comparison helper for callers comparing tokens
 * themselves. Not used by the lookup above — that is an indexed hash
 * equality in the database, which leaks nothing useful.
 */
export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
