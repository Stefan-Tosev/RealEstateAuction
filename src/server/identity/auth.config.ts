import type { NextAuthConfig } from "next-auth";

// Edge-safe config: no providers here, so this can be imported by
// middleware (Edge runtime) without pulling in Prisma or the native
// Argon2 addon used by the Credentials provider's authorize() in auth.ts.
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
  providers: [],
  /*
   * Auth.js validates the incoming Host header in production and rejects
   * anything it was not told to expect — `UntrustedHost`. Development
   * trusts the host implicitly, so without this the admin login works
   * perfectly under `next dev` and fails outright under `next start`.
   * That is a deploy-day outage, and it is invisible to any test suite
   * that only ever runs the dev server.
   *
   * Trusting the host means Auth.js derives its callback URLs from the
   * request rather than from a pinned value, so the deployment MUST sit
   * behind a proxy that sets Host itself and does not pass an attacker's
   * through. Set AUTH_URL to the canonical origin in every deployed
   * environment — with it set, Auth.js uses that instead of guessing,
   * which is what actually closes host-header poisoning.
   *
   * Sign-in redirects are relative (`redirectTo: "/admin"`), so there is
   * no open-redirect surface here today; revisit if that changes.
   */
  trustHost: true,
  callbacks: {
    /*
     * `kind` distinguishes an operator session from a bidder one. It is
     * set here, from the provider's authorize() result, and never
     * inferred downstream — a check that reasons "it has a role, so it
     * must be an admin" is one refactor away from letting a bidder
     * through.
     */
    jwt({ token, user }) {
      if (user) {
        token.subjectId = user.id;
        token.kind = user.kind;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.subjectId) session.user.id = token.subjectId;
      if (token.kind) session.user.kind = token.kind;
      // Absent for bidders, and that is the point.
      session.user.role = token.role;
      return session;
    },
  },
} satisfies NextAuthConfig;
