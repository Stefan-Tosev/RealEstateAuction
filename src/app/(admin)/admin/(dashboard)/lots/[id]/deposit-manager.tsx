"use client";

import { useActionState } from "react";
import type { DepositStatus } from "@prisma/client";
import { recordDepositAction, setDepositStatusAction } from "../../../bidder-actions";
import type { FormState } from "../../../catalogue-actions";
import { Field } from "../../../_components/field";

export type AdminDeposit = {
  id: string;
  bidderName: string;
  bidderEmail: string;
  amountFormatted: string;
  method: string;
  status: DepositStatus;
  providerRef: string | null;
  createdAt: string;
};

const STATUSES: DepositStatus[] = ["pending", "held", "released", "forfeited", "refunded"];

/*
 * Recording deposits by hand is the design, not a shortcut. §9: "card
 * pre-authorisation holds generally fail at property-deposit sizes —
 * SEPA transfer is the realistic mechanism, which means manual
 * reconciliation."
 *
 * Somebody watches a bank account and marks money as received. A payment
 * provider at Phase 5 changes where the confirmation comes from, not
 * what the record means.
 */
export function DepositManager({
  lotId,
  deposits,
  bidderOptions,
  depositRequired,
  canRecord,
}: {
  lotId: string;
  deposits: AdminDeposit[];
  bidderOptions: { id: string; label: string }[];
  depositRequired: string | null;
  canRecord: boolean;
}) {
  const record = recordDepositAction.bind(null, lotId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(record, undefined);
  const errors = state?.errors ?? {};

  const setStatus = setDepositStatusAction.bind(null, lotId);

  return (
    <section>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.35rem" }}>Deposits</h2>
      <p style={{ fontSize: "0.85rem", opacity: 0.75, margin: "0 0 0.9rem" }}>
        {depositRequired
          ? `This lot requires ${depositRequired}. A bidder with no deposit held cannot bid.`
          : "This lot requires no deposit, so bidding is not gated on one."}
      </p>

      {deposits.length === 0 ? (
        <div className="admin-empty" style={{ marginBottom: "1.5rem" }}>
          <p>No deposits recorded.</p>
        </div>
      ) : (
        <table className="admin-table" style={{ marginBottom: "1.5rem" }}>
          <thead>
            <tr>
              <th>Bidder</th>
              <th className="num">Amount</th>
              <th>Method</th>
              <th>Reference</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {deposits.map((deposit) => (
              <tr key={deposit.id}>
                <td>
                  {deposit.bidderName}
                  <div style={{ fontSize: "0.72rem", opacity: 0.7 }}>{deposit.bidderEmail}</div>
                </td>
                <td className="num">{deposit.amountFormatted}</td>
                <td>{deposit.method === "sepa" ? "SEPA transfer" : "Card hold"}</td>
                <td>
                  <code style={{ fontSize: "0.75rem" }}>{deposit.providerRef ?? "—"}</code>
                  <div style={{ fontSize: "0.72rem", opacity: 0.7 }}>{deposit.createdAt}</div>
                </td>
                <td>
                  <form action={setStatus}>
                    <input type="hidden" name="depositId" value={deposit.id} />
                    <select
                      name="status"
                      defaultValue={deposit.status}
                      disabled={!canRecord}
                      onChange={(event) => event.currentTarget.form?.requestSubmit()}
                      style={{ fontSize: "0.8rem", padding: "0.3rem" }}
                    >
                      {STATUSES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </form>
                  {deposit.status === "held" ? (
                    <div style={{ fontSize: "0.72rem", opacity: 0.7, marginTop: "0.25rem" }}>
                      This bidder may bid.
                    </div>
                  ) : null}
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

        {bidderOptions.length === 0 ? (
          <p style={{ fontSize: "0.85rem", opacity: 0.75 }}>
            {/* The likeliest reason an operator finds nobody to select. */}
            No approved bidder is without a deposit on this lot. Approve a bidder first.
          </p>
        ) : (
          <>
            <div className="admin-grid-2">
              <Field id="dep-userId" name="userId" label="Bidder" error={errors.userId}>
                {(props) => (
                  <select {...props} defaultValue="">
                    <option value="" disabled>
                      Choose an approved bidder…
                    </option>
                    {bidderOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <Field
                id="dep-amount"
                name="amount"
                label="Amount received (EUR)"
                error={errors.amount}
              >
                {(props) => <input {...props} type="text" inputMode="decimal" />}
              </Field>

              <Field id="dep-method" name="method" label="How it was paid" error={errors.method}>
                {(props) => (
                  <select {...props} defaultValue="sepa">
                    <option value="sepa">SEPA transfer</option>
                    <option value="card_hold">Card hold</option>
                  </select>
                )}
              </Field>

              <Field
                id="dep-providerRef"
                name="providerRef"
                label="Bank reference (optional)"
                error={errors.providerRef}
                hint="What you would quote to find this payment again."
              >
                {(props) => <input {...props} type="text" />}
              </Field>
            </div>

            <div className="admin-form-actions">
              <button className="admin-btn" type="submit" disabled={pending || !canRecord}>
                {pending ? "Recording…" : "Record deposit as received"}
              </button>
              {!canRecord ? (
                <span className="hint">Restricted to auctioneer accounts.</span>
              ) : null}
            </div>
          </>
        )}
      </form>
    </section>
  );
}
