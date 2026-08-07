"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { saveLotAction, type FormState } from "../../catalogue-actions";
import { Field } from "../../_components/field";

type PropertyOption = { id: string; slug: string; titleBg: string };

export type LotFormValues = {
  id: string;
  propertyId: string;
  lotNumber: number;
  startingPriceMajor: string;
  reservePriceMajor: string;
  bidIncrementMajor: string;
  depositRequiredMajor: string;
  previewStartsAt: string;
  biddingOpensAt: string;
  scheduledCloseAt: string;
  isDraft: boolean;
};

export function LotForm({
  lot,
  properties,
  defaultLotNumber,
}: {
  lot: LotFormValues | null;
  properties: PropertyOption[];
  defaultLotNumber: number;
}) {
  const action = saveLotAction.bind(null, lot?.id ?? null);
  const [state, formAction, isPending] = useActionState<FormState, FormData>(action, undefined);
  const errors = state?.errors ?? {};

  /*
   * What was just submitted if the action bounced it back, otherwise the
   * stored lot.
   *
   * React 19 resets an uncontrolled form once its action completes, so
   * without this a single rejected field empties every price and date an
   * operator has just entered — and these are the fields where retyping
   * from memory is most likely to introduce a different mistake.
   *
   * Two keys, not one: the form posts the money fields under their
   * *Minor* names while the stored values are *Major* strings — the
   * schema converts on the way in. Looking the echo up by the wrong one
   * silently returns nothing, which is exactly how the first version of
   * this fix failed.
   */
  const value = (field: string, stored: keyof LotFormValues, fallback = "") =>
    state?.values?.[field] ?? (lot ? String(lot[stored]) : fallback);

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

  return (
    <form key={attempt} className="admin-form" action={formAction} noValidate>
      {state?.message ? (
        <p className="admin-notice" data-tone="error" role="alert">
          {state.message}
        </p>
      ) : null}

      <fieldset className="admin-fieldset">
        <legend>Lot</legend>

        <Field name="propertyId" label="Property" error={errors.propertyId}>
          {(props) => (
            <select {...props} defaultValue={value("propertyId", "propertyId")} disabled={Boolean(lot)}>
              <option value="" disabled>
                Choose a property…
              </option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.titleBg} ({property.slug})
                </option>
              ))}
            </select>
          )}
        </Field>
        {/* A disabled select submits nothing, so the value rides along. */}
        {lot ? <input type="hidden" name="propertyId" value={lot.propertyId} /> : null}

        <Field
          name="lotNumber"
          label="Lot number"
          error={errors.lotNumber}
          hint="Unique per property. Shown to the public zero-padded, e.g. 011."
        >
          {(props) => (
            <input
              {...props}
              type="text"
              inputMode="numeric"
              defaultValue={value("lotNumber", "lotNumber", String(defaultLotNumber))}
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="admin-fieldset">
        <legend>Money — in euros, not cents</legend>

        <div className="admin-grid-2">
          <Field
            name="startingPriceMinor"
            label="Guide price"
            error={errors.startingPriceMinor}
            hint="The opening bid, published to everyone."
          >
            {(props) => (
              <input {...props} type="text" inputMode="decimal" defaultValue={value("startingPriceMinor", "startingPriceMajor")} />
            )}
          </Field>

          <Field
            name="reservePriceMinor"
            label="Reserve price"
            error={errors.reservePriceMinor}
            hint="Never leaves the server. Convention is ~110% of guide — higher is how lots go unsold."
          >
            {(props) => (
              <input {...props} type="text" inputMode="decimal" defaultValue={value("reservePriceMinor", "reservePriceMajor")} />
            )}
          </Field>

          <Field name="bidIncrementMinor" label="Bid increment (optional)" error={errors.bidIncrementMinor}>
            {(props) => (
              <input {...props} type="text" inputMode="decimal" defaultValue={value("bidIncrementMinor", "bidIncrementMajor")} />
            )}
          </Field>

          <Field name="depositRequiredMinor" label="Deposit (optional)" error={errors.depositRequiredMinor}>
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="decimal"
                defaultValue={value("depositRequiredMinor", "depositRequiredMajor")}
              />
            )}
          </Field>
        </div>
      </fieldset>

      <fieldset className="admin-fieldset">
        <legend>Schedule — local time, stored as UTC</legend>

        <Field
          name="previewStartsAt"
          label="Preview starts"
          error={errors.previewStartsAt}
          hint="Convention is 21 days of preview, then 5 days of bidding."
        >
          {(props) => (
            <input {...props} type="datetime-local" defaultValue={value("previewStartsAt", "previewStartsAt")} />
          )}
        </Field>

        <div className="admin-grid-2">
          <Field name="biddingOpensAt" label="Bidding opens" error={errors.biddingOpensAt}>
            {(props) => (
              <input {...props} type="datetime-local" defaultValue={value("biddingOpensAt", "biddingOpensAt")} />
            )}
          </Field>
          <Field name="scheduledCloseAt" label="Scheduled close" error={errors.scheduledCloseAt}>
            {(props) => (
              <input {...props} type="datetime-local" defaultValue={value("scheduledCloseAt", "scheduledCloseAt")} />
            )}
          </Field>
        </div>
      </fieldset>

      <div className="admin-form-actions">
        <button className="admin-btn admin-btn-primary" type="submit" disabled={isPending}>
          {isPending ? "Saving…" : lot ? "Save changes" : "Create lot"}
        </button>
        <Link className="admin-btn" href="/admin/lots">
          Cancel
        </Link>
      </div>
    </form>
  );
}
