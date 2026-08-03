"use client";

import { useActionState } from "react";
import type { PropertyImage } from "@prisma/client";
import {
  deleteImageAction,
  moveImageAction,
  uploadImageAction,
  type FormState,
} from "../../../catalogue-actions";
import { Field } from "../../../_components/field";

/*
 * Upload, order and remove a property's photographs.
 *
 * Ordering is up/down buttons rather than drag-and-drop on purpose:
 * drag is unusable by keyboard and awkward on touch, and a gallery of
 * five images does not need it. Each press is a form post, so it works
 * with JavaScript disabled too.
 */
/*
 * URLs are resolved on the server and passed as strings. A function prop
 * cannot cross into a client component — RSC only serializes server
 * actions — and importing the storage module here would pull node:fs
 * into the browser bundle.
 */
export type AdminImage = Pick<
  PropertyImage,
  "id" | "altBg" | "altEn" | "width" | "height"
> & { url: string };

export function ImageManager({
  propertyId,
  images,
}: {
  propertyId: string;
  images: AdminImage[];
}) {
  const upload = uploadImageAction.bind(null, propertyId);
  const [state, formAction, isPending] = useActionState<FormState, FormData>(upload, undefined);
  const errors = state?.errors ?? {};

  const deleteImage = deleteImageAction.bind(null, propertyId);
  const moveImage = moveImageAction.bind(null, propertyId);

  return (
    <section>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>Photographs</h2>

      {images.length === 0 ? (
        <div className="admin-empty" style={{ marginBottom: "1.5rem" }}>
          <p>No photographs yet. A lot cannot be published without at least one.</p>
        </div>
      ) : (
        <div className="admin-images">
          {images.map((image, index) => (
            <div className="admin-image-card" key={image.id}>
              {/* Deliberately a plain img: these are operator thumbnails of
                  arbitrary uploads, not layout-critical page imagery. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt={image.altEn} />
              <div className="admin-image-meta">
                <div>{image.width}×{image.height}</div>
                <div>{image.altBg}</div>
              </div>
              <div className="admin-image-actions">
                <form action={moveImage}>
                  <input type="hidden" name="imageId" value={image.id} />
                  <input type="hidden" name="direction" value="up" />
                  <button
                    className="admin-btn admin-btn-sm"
                    type="submit"
                    disabled={index === 0}
                    aria-label={`Move image ${index + 1} earlier`}
                  >
                    ↑
                  </button>
                </form>
                <form action={moveImage}>
                  <input type="hidden" name="imageId" value={image.id} />
                  <input type="hidden" name="direction" value="down" />
                  <button
                    className="admin-btn admin-btn-sm"
                    type="submit"
                    disabled={index === images.length - 1}
                    aria-label={`Move image ${index + 1} later`}
                  >
                    ↓
                  </button>
                </form>
                <form action={deleteImage}>
                  <input type="hidden" name="imageId" value={image.id} />
                  <button
                    className="admin-btn admin-btn-sm admin-btn-danger"
                    type="submit"
                    aria-label={`Delete image ${index + 1}`}
                  >
                    Delete
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      <form className="admin-form" action={formAction} noValidate>
        {state?.message ? (
          <p className="admin-notice" data-tone={state.errors ? "error" : "ok"} role="alert">
            {state.message}
          </p>
        ) : null}

        <Field
          name="file"
          label="Add a photograph"
          error={errors.file}
          hint="JPEG, PNG or WebP, up to 12 MB. Re-encoded on upload — metadata including GPS is removed."
        >
          {(props) => <input {...props} type="file" accept="image/jpeg,image/png,image/webp" />}
        </Field>

        <div className="admin-grid-2">
          <Field name="altBg" label="Alt text (BG)" error={errors.altBg}>
            {(props) => <input {...props} type="text" />}
          </Field>
          <Field name="altEn" label="Alt text (EN)" error={errors.altEn}>
            {(props) => <input {...props} type="text" />}
          </Field>
        </div>

        <div className="admin-form-actions">
          <button className="admin-btn" type="submit" disabled={isPending}>
            {isPending ? "Uploading…" : "Upload"}
          </button>
        </div>
      </form>
    </section>
  );
}
