import type { AdminRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

/*
 * One Auth.js instance serves two populations: operators (admin_users)
 * and bidders (users). `kind` is what tells them apart, and it is
 * mandatory rather than optional on the session so no code path can
 * forget to consider it.
 *
 * `role` only exists for operators — a bidder has no AdminRole — which
 * is why it is optional. Never infer "this must be an admin" from the
 * presence of a role; assert on `kind`.
 */
export type SessionKind = "admin" | "bidder";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      kind: SessionKind;
      role?: AdminRole;
    } & DefaultSession["user"];
  }

  interface User {
    kind: SessionKind;
    role?: AdminRole;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    /** Present on every authenticated token. */
    kind?: SessionKind;
    subjectId?: string;
    role?: AdminRole;
  }
}
