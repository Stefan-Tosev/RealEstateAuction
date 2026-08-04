"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/server/identity/auth";

/**
 * Signs in against the `bidder` provider specifically, which consults
 * the users table and nothing else — an operator address cannot be used
 * here, and a bidder address cannot be used at /admin/login.
 */
export async function bidderSignInAction(
  locale: string,
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const email = formData.get("email");
  const password = formData.get("password");

  try {
    await signIn("bidder", {
      email,
      password,
      redirectTo: `/${locale}/lots`,
    });
  } catch (error) {
    // A single generic failure, deliberately: see sign-in-form.tsx.
    if (error instanceof AuthError) return "invalid";
    // NEXT_REDIRECT on success, and anything unexpected, both rethrow.
    throw error;
  }
}
