"use client";

import { useState } from "react";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/locales";

/*
 * Stage 1 registration.
 *
 * Two things carried over from the v1 form because CLAUDE.md records why
 * they matter:
 *
 *  - `noValidate` is required. Native constraint bubbles render in the
 *    browser's locale and ignore the site's language, so a Bulgarian
 *    visitor gets English validation text. It also means the server
 *    rules are the ones actually exercised.
 *
 *  - Hidden company fields are cleared on switching account type.
 *    Leaving a hidden field populated produces a form that fails
 *    validation with no visible reason.
 *
 * The API returns error *codes*, never prose — the copy lives here so it
 * can be rendered in whichever language the page is in.
 */

type Errors = Record<string, string>;

export function RegisterForm({
  locale,
  t,
  formToken,
}: {
  locale: Locale;
  t: Dictionary;
  formToken: string;
}) {
  const [accountType, setAccountType] = useState<"individual" | "company">("individual");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const codeToMessage = (code: string): string =>
    (t.errors as Record<string, string>)[code] ?? t.errors.UNKNOWN;

  function switchType(next: "individual" | "company") {
    setAccountType(next);
    // Drop errors for fields that are about to disappear.
    setErrors((prev) => {
      const copy = { ...prev };
      for (const field of ["companyName", "eik", "vat"]) delete copy[field];
      return copy;
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);

    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");

    const payload = {
      accountType,
      firstName: text("firstName"),
      lastName: text("lastName"),
      email: text("email"),
      phone: text("phone"),
      dateOfBirth: text("dateOfBirth"),
      // Cleared rather than sent when the fields are hidden.
      companyName: accountType === "company" ? text("companyName") : null,
      eik: accountType === "company" ? text("eik") : null,
      vat: accountType === "company" ? text("vat") : null,
      password: text("password"),
      // Exactly boolean — the server refuses "on", "true" and 1.
      terms: form.get("terms") === "on",
      marketing: form.get("marketing") === "on",
      website: text("website"),
      formToken,
      locale,
    };

    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.status === 202) {
        setDone(true);
        return;
      }

      const body = (await response.json().catch(() => null)) as
        | { errors?: { field: string; code: string }[] }
        | null;

      const next: Errors = {};
      for (const error of body?.errors ?? []) {
        if (error.field === "_form" || error.field === "_body") {
          setFormError(codeToMessage(error.code));
        } else {
          next[error.field] ??= codeToMessage(error.code);
        }
      }
      if (Object.keys(next).length === 0 && !body?.errors?.length) {
        setFormError(t.errors.UNKNOWN);
      }
      setErrors(next);
    } catch {
      setFormError(t.errors.UNKNOWN);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    /*
     * Deliberately says "if that address can be used" rather than
     * "we've sent you an email": the response is identical whether or
     * not the account already existed, and the copy must not undo that.
     */
    return (
      <div className="auth-result" data-testid="registration-sent">
        <h1>{t.register.sentHeading}</h1>
        <p>{t.register.sentBody}</p>
        <Link className="btn btn-outline" href={`/${locale}/lots`}>
          {t.notFound.cta}
        </Link>
      </div>
    );
  }

  const field = (name: string) => ({
    id: name,
    name,
    className: "field-input",
    ...(errors[name] ? { "aria-invalid": true as const, "aria-describedby": `${name}-error` } : {}),
  });

  const errorFor = (name: string) =>
    errors[name] ? (
      <span className="field-error" id={`${name}-error`} role="alert">
        {errors[name]}
      </span>
    ) : null;

  return (
    <form className="form-card" onSubmit={onSubmit} noValidate>
      {formError ? (
        <p className="form-notice" data-tone="error" role="alert">
          {formError}
        </p>
      ) : null}

      <fieldset className="field-group">
        <legend className="field-legend">{t.register.accountType}</legend>
        <div className="type-toggle">
          <button
            type="button"
            aria-pressed={accountType === "individual"}
            onClick={() => switchType("individual")}
          >
            {t.register.individual}
          </button>
          <button
            type="button"
            aria-pressed={accountType === "company"}
            onClick={() => switchType("company")}
          >
            {t.register.company}
          </button>
        </div>
      </fieldset>

      <fieldset className="field-group">
        <div className="field-grid">
          <div className="field">
            <label className="field-label" htmlFor="firstName">
              {t.register.firstName}
              <span className="req">*</span>
            </label>
            <input {...field("firstName")} type="text" autoComplete="given-name" />
            {errorFor("firstName")}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="lastName">
              {t.register.lastName}
              <span className="req">*</span>
            </label>
            <input {...field("lastName")} type="text" autoComplete="family-name" />
            {errorFor("lastName")}
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="email">
            {t.register.email}
            <span className="req">*</span>
          </label>
          <input {...field("email")} type="email" autoComplete="email" />
          {errorFor("email")}
        </div>

        <div className="field-grid">
          <div className="field">
            <label className="field-label" htmlFor="phone">
              {t.register.phone}
              <span className="req">*</span>
            </label>
            <input {...field("phone")} type="tel" autoComplete="tel" />
            <span className="field-hint">{t.register.phoneHint}</span>
            {errorFor("phone")}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="dateOfBirth">
              {t.register.dateOfBirth}
              <span className="req">*</span>
            </label>
            <input {...field("dateOfBirth")} type="date" autoComplete="bday" />
            <span className="field-hint">{t.register.dateOfBirthHint}</span>
            {errorFor("dateOfBirth")}
          </div>
        </div>
      </fieldset>

      {accountType === "company" ? (
        <fieldset className="field-group" data-testid="company-fields">
          <legend className="field-legend">{t.register.company}</legend>

          <div className="field">
            <label className="field-label" htmlFor="companyName">
              {t.register.companyName}
              <span className="req">*</span>
            </label>
            <input {...field("companyName")} type="text" autoComplete="organization" />
            {errorFor("companyName")}
          </div>

          <div className="field-grid">
            <div className="field">
              <label className="field-label" htmlFor="eik">
                {t.register.eik}
                <span className="req">*</span>
              </label>
              <input {...field("eik")} type="text" inputMode="numeric" />
              <span className="field-hint">{t.register.eikHint}</span>
              {errorFor("eik")}
            </div>
            <div className="field">
              <label className="field-label" htmlFor="vat">
                {t.register.vat}
              </label>
              <input {...field("vat")} type="text" />
              {errorFor("vat")}
            </div>
          </div>
        </fieldset>
      ) : null}

      <fieldset className="field-group">
        <div className="field">
          <label className="field-label" htmlFor="password">
            {t.register.password}
            <span className="req">*</span>
          </label>
          <input {...field("password")} type="password" autoComplete="new-password" />
          {/*
            No paste blocking, no composition rules, and a hint about
            typing it elsewhere rather than a restriction on what it may
            contain — see docs/server-validation.md §4.
          */}
          <span className="field-hint">{t.register.passwordHint}</span>
          {errorFor("password")}
        </div>
      </fieldset>

      <fieldset className="field-group">
        {/* Unticked by default and separately refusable: pre-ticked
            consent is invalid under GDPR. */}
        <div className="consent">
          <input id="terms" name="terms" type="checkbox" />
          <label htmlFor="terms">
            {t.register.terms}
            <span className="req">*</span>
          </label>
        </div>
        {errorFor("terms")}

        <div className="consent">
          <input id="marketing" name="marketing" type="checkbox" />
          <label htmlFor="marketing">{t.register.marketing}</label>
        </div>
      </fieldset>

      {/* Honeypot: never labelled, never announced, never focusable. */}
      <div className="honeypot" aria-hidden="true">
        <input name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <button className="btn btn-brass btn-lg btn-full" type="submit" disabled={submitting}>
        {submitting ? t.register.submitting : t.register.submit}
      </button>

      <p className="form-footer">
        {t.register.haveAccount}{" "}
        <Link href={`/${locale}/sign-in`}>{t.register.signIn}</Link>
      </p>
    </form>
  );
}
