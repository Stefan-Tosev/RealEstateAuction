import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "./password";
import { normalisePassword } from "./password-policy";

/*
 * Bidder sign-in, against the `users` table.
 *
 * Mirrors admin-users.ts, including the constant-cost path: skipping the
 * Argon2 verify when no account matches returns in ~0ms while a wrong
 * password costs ~31ms, which is a working oracle for which addresses
 * exist no matter how generic the error message is. §5 asks for the same
 * discipline on sign-in as on registration.
 */

let dummyHash: Promise<string> | undefined;
function getDummyHash() {
  dummyHash ??= hashPassword("no-bidder-with-this-email");
  return dummyHash;
}

export type BidderSignInResult =
  | { ok: true; user: { id: string; email: string; firstName: string; lastName: string } }
  | { ok: false; reason: "invalid" | "unverified" | "suspended" };

export async function verifyBidderCredentials(
  email: string,
  password: string,
): Promise<BidderSignInResult> {
  // Citext column: case-insensitive without lowercasing for storage.
  const user = await prisma.user.findUnique({ where: { email } });

  // NFKC before comparison, matching how it was hashed at registration.
  const matches = await verifyPassword(
    normalisePassword(password),
    user ? user.passwordHash : await getDummyHash(),
  );

  if (!user || !matches) return { ok: false, reason: "invalid" };

  /*
   * An unverified address must not sign in — otherwise the verification
   * step is decorative and anyone can create a working account with
   * someone else's address. Reported distinctly from "invalid" because
   * the caller has already proven they hold the password, so nothing is
   * disclosed that they do not know.
   */
  if (!user.emailVerifiedAt) return { ok: false, reason: "unverified" };

  if (user.status !== "active") return { ok: false, reason: "suspended" };

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    },
  };
}
