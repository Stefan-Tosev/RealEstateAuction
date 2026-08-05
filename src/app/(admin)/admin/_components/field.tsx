import type { ReactNode } from "react";

/*
 * One field, with its label, error and description wired together.
 *
 * The a11y wiring is the reason this is a component rather than repeated
 * markup: aria-invalid plus aria-describedby pointing at the error is
 * what makes a validation failure reach a screen reader, and it is the
 * first thing that gets forgotten when forms are hand-written.
 *
 * The same rule CLAUDE.md records for the v1 register form applies:
 * errors never rely on colour alone — .admin-field-error carries a ⚠
 * glyph via ::before.
 */
export function Field({
  name,
  label,
  error,
  hint,
  id,
  children,
}: {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  /**
   * Overrides the DOM id, which otherwise defaults to `name`.
   *
   * Needed when two forms on one page share a field name — the lot page
   * has both a document form and a viewing form with a "kind" field.
   * Duplicate ids are not cosmetic: the label then points at whichever
   * element comes first, so clicking one form's label focuses the
   * other's control.
   */
  id?: string;
  children: (props: {
    id: string;
    name: string;
    "aria-invalid"?: "true";
    "aria-describedby"?: string;
  }) => ReactNode;
}) {
  const fieldId = id ?? name;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");

  return (
    <div className="admin-field">
      <label htmlFor={fieldId}>{label}</label>
      {children({
        id: fieldId,
        name,
        ...(error ? { "aria-invalid": "true" as const } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      })}
      {hint ? (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="admin-field-error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
