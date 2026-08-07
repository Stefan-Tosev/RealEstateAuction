"use client";

import { useActionState } from "react";
import { cancelInvoiceAction, markInvoicePaidAction } from "../../invoice-actions";
import type { FormState } from "../../catalogue-actions";

/*
 * Marking an invoice paid, or cancelling it.
 *
 * Cancelling keeps the number used and the row in place — deleting it
 * would put a gap back in the sequence, which is the one thing the
 * numbering design exists to prevent. A cancelled invoice is part of the
 * record, not an embarrassment to be erased.
 */
export function InvoiceControls({
  invoiceId,
  status,
  canAct,
}: {
  invoiceId: string;
  status: string;
  canAct: boolean;
}) {
  const [paidState, paidAction, paying] = useActionState<FormState, FormData>(
    markInvoicePaidAction.bind(null, invoiceId),
    undefined,
  );
  const [cancelState, cancelAction, cancelling] = useActionState<FormState, FormData>(
    cancelInvoiceAction.bind(null, invoiceId),
    undefined,
  );

  const message = paidState?.message ?? cancelState?.message;

  if (!canAct) {
    return <p className="hint">Only an auctioneer can settle or cancel an invoice.</p>;
  }

  return (
    <section>
      {message ? (
        <p className="admin-notice" role="alert">
          {message}
        </p>
      ) : null}

      {status === "issued" ? (
        <div className="admin-grid-2">
          <form action={paidAction}>
            <div className="admin-form-actions">
              <button className="admin-btn admin-btn-primary" type="submit" disabled={paying}>
                {paying ? "Recording…" : "Mark as paid"}
              </button>
            </div>
          </form>

          <form className="admin-form" action={cancelAction} noValidate>
            <label className="admin-label" htmlFor="cancel-reason">
              Reason for cancelling
            </label>
            <input
              className="admin-input"
              id="cancel-reason"
              name="reason"
              type="text"
              placeholder="Raised against the wrong party"
              autoComplete="off"
            />
            <div className="admin-form-actions">
              <button className="admin-btn" type="submit" disabled={cancelling}>
                {cancelling ? "Cancelling…" : "Cancel invoice"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <p className="hint">This invoice is {status}. Its number stays used either way.</p>
      )}
    </section>
  );
}
