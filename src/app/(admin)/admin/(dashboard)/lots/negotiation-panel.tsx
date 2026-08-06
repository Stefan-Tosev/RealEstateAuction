"use client";

import { useActionState } from "react";
import { decideNegotiationAction } from "../../bidder-actions";
import type { FormState } from "../../catalogue-actions";
import { Field } from "../../_components/field";

/*
 * The post-auction negotiation window — §10.
 *
 * Shown only while a lot sits in RESERVE_NOT_MET. It exists because that
 * status used to be a dead end: the lot with a verified buyer, money
 * already down and a known price was the one ending the system had no
 * answer for.
 *
 * The gap between bid and reserve is spelled out rather than left for
 * the auctioneer to work out, because it is the number the conversation
 * with the seller is actually about.
 */
export function NegotiationPanel({
  lotId,
  topBidFormatted,
  reserveFormatted,
  shortfallFormatted,
  endsAtFormatted,
  expired,
  canDecide,
}: {
  lotId: string;
  topBidFormatted: string | null;
  reserveFormatted: string;
  shortfallFormatted: string | null;
  endsAtFormatted: string | null;
  expired: boolean;
  canDecide: boolean;
}) {
  const accept = decideNegotiationAction.bind(null, lotId, "accept");
  const decline = decideNegotiationAction.bind(null, lotId, "decline");

  const [acceptState, acceptAction, accepting] = useActionState<FormState, FormData>(
    accept,
    undefined,
  );
  const [declineState, declineAction, declining] = useActionState<FormState, FormData>(
    decline,
    undefined,
  );

  const state = acceptState ?? declineState;
  const busy = accepting || declining;

  return (
    <section>
      <h2>Reserve not met</h2>

      <p style={{ fontSize: "0.85rem", opacity: 0.75, maxWidth: "60ch" }}>
        Bidding closed below the reserve. The top bid stands until the window ends and the top
        bidder&rsquo;s deposit is held until then. Everyone else has already had theirs back.
      </p>

      {state?.message ? (
        <p className="admin-notice" data-tone={state.errors ? "error" : "ok"} role="alert">
          {state.message}
        </p>
      ) : null}

      <table className="admin-table">
        <tbody>
          <tr>
            <th scope="row">Top bid</th>
            <td className="num">{topBidFormatted ?? "No bids"}</td>
          </tr>
          <tr>
            <th scope="row">Reserve</th>
            <td className="num">{reserveFormatted}</td>
          </tr>
          <tr>
            {/* The number the conversation with the seller is about. */}
            <th scope="row">Short by</th>
            <td className="num">{shortfallFormatted ?? "—"}</td>
          </tr>
          <tr>
            <th scope="row">Window ends</th>
            <td>
              {expired
                ? "Expired — closing on the next worker pass"
                : (endsAtFormatted ?? "—")}
            </td>
          </tr>
        </tbody>
      </table>

      {canDecide ? (
        <div className="admin-grid-2">
          <form className="admin-form" action={acceptAction} noValidate>
            <Field id="neg-accept-notes" name="notes" label="What the seller said">
              {(props) => (
                <input
                  {...props}
                  type="text"
                  placeholder="Agreed by phone, 14:20"
                  autoComplete="off"
                />
              )}
            </Field>
            <div className="admin-form-actions">
              <button className="admin-btn admin-btn-primary" type="submit" disabled={busy}>
                {accepting
                  ? "Selling…"
                  : `Seller accepts — sell at ${topBidFormatted ?? "the top bid"}`}
              </button>
            </div>
            {/* Below the button, not beside it: admin-form-actions is a
                flex row, and a hint sharing it squeezes a long label into
                a column two words wide. */}
            <p className="hint">
              Closes the lot as sold at the bid, below the agreed reserve. The reserve stays on the
              record as it was.
            </p>
          </form>

          <form className="admin-form" action={declineAction} noValidate>
            <Field id="neg-decline-notes" name="notes" label="Reason (optional)">
              {(props) => (
                <input
                  {...props}
                  type="text"
                  placeholder="Holding out for the reserve"
                  autoComplete="off"
                />
              )}
            </Field>
            <div className="admin-form-actions">
              <button className="admin-btn" type="submit" disabled={busy}>
                {declining ? "Closing…" : "Seller declines — close unsold"}
              </button>
            </div>
            <p className="hint">
              Releases the remaining deposit immediately. Happens on its own when the window ends.
            </p>
          </form>
        </div>
      ) : (
        <p className="hint">
          Only an auctioneer can conclude this — it commits the seller to a price below the reserve
          they agreed.
        </p>
      )}
    </section>
  );
}

/*
 * What happened, after the fact.
 *
 * The panel above unmounts the instant the status changes, and it takes
 * its own success message with it — click Accept and the whole thing
 * silently disappears. Rather than chase a toast that cannot survive its
 * own component, this reads the outcome back out of the lot.
 *
 * Selling below the agreed reserve is only reachable through §10's
 * window, so the pair (sold, under reserve) says a negotiation concluded
 * without needing a flag to say so. Durable, and still true tomorrow.
 */
export function NegotiationOutcomeNote({
  sold,
  topBidFormatted,
  reserveFormatted,
}: {
  sold: boolean;
  topBidFormatted: string | null;
  reserveFormatted: string;
}) {
  return (
    <p className="admin-notice" data-tone="ok">
      {sold
        ? `Sold at ${topBidFormatted ?? "the top bid"} after negotiation — below the agreed reserve of ${reserveFormatted}.`
        : "Closed unsold after the negotiation window. Deposits have been released."}
    </p>
  );
}
