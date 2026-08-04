import type { AdminRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AdminRole;
    } & DefaultSession["user"];
  }

  interface User {
    role: AdminRole;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    adminUserId?: string;
    role?: AdminRole;
  }
}
