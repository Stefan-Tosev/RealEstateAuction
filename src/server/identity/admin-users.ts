import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "./password";

export function findAdminByEmail(email: string) {
  return prisma.adminUser.findUnique({ where: { email } });
}

/*
 * A throwaway hash used only to burn the same CPU when no account
 * matches. Without it, a missing email returns in ~0ms while a wrong
 * password costs ~31ms of Argon2 — a timing oracle that tells an
 * attacker which admin addresses exist, regardless of the generic
 * error message shown in the UI.
 *
 * Required by docs/server-validation.md §4: "Hash with a constant-cost
 * path even when the request is going to fail for other reasons."
 *
 * Computed once, lazily, so startup is not charged for it.
 */
let dummyHash: Promise<string> | undefined;
function getDummyHash() {
  dummyHash ??= hashPassword("no-account-with-this-email");
  return dummyHash;
}

export async function verifyAdminCredentials(email: string, password: string) {
  const admin = await findAdminByEmail(email);

  // Always verify against *something*, so both paths cost the same.
  const passwordMatches = await verifyPassword(
    password,
    admin ? admin.passwordHash : await getDummyHash(),
  );

  if (!admin || !passwordMatches) return null;

  return admin;
}
