import { prisma } from "@/lib/prisma";
import { verifyPassword } from "./password";

export function findAdminByEmail(email: string) {
  return prisma.adminUser.findUnique({ where: { email } });
}

export async function verifyAdminCredentials(email: string, password: string) {
  const admin = await findAdminByEmail(email);
  if (!admin) return null;

  const passwordMatches = await verifyPassword(password, admin.passwordHash);
  if (!passwordMatches) return null;

  return admin;
}
