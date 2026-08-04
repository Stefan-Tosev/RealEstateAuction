"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/server/identity/auth";

export async function loginAction(_prevState: string | undefined, formData: FormData) {
  const email = formData.get("email");
  const password = formData.get("password");

  try {
    // Provider id, not a generic label: "admin" consults admin_users and
    // nothing else, so a bidder address can never sign in here.
    await signIn("admin", {
      email,
      password,
      redirectTo: "/admin",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return "Invalid email or password.";
    }
    // NEXT_REDIRECT (successful sign-in) and unexpected errors both rethrow.
    throw error;
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/admin/login" });
}
