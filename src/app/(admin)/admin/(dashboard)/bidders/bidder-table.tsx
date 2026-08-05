"use client";

import { useActionState } from "react";
import { decideBidderAction } from "../../bidder-actions";
import type { FormState } from "../../catalogue-actions";

export type BidderView = {
  id: string;
  email: string;
  name: string;
  accountType: string;
  companyName: string | null;
  eik: string | null;
  verified: boolean;
  registeredAt: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  notes: string | null;
};

/*
 * Manual approval, which §9 says is right at MVP volume: "Phase 2 uses
 * manual review; wire a provider at Phase 5."
 *
 * Approving is what lets someone commit to a five-figure purchase, so it
 * is deliberately a considered act — a note field, and the account's
 * details in front of you — rather than a one-click toggle.
 */
export function BidderTable({ bidders, canDecide }: { bidders: BidderView[]; canDecide: boolean }) {
  if (bidders.length === 0) {
    return (
      <div className="admin-empty">
        <p>No bidders have registered yet.</p>
      </div>
    );
  }

  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Bidder</th>
          <th>Type</th>
          <th>Registered</th>
          <th>Status</th>
          <th>Decision</th>
        </tr>
      </thead>
      <tbody>
        {bidders.map((bidder) => (
          <BidderRow key={bidder.id} bidder={bidder} canDecide={canDecide} />
        ))}
      </tbody>
    </table>
  );
}

function BidderRow({ bidder, canDecide }: { bidder: BidderView; canDecide: boolean }) {
  const approve = decideBidderAction.bind(null, bidder.id, "approved");
  const reject = decideBidderAction.bind(null, bidder.id, "rejected");

  const [state, approveAction, approving] = useActionState<FormState, FormData>(
    approve,
    undefined,
  );
  const [rejectState, rejectAction, rejecting] = useActionState<FormState, FormData>(
    reject,
    undefined,
  );

  const message = state?.message ?? rejectState?.message;

  return (
    <tr>
      <td>
        {bidder.name}
        <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>{bidder.email}</div>
        {bidder.companyName ? (
          <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>
            {bidder.companyName}
            {bidder.eik ? ` · ЕИК ${bidder.eik}` : ""}
          </div>
        ) : null}
      </td>

      <td>
        {bidder.accountType}
        {!bidder.verified ? (
          /*
           * Approving an unconfirmed address is refused server-side —
           * the gate that lets someone bid should not rest on an address
           * nobody has proven they control.
           */
          <div className="admin-chip" data-status="CANCELLED" style={{ marginTop: "0.25rem" }}>
            email unconfirmed
          </div>
        ) : null}
      </td>

      <td className="num">{bidder.registeredAt}</td>

      <td>
        <span
          className="admin-chip"
          data-status={
            bidder.status === "approved"
              ? "PUBLISHED"
              : bidder.status === "rejected"
                ? "CANCELLED"
                : undefined
          }
        >
          {bidder.status}
        </span>
        {bidder.reviewedBy ? (
          <div style={{ fontSize: "0.72rem", opacity: 0.7, marginTop: "0.25rem" }}>
            {bidder.reviewedBy}
            {bidder.reviewedAt ? ` · ${bidder.reviewedAt}` : ""}
          </div>
        ) : null}
        {bidder.notes ? (
          <div style={{ fontSize: "0.72rem", opacity: 0.7 }}>“{bidder.notes}”</div>
        ) : null}
      </td>

      <td>
        {message ? (
          <p className="admin-notice" data-tone="ok" role="status" style={{ marginBottom: "0.5rem" }}>
            {message}
          </p>
        ) : null}

        <form action={approveAction} style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          <input
            className="admin-input-inline"
            name="notes"
            placeholder="Note (optional)"
            aria-label={`Note for ${bidder.name}`}
            style={{ flex: "1 1 10rem", minWidth: 0 }}
          />
          <button
            className="admin-btn admin-btn-sm admin-btn-primary"
            type="submit"
            disabled={!canDecide || approving || !bidder.verified}
            title={
              !canDecide
                ? "Restricted to auctioneer accounts."
                : !bidder.verified
                  ? "This bidder has not confirmed their email address."
                  : undefined
            }
          >
            {approving ? "…" : "Approve"}
          </button>
          <button
            className="admin-btn admin-btn-sm admin-btn-danger"
            type="submit"
            formAction={rejectAction}
            disabled={!canDecide || rejecting}
            title={!canDecide ? "Restricted to auctioneer accounts." : undefined}
          >
            {rejecting ? "…" : "Reject"}
          </button>
        </form>
      </td>
    </tr>
  );
}
