"use client";

import { useActionState } from "react";
import Link from "next/link";
import { savePropertyAction, type FormState } from "../catalogue-actions";
import { Field } from "../_components/field";

const PROPERTY_TYPES = ["apartment", "house", "land", "commercial", "other"] as const;

/*
 * Plain strings, not a Prisma row.
 *
 * `Property` carries Decimal (areaSqm, lat, lng), and a Decimal cannot
 * cross into a client component — React refuses it outright: "Only plain
 * objects can be passed to Client Components". The public catalogue
 * solves this with mappers at the query boundary; the admin needs the
 * same discipline, and a form edits strings anyway.
 */
export type PropertyFormValues = {
  id: string;
  slug: string;
  titleBg: string;
  titleEn: string;
  descriptionBg: string;
  descriptionEn: string;
  address: string;
  city: string;
  region: string;
  propertyType: string;
  rooms: string;
  areaSqm: string;
  floor: string;
  yearBuilt: string;
  cadastralId: string;
};

/*
 * novalidate is deliberate, and for the same reason CLAUDE.md gives for
 * the v1 forms: native constraint bubbles render in the *browser's*
 * locale and cannot be styled. Here the admin is English-only so the
 * locale argument is weaker, but the styling and consistency ones hold —
 * and letting the browser block submission means the server rules never
 * get exercised.
 */
export function PropertyForm({ property }: { property: PropertyFormValues | null }) {
  const action = savePropertyAction.bind(null, property?.id ?? null);
  const [state, formAction, isPending] = useActionState<FormState, FormData>(action, undefined);

  const errors = state?.errors ?? {};
  const value = (key: keyof PropertyFormValues) => property?.[key] ?? "";

  return (
    <form className="admin-form" action={formAction} noValidate>
      {state?.message ? (
        <p className="admin-notice" data-tone="error" role="alert">
          {state.message}
        </p>
      ) : null}

      <fieldset className="admin-fieldset">
        <legend>Identity</legend>

        <Field
          name="slug"
          label="Slug"
          error={errors.slug}
          hint="Permanent public URL: /bg/lots/<slug>. Lowercase letters, numbers and hyphens."
        >
          {(props) => <input {...props} type="text" defaultValue={value("slug")} />}
        </Field>

        <Field name="propertyType" label="Property type" error={errors.propertyType}>
          {(props) => (
            <select {...props} defaultValue={property?.propertyType ?? "apartment"}>
              {PROPERTY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          )}
        </Field>
      </fieldset>

      <fieldset className="admin-fieldset">
        {/* Both languages are required by the schema — a half-translated
            listing is what the bilingual pattern exists to prevent. */}
        <legend>Copy — both languages required</legend>

        <div className="admin-grid-2">
          <Field name="titleBg" label="Title (BG)" error={errors.titleBg}>
            {(props) => <input {...props} type="text" defaultValue={value("titleBg")} />}
          </Field>
          <Field name="titleEn" label="Title (EN)" error={errors.titleEn}>
            {(props) => <input {...props} type="text" defaultValue={value("titleEn")} />}
          </Field>
        </div>

        <Field name="descriptionBg" label="Description (BG)" error={errors.descriptionBg}>
          {(props) => <textarea {...props} defaultValue={value("descriptionBg")} />}
        </Field>
        <Field name="descriptionEn" label="Description (EN)" error={errors.descriptionEn}>
          {(props) => <textarea {...props} defaultValue={value("descriptionEn")} />}
        </Field>
      </fieldset>

      <fieldset className="admin-fieldset">
        <legend>Location</legend>

        <Field
          name="address"
          label="Address"
          error={errors.address}
          hint="Shown as stored, in both languages — a postal address belongs in the local language."
        >
          {(props) => <input {...props} type="text" defaultValue={value("address")} />}
        </Field>

        <div className="admin-grid-2">
          <Field
            name="city"
            label="City"
            error={errors.city}
            hint="In Bulgarian. Known places are translated for the English site."
          >
            {(props) => <input {...props} type="text" defaultValue={value("city")} />}
          </Field>
          <Field name="region" label="Region" error={errors.region}>
            {(props) => <input {...props} type="text" defaultValue={value("region")} />}
          </Field>
        </div>

        <Field name="cadastralId" label="Cadastral ID (optional)" error={errors.cadastralId}>
          {(props) => <input {...props} type="text" defaultValue={value("cadastralId")} />}
        </Field>
      </fieldset>

      <fieldset className="admin-fieldset">
        <legend>Details — all optional, shown as the lot's key facts</legend>

        <div className="admin-grid-2">
          <Field name="rooms" label="Rooms" error={errors.rooms}>
            {(props) => <input {...props} type="text" inputMode="numeric" defaultValue={value("rooms")} />}
          </Field>
          <Field name="areaSqm" label="Area (sqm)" error={errors.areaSqm}>
            {(props) => (
              <input {...props} type="text" inputMode="numeric" defaultValue={value("areaSqm")} />
            )}
          </Field>
          <Field name="floor" label="Floor" error={errors.floor}>
            {(props) => <input {...props} type="text" inputMode="numeric" defaultValue={value("floor")} />}
          </Field>
          <Field name="yearBuilt" label="Year built" error={errors.yearBuilt}>
            {(props) => (
              <input {...props} type="text" inputMode="numeric" defaultValue={value("yearBuilt")} />
            )}
          </Field>
        </div>
      </fieldset>

      <div className="admin-form-actions">
        <button className="admin-btn admin-btn-primary" type="submit" disabled={isPending}>
          {isPending ? "Saving…" : property ? "Save changes" : "Create property"}
        </button>
        <Link className="admin-btn" href="/admin/properties">
          Cancel
        </Link>
      </div>
    </form>
  );
}
