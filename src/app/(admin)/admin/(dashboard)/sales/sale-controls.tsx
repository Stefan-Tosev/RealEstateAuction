"use client";

import { useActionState } from "react";
import { recordDefaultAction, recordMilestoneAction } from "../../sale-actions";
import type { FormState } from "../../catalogue-actions";

/*
 * Recording what has happened on a sale.
 *
 * Each milestone takes a DATE, not "now": these are entered after the
 * fact. The contract was signed at the notary on Tuesday and somebody
 * types it in on Thursday, so defaulting to today would quietly record
 * the wrong day on the one document a dispute would turn on.
 */
function MilestoneForm({
  saleId,
  milestone,
  label,
  done,
  disabled,
}: {
  saleId: string;
  milestone: "contract" | "balance" | "completed";
  label: string;
  done: string | null;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    recordMilestoneAction.bind(null, saleId, milestone),
    undefined,
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form className="admin-form" action={action} noValidate>
      <h3>{label}</h3>

      {done ? (
        <p className="hint">Recorded {done}. Saving again corrects the date.</p>
      ) : null}

      {state?.message ? (
        <p className="admin-notice" role="alert">
          {state.message}
        </p>
      ) : null}

      <label className="admin-label" htmlFor={`${milestone}-at`}>
        Date it happened
      </label>
      <input
        className="admin-input"
        id={`${milestone}-at`}
        name="at"
        type="date"
        defaultValue={today}
      />

      <label className="admin-label" htmlFor={`${milestone}-note`}>
        Note (optional)
      </label>
      <input className="admin-input" id={`${milestone}-note`} name="note" type="text" />

      <div className="admin-form-actions">
        <button className="admin-btn" type="submit" disabled={pending || disabled}>
          {pending ? "Recording…" : done ? "Correct the date" : `Record ${label.toLowerCase()}`}
        </button>
      </div>
    </form>
  );
}

export function SaleControls({
  saleId,
  contractSignedAt,
  balancePaidAt,
  completedAt,
  defaulted,
  canAct,
}: {
  saleId: string;
  contractSignedAt: string | null;
  balancePaidAt: string | null;
  completedAt: string | null;
  defaulted: boolean;
  canAct: boolean;
}) {
  const [defaultState, defaultAction, defaulting] = useActionState<FormState, FormData>(
    recordDefaultAction.bind(null, saleId),
    undefined,
  );

  if (!canAct) {
    return (
      <p className="hint">
        Only an auctioneer can record progress on a sale — these entries decide whether a deposit
        comes back.
      </p>
    );
  }

  if (defaulted) {
    return (
      <p className="admin-notice" data-tone="error">
        This sale is recorded as defaulted and the deposit forfeited. Nothing further can be
        recorded against it.
      </p>
    );
  }

  return (
    <section>
      <div className="admin-grid-2">
        <MilestoneForm
          saleId={saleId}
          milestone="contract"
          label="Preliminary contract"
          done={contractSignedAt}
          disabled={false}
        />
        <MilestoneForm
          saleId={saleId}
          milestone="balance"
          label="Balance paid"
          done={balancePaidAt}
          disabled={false}
        />
        <MilestoneForm
          saleId={saleId}
          milestone="completed"
          label="Notarial deed signed"
          done={completedAt}
          disabled={false}
        />

        {!completedAt ? (
          <form className="admin-form" action={defaultAction} noValidate>
            <h3>Buyer defaulted</h3>
            <p className="hint">
              {/* Said plainly, because this is the irreversible one. */}
              Forfeits the deposit. Only enforceable if the bidder terms say so.
            </p>

            {defaultState?.message ? (
              <p className="admin-notice" data-tone="error" role="alert">
                {defaultState.message}
              </p>
            ) : null}

            <label className="admin-label" htmlFor="default-reason">
              What happened
            </label>
            <input
              className="admin-input"
              id="default-reason"
              name="reason"
              type="text"
              placeholder="No contact after three written reminders"
            />

            <div className="admin-form-actions">
              <button className="admin-btn" type="submit" disabled={defaulting}>
                {defaulting ? "Recording…" : "Record default"}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
