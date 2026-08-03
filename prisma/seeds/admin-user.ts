import { prisma } from "../../src/lib/prisma";
import { hashPassword } from "../../src/server/identity/password";

/*
 * Extracted from seed.ts unchanged. Idempotent by early exit rather than
 * upsert, so re-seeding never rewrites the password hash of an admin who
 * has since changed it.
 */
export async function seedAdminUser() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set to seed the first admin user.");
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin user ${email} already exists, skipping.`);
    return existing;
  }

  const passwordHash = await hashPassword(password);
  const admin = await prisma.adminUser.create({
    data: { email, passwordHash, name: "Admin", role: "admin" },
  });

  console.log(`Created admin user ${admin.email}.`);
  return admin;
}
