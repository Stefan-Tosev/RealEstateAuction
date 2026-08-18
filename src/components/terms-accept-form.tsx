"use client";

import { useActionState, useId } from "react";
import { acceptTermsAction, type AcceptState } from "@/app/(public)/[locale]/terms/accept/actions";

/*
 * Accepting a revised set of terms.
 *
 * Copy is passed in rather than looked up: the dictionaries are
 * server-only, and the action returns a code precisely so the message
 * can be rendered in the page's language.
 *
 * The wording travels with the submission because it is what gets stored
 * verbatim beside the version. The record has to say what this bidder
 * actually read, which only the page that rendered it knows.
 */
export function TermsAcceptForm({
  locale,
  wording,
  returnTo,
  copy,
}: {
  locale: string;
  wording: string;
  returnTo: string;
  copy: { submit: string; errorNotTicked: string; signin: string; accepted: string };
}) {
  const [state, formAction, pending] = useActionState<AcceptState, FormData>(
    acceptTermsAction.bind(null, locale, wording, returnTo),
    undefined,
  );

  const checkboxId = useId();
  const errorId = useId();

  const message =
    state?.code === "errorNotTicked"
      ? copy.errorNotTicked
      : state?.code === "signin"
        ? copy.signin
        : null;

  /*
   * novalidate throughout: native constraint bubbles render in the
   * browser's locale and ignore the site's language, and leaving them on
   * means the server rule never gets exercised.
   */
  return (
    <form action={formAction} noValidate className="form-card">
      <fieldset className="field-group">
        {/* Unticked. Pre-ticked consent is invalid under GDPR. */}
        <div className="consent">
          <input
            type="checkbox"
            id={checkboxId}
            name="terms"
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? errorId : undefined}
          />
          <label htmlFor={checkboxId}>{wording}</label>
        </div>
      </fieldset>

      {message ? (
        <p className="field-error" id={errorId} role="alert">
          {/* Never colour alone: the glyph carries the meaning too. */}
          <span aria-hidden="true">⚠ </span>
          {message}
        </p>
      ) : null}

      <button type="submit" className="btn btn-brass btn-lg btn-full" disabled={pending}>
        {copy.submit}
      </button>
    </form>
  );
}
