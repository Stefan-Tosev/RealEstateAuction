"use client";

import { useActionState } from "react";
import { draftCopyAction, type DraftCopyState } from "../../copy-actions";

/*
 * Drafts listing copy from the facts already typed into the form.
 *
 * Deliberately NOT a form of its own — it reads the fields the operator
 * has filled in and hands back text they paste in, edit, and save
 * themselves. Nothing is written automatically.
 *
 * That is a design decision rather than laziness. Copy published under
 * the auction house's name is copy the house is legally answerable for,
 * and misdescription by an agent is the agent's liability. A person has
 * to have read it.
 */
export function CopyDrafter({ available }: { available: boolean }) {
  const [state, formAction, pending] = useActionState<DraftCopyState, FormData>(
    draftCopyAction,
    undefined,
  );

  return (
    <div className="admin-drafter">
      <label className="admin-label" htmlFor="copyNotes">
        What is notable about this property?
      </label>
      <textarea
        id="copyNotes"
        name="copyNotes"
        rows={3}
        placeholder="Corner flat, two terraces, south-facing living room, quiet inner courtyard…"
      />
      <span className="hint">
        {/*
          The single biggest lever on whether the draft is any good, and
          the only place a fact not already on this form may enter.
        */}
        The only facts the draft may use are the fields above and this box. Anything you leave out
        will not appear — that is deliberate.
      </span>

      <div className="admin-form-actions">
        <button
          className="admin-btn"
          type="submit"
          formAction={formAction}
          formNoValidate
          disabled={pending || !available}
        >
          {pending ? "Drafting…" : "Draft descriptions"}
        </button>
      </div>

      {!available ? (
        <p className="hint">
          Not configured on this server — ANTHROPIC_API_KEY is unset. Descriptions can still be
          written by hand.
        </p>
      ) : null}

      {state && !state.ok ? (
        <p className="admin-notice" data-tone="error" role="alert">
          {state.message}
        </p>
      ) : null}

      {state?.ok ? (
        <div className="admin-draft-result">
          {state.result.warnings.length > 0 ? (
            <div className="admin-notice" data-tone="error">
              {/*
                Warnings, not rejections. The operator is the control, so
                the useful thing is to point at the sentence worth reading
                twice rather than to throw the draft away.
              */}
              <strong>Read these before you use it:</strong>
              <ul className="admin-blockers">
                {state.result.warnings.map((warning) => (
                  <li key={`${warning.locale}-${warning.detail}`}>
                    <code>{warning.locale}</code> — {warning.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {Object.keys(state.result.copy.descriptions).map((locale) => (
            <div key={locale} className="admin-draft-locale">
              <h3>{locale.toUpperCase()}</h3>
              <p className="admin-draft-title">{state.result.copy.titles[locale]}</p>
              <pre className="admin-draft-body">{state.result.copy.descriptions[locale]}</pre>
            </div>
          ))}

          <p className="hint">
            Copy what you want into the fields above, edit it, then save. Nothing here is stored
            until you do.
          </p>
        </div>
      ) : null}
    </div>
  );
}
