"use client";

import { useActionState, useEffect, useState } from "react";
import { saveSellerAction } from "../../seller-actions";
import type { FormState } from "../../catalogue-actions";
import { Field } from "../../_components/field";

export type SellerFormValues = {
  id: string;
  kind: string;
  name: string;
  email: string;
  phone: string;
  eik: string;
  vat: string;
  address: string;
  notes: string;
};

/*
 * A seller record, not an account. §11 keeps sourcing admin-curated —
 * nobody logs in as a seller in the MVP.
 *
 * Everything on this form is personal data held to run a transaction.
 * It never reaches the public catalogue; the select allowlists omit it
 * structurally and a test fails if anyone widens them.
 */
export function SellerForm({ seller }: { seller: SellerFormValues | null }) {
  const action = saveSellerAction.bind(null, seller?.id ?? null);
  const [state, formAction, isPending] = useActionState<FormState, FormData>(action, undefined);

  const errors = state?.errors ?? {};

  /*
   * What to show in each box: what was just submitted if the action
   * bounced it back, otherwise the stored record.
   *
   * React 19 resets an uncontrolled form after its action completes, so
   * without this a single rejected field empties the whole form.
   */
  const value = (key: keyof SellerFormValues) => state?.values?.[key] ?? seller?.[key] ?? "";

  /*
   * Remount the form after every action result.
   *
   * React resets an uncontrolled form once its action completes, and a
   * re-render does not undo that: defaultValue is only read at mount, and
   * a controlled field desyncs because the reset changes the DOM without
   * changing any state, so nothing re-renders to correct it.
   *
   * Bumping a key sidesteps the whole argument. A fresh mount reads every
   * defaultValue again — and those now come from what was submitted, so
   * the form comes back exactly as the operator left it.
   */
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (state) setAttempt((n) => n + 1);
  }, [state]);

  // Company fields are only meaningful for a company, and an ЕИК box on
  // a private seller's record invites somebody to put something in it.
  const [kind, setKind] = useState(String(value("kind")) || "individual");

  return (
    <form key={attempt} className="admin-form" action={formAction} noValidate>
      {state?.message ? (
        <p className="admin-notice" data-tone="error" role="alert">
          {state.message}
        </p>
      ) : null}

      <Field name="kind" label="Seller is" error={errors.kind}>
        {(props) => (
          <select
            {...props}
            value={kind}
            onChange={(event) => setKind(event.currentTarget.value)}
          >
            <option value="individual">A private person</option>
            <option value="company">A company</option>
          </select>
        )}
      </Field>

      <Field
        name="name"
        label={kind === "company" ? "Registered name" : "Full name"}
        error={errors.name}
      >
        {(props) => <input {...props} type="text" defaultValue={value("name")} />}
      </Field>

      <div className="admin-grid-2">
        <Field
          name="email"
          label="Email"
          error={errors.email}
          hint="Where the bid log and the invoice go."
        >
          {(props) => <input {...props} type="email" defaultValue={value("email")} />}
        </Field>
        <Field
          name="phone"
          label="Telephone"
          error={errors.phone}
          hint="The number to ring when a lot closes below reserve."
        >
          {(props) => <input {...props} type="tel" defaultValue={value("phone")} />}
        </Field>
      </div>

      {kind === "company" ? (
        <div className="admin-grid-2">
          <Field
            name="eik"
            label="ЕИК"
            error={errors.eik}
            hint="Checked against its check digit — an invoice with a wrong one comes back."
          >
            {(props) => <input {...props} type="text" defaultValue={value("eik")} />}
          </Field>
          <Field name="vat" label="ДДС number (optional)" error={errors.vat}>
            {(props) => <input {...props} type="text" defaultValue={value("vat")} />}
          </Field>
        </div>
      ) : null}

      <Field name="address" label="Address for correspondence" error={errors.address}>
        {(props) => <input {...props} type="text" defaultValue={value("address")} />}
      </Field>

      <Field
        name="notes"
        label="Notes"
        error={errors.notes}
        hint="Who introduced them, what was agreed on the phone — whatever the next person answering will need."
      >
        {(props) => <textarea {...props} rows={4} defaultValue={value("notes")} />}
      </Field>

      <div className="admin-form-actions">
        <button className="admin-btn admin-btn-primary" type="submit" disabled={isPending}>
          {isPending ? "Saving…" : seller ? "Save changes" : "Create seller"}
        </button>
      </div>
    </form>
  );
}
