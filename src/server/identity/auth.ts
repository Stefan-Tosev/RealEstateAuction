import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { authConfig } from "./auth.config";
import { verifyAdminCredentials } from "./admin-users";
import { verifyBidderCredentials } from "./bidder-users";

/*
 * Node-only: safe to touch Prisma and the native Argon2 addon here.
 * Middleware must import auth.config.ts directly instead, not this file.
 *
 * Two credentials providers, two populations, one session shape
 * distinguished by `kind`. They are separate providers rather than one
 * that checks both tables, so an operator address and a bidder address
 * can never be confused for one another — signing in at /admin/login
 * consults admin_users and nothing else.
 */

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "admin",
      name: "Operator",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = stringField(credentials?.email);
        const password = stringField(credentials?.password);
        if (!email || !password) return null;

        const admin = await verifyAdminCredentials(email, password);
        if (!admin) return null;

        await prisma.adminUser.update({
          where: { id: admin.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          kind: "admin" as const,
          role: admin.role,
        };
      },
    }),

    Credentials({
      id: "bidder",
      name: "Bidder",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = stringField(credentials?.email);
        const password = stringField(credentials?.password);
        if (!email || !password) return null;

        const result = await verifyBidderCredentials(email, password);
        /*
         * Returning null for every failure keeps the reason out of the
         * session layer. The UI distinguishes "unverified" from "wrong
         * password" by asking separately, rather than by having the auth
         * response spell it out.
         */
        if (!result.ok) return null;

        return {
          id: result.user.id,
          email: result.user.email,
          name: `${result.user.firstName} ${result.user.lastName}`.trim(),
          kind: "bidder" as const,
          // Deliberately no role: a bidder has no AdminRole, and giving
          // them a placeholder one would invite a check that treats its
          // presence as authority.
        };
      },
    }),
  ],
});
