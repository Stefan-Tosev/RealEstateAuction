"use client";

import { useActionState } from "react";
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

  return (
    <form className="admin-form" action={formAction} noValidate>
      {state?.message ? (
        <p className="admin-notice" data-tone="error" role="alert">
          {state.message}
        </p>
      ) : null}

      <fieldset className="admin-fieldset">
        <legend>Lot</legend>

        <Field name="propertyId" label="Property" error={errors.propertyId}>
          {(props) => (
            <select {...props} defaultValue={lot?.propertyId ?? ""} disabled={Boolean(lot)}>
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
              defaultValue={lot?.lotNumber ?? defaultLotNumber}
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
              <input {...props} type="text" inputMode="decimal" defaultValue={lot?.startingPriceMajor ?? ""} />
            )}
          </Field>

          <Field
            name="reservePriceMinor"
            label="Reserve price"
            error={errors.reservePriceMinor}
            hint="Never leaves the server. Convention is ~110% of guide — higher is how lots go unsold."
          >
            {(props) => (
              <input {...props} type="text" inputMode="decimal" defaultValue={lot?.reservePriceMajor ?? ""} />
            )}
          </Field>

          <Field name="bidIncrementMinor" label="Bid increment (optional)" error={errors.bidIncrementMinor}>
            {(props) => (
              <input {...props} type="text" inputMode="decimal" defaultValue={lot?.bidIncrementMajor ?? ""} />
            )}
          </Field>

          <Field name="depositRequiredMinor" label="Deposit (optional)" error={errors.depositRequiredMinor}>
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="decimal"
                defaultValue={lot?.depositRequiredMajor ?? ""}
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
            <input {...props} type="datetime-local" defaultValue={lot?.previewStartsAt ?? ""} />
          )}
        </Field>

        <div className="admin-grid-2">
          <Field name="biddingOpensAt" label="Bidding opens" error={errors.biddingOpensAt}>
            {(props) => (
              <input {...props} type="datetime-local" defaultValue={lot?.biddingOpensAt ?? ""} />
            )}
          </Field>
          <Field name="scheduledCloseAt" label="Scheduled close" error={errors.scheduledCloseAt}>
            {(props) => (
              <input {...props} type="datetime-local" defaultValue={lot?.scheduledCloseAt ?? ""} />
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
