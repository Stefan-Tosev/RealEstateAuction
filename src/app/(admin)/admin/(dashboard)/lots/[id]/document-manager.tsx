"use client";

import { useActionState } from "react";
import type { DocumentKind, DocumentVisibility } from "@prisma/client";
import {
  deleteDocumentAction,
  setDocumentVisibilityAction,
  uploadDocumentAction,
} from "../../../lot-extras-actions";
import type { FormState } from "../../../catalogue-actions";
import { Field } from "../../../_components/field";

export type AdminDocument = {
  id: string;
  kind: DocumentKind;
  visibility: DocumentVisibility;
  filename: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
};

const KIND_LABELS: Record<DocumentKind, string> = {
  title_deed: "Title deed (нотариален акт)",
  sketch: "Cadastral sketch (скица)",
  tax_valuation: "Tax valuation (данъчна оценка)",
  encumbrances: "Encumbrances (удостоверение за тежести)",
  floor_plan: "Floor plan",
  energy_cert: "Energy certificate",
  other: "Other",
};

const VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  public: "Public — anyone",
  registered: "Registered — signed-in bidders",
  approved_bidders: "Approved bidders only",
};

export function DocumentManager({
  lotId,
  documents,
}: {
  lotId: string;
  documents: AdminDocument[];
}) {
  const upload = uploadDocumentAction.bind(null, lotId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(upload, undefined);
  const errors = state?.errors ?? {};

  const remove = deleteDocumentAction.bind(null, lotId);
  const setVisibility = setDocumentVisibilityAction.bind(null, lotId);

  return (
    <section>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>Legal pack</h2>

      {documents.length === 0 ? (
        <div className="admin-empty" style={{ marginBottom: "1.5rem" }}>
          <p>No documents yet. The pack is what earns the preview period.</p>
        </div>
      ) : (
        <table className="admin-table" style={{ marginBottom: "1.5rem" }}>
          <thead>
            <tr>
              <th>Type</th>
              <th>File</th>
              <th className="num">Size</th>
              <th>Who can download</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.id}>
                <td>{KIND_LABELS[document.kind]}</td>
                <td>
                  <code style={{ fontSize: "0.78rem" }}>{document.filename}</code>
                  <div style={{ fontSize: "0.72rem", opacity: 0.7 }}>
                    {document.uploadedBy} · {document.uploadedAt}
                  </div>
                </td>
                <td className="num">{Math.max(1, Math.round(document.sizeBytes / 1024))} KB</td>
                <td>
                  <form action={setVisibility}>
                    <input type="hidden" name="documentId" value={document.id} />
                    <select
                      name="visibility"
                      defaultValue={document.visibility}
                      onChange={(event) => event.currentTarget.form?.requestSubmit()}
                      style={{ fontSize: "0.8rem", padding: "0.3rem" }}
                    >
                      {(Object.keys(VISIBILITY_LABELS) as DocumentVisibility[]).map((value) => (
                        <option key={value} value={value}>
                          {VISIBILITY_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </form>
                  {document.visibility === "approved_bidders" ? (
                    /*
                     * Said plainly at the point of choosing. Nothing
                     * writes BidderApproval until Phase 2, so this tier
                     * is currently downloadable by nobody — an operator
                     * should know that before selecting it.
                     */
                    <div style={{ fontSize: "0.72rem", opacity: 0.7, marginTop: "0.25rem" }}>
                      No bidders are approved yet — nobody can download this.
                    </div>
                  ) : null}
                </td>
                <td>
                  <form action={remove}>
                    <input type="hidden" name="documentId" value={document.id} />
                    <button className="admin-btn admin-btn-sm admin-btn-danger" type="submit">
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form className="admin-form" action={formAction} noValidate>
        {state?.message ? (
          <p className="admin-notice" data-tone={state.errors ? "error" : "ok"} role="alert">
            {state.message}
          </p>
        ) : null}

        <div className="admin-grid-2">
          <Field id="doc-file" name="file"
            label="Add a document"
            error={errors.file}
            hint="PDF, JPEG or PNG, up to 25 MB. Stored privately and served only through short-lived links."
          >
            {(props) => <input {...props} type="file" accept=".pdf,.jpg,.jpeg,.png" />}
          </Field>

          <Field id="doc-kind" name="kind" label="Document type" error={errors.kind}>
            {(props) => (
              <select {...props} defaultValue="title_deed">
                {(Object.keys(KIND_LABELS) as DocumentKind[]).map((value) => (
                  <option key={value} value={value}>
                    {KIND_LABELS[value]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <Field id="doc-visibility" name="visibility"
          label="Who can download it"
          error={errors.visibility}
          hint="Everyone sees that the document exists; this controls who can open it."
        >
          {(props) => (
            <select {...props} defaultValue="registered">
              {(Object.keys(VISIBILITY_LABELS) as DocumentVisibility[]).map((value) => (
                <option key={value} value={value}>
                  {VISIBILITY_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="admin-form-actions">
          <button className="admin-btn" type="submit" disabled={pending}>
            {pending ? "Uploading…" : "Upload document"}
          </button>
        </div>
      </form>
    </section>
  );
}
