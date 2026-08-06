"use client";

import { useActionState } from "react";
import type { LotStatus } from "@prisma/client";
import {
  agreeReserveAction,
  changeStatusAction,
  type FormState,
} from "../../catalogue-actions";

/*
 * The lifecycle controls: agree the reserve, publish, unpublish, cancel.
 *
 * Buttons a `staff` account may not use are disabled with the reason
 * shown, rather than hidden — an operator who cannot see a control
 * cannot understand why the lot is stuck. The server re-checks the role
 * regardless; this is explanation, not enforcement.
 */
export function LotControls({
  lotId,
  status,
  transitions,
  blockers,
  warnings,
  reserveAgreed,
  canActAsAuctioneer,
}: {
  lotId: string;
  status: LotStatus;
  transitions: LotStatus[];
  blockers: string[];
  /** Worth saying, not worth stopping a publish over. */
  warnings: string[];
  reserveAgreed: boolean;
  canActAsAuctioneer: boolean;
}) {
  const agree = agreeReserveAction.bind(null, lotId);
  const [agreeState, agreeAction, agreePending] = useActionState<FormState, FormData>(
    async () => agree(),
    undefined,
  );

  return (
    <section>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>Lifecycle</h2>

      {agreeState?.message ? (
        <p className="admin-notice" data-tone="ok" role="status">
          {agreeState.message}
        </p>
      ) : null}

      {!reserveAgreed ? (
        <form action={agreeAction} style={{ marginBottom: "1rem" }}>
          <p className="admin-notice" data-tone="error">
            {/* §10: sellers do not set the reserve unilaterally. */}
            No auctioneer has agreed this reserve, so the lot cannot be published.
          </p>
          <button
            className="admin-btn"
            type="submit"
            disabled={agreePending || !canActAsAuctioneer}
            title={canActAsAuctioneer ? undefined : "Restricted to auctioneer accounts."}
          >
            {agreePending ? "Recording…" : "Agree the reserve"}
          </button>
          {!canActAsAuctioneer ? (
            <span className="hint" style={{ marginLeft: "0.6rem" }}>
              Restricted to auctioneer accounts.
            </span>
          ) : null}
        </form>
      ) : null}

      {warnings.length > 0 ? (
        <div className="admin-notice">
          {/*
            Deliberately not a blocker. These documents matter for the
            transfer rather than for the decision to bid, and holding up a
            sale over paperwork that has until completion to arrive would
            cost the seller without protecting the bidder.
          */}
          <strong>Worth chasing:</strong>
          <ul className="admin-blockers">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {blockers.length > 0 ? (
        <div className="admin-notice" data-tone="error">
          <strong>Cannot be published yet:</strong>
          <ul className="admin-blockers">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="admin-form-actions">
        {transitions.length === 0 ? (
          <p className="hint">
            {/* BIDDING_OPEN -> EXTENDING -> CLOSED_* belong to the
                soft-close engine, not to a person with a dropdown. */}
            No manual transitions are available from {status}.
          </p>
        ) : (
          transitions.map((to) => (
            <TransitionButton
              key={to}
              lotId={lotId}
              to={to}
              disabled={
                (to === "PUBLISHED" && blockers.length > 0) || !canActAsAuctioneer
              }
              reason={!canActAsAuctioneer ? "Restricted to auctioneer accounts." : undefined}
            />
          ))
        )}
      </div>
    </section>
  );
}

function TransitionButton({
  lotId,
  to,
  disabled,
  reason,
}: {
  lotId: string;
  to: LotStatus;
  disabled: boolean;
  reason?: string;
}) {
  const bound = changeStatusAction.bind(null, lotId, to);
  const [state, action, isPending] = useActionState<FormState, FormData>(
    async (prev) => bound(prev),
    undefined,
  );

  return (
    <form action={action}>
      <button
        className={`admin-btn ${to === "PUBLISHED" ? "admin-btn-primary" : ""} ${
          to === "CANCELLED" ? "admin-btn-danger" : ""
        }`}
        type="submit"
        disabled={disabled || isPending}
        title={reason}
      >
        {isPending ? "Working…" : labelFor(to)}
      </button>
      {state?.message ? (
        <span className="admin-field-error" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

function labelFor(status: LotStatus): string {
  switch (status) {
    case "PUBLISHED":
      return "Publish";
    case "DRAFT":
      return "Return to draft";
    case "CANCELLED":
      return "Cancel lot";
    default:
      return `Move to ${status}`;
  }
}
