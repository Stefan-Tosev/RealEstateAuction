"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/locales";
import { bidderSignInAction } from "./actions";

/*
 * Bidder sign-in.
 *
 * One message for every failure — wrong password, unknown address, or an
 * unconfirmed account. Distinguishing them would tell an attacker which
 * addresses are registered, which is the same oracle §5 closes on the
 * registration side.
 */
export function SignInForm({ locale, t }: { locale: Locale; t: Dictionary }) {
  const action = bidderSignInAction.bind(null, locale);
  const [error, formAction, pending] = useActionState<string | undefined, FormData>(
    action,
    undefined,
  );

  return (
    <form className="form-card" action={formAction} noValidate>
      {error ? (
        <p className="form-notice" data-tone="error" role="alert">
          {t.signIn.failed}
        </p>
      ) : null}

      <div className="field">
        <label className="field-label" htmlFor="email">
          {t.signIn.email}
        </label>
        <input className="field-input" id="email" name="email" type="email" autoComplete="username" />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="password">
          {t.signIn.password}
        </label>
        <input
          className="field-input"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
        />
      </div>

      <button className="btn btn-brass btn-lg btn-full" type="submit" disabled={pending}>
        {pending ? t.signIn.submitting : t.signIn.submit}
      </button>

      <p className="form-footer">
        {t.signIn.noAccount} <Link href={`/${locale}/register`}>{t.signIn.register}</Link>
      </p>
    </form>
  );
}
