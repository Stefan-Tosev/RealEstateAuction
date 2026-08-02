import type { NextAuthConfig } from "next-auth";

// Edge-safe config: no providers here, so this can be imported by
// middleware (Edge runtime) without pulling in Prisma or the native
// Argon2 addon used by the Credentials provider's authorize() in auth.ts.
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.adminUserId = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.adminUserId) {
        session.user.id = token.adminUserId;
      }
      if (token.role) {
        session.user.role = token.role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
