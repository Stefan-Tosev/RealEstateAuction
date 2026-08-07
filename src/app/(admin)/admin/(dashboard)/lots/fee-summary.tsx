"use client";

import { useActionState } from "react";
import { raiseInvoiceAction } from "../../invoice-actions";
import type { FormState } from "../../catalogue-actions";

/*
 * What the auction house is owed on a lot — §10.
 *
 * Net and ДДС are shown as separate columns rather than one total,
 * because that is what an invoice has to say and because only the net is
 * revenue: the ДДС is collected for НАП and passes straight through. A
 * summary that totalled the gross would overstate what the business
 * actually earns by a fifth.
 *
 * Fees are raised automatically at publish, close and withdrawal; what
 * an operator does here is turn the due ones into an invoice. A fee is
 * what somebody owes, an invoice is the document raised for it, and one
 * invoice covers every due fee for that party on this lot.
 */

export type AdminFee = {
  id: string;
  party: "seller" | "buyer";
  kind: "entry" | "commission" | "premium" | "withdrawal";
  netFormatted: string;
  vatFormatted: string;
  grossFormatted: string;
  rate: string | null;
  status: string;
  chargedAt: string | null;
};

const KIND_LABEL: Record<AdminFee["kind"], string> = {
  entry: "Entry fee",
  commission: "Seller's commission",
  premium: "Buyer's premium",
  withdrawal: "Withdrawal fee",
};

export function FeeSummary({
  fees,
  netTotalFormatted,
  vatTotalFormatted,
  lotId,
  canInvoice,
}: {
  fees: AdminFee[];
  netTotalFormatted: string;
  vatTotalFormatted: string;
  lotId: string;
  canInvoice: boolean;
}) {
  const [sellerState, raiseSeller, raisingSeller] = useActionState<FormState, FormData>(
    raiseInvoiceAction.bind(null, lotId, "seller"),
    undefined,
  );
  const [buyerState, raiseBuyer, raisingBuyer] = useActionState<FormState, FormData>(
    raiseInvoiceAction.bind(null, lotId, "buyer"),
    undefined,
  );

  const message = sellerState?.message ?? buyerState?.message;
  const dueFor = (party: AdminFee["party"]) =>
    fees.some((fee) => fee.party === party && fee.status === "due");

  return (
    <section>
      <h2>Fees</h2>

      {fees.length === 0 ? (
        <p className="admin-empty">
          Nothing due yet. The entry fee is raised when the lot is published; commission and
          premium when it sells.
        </p>
      ) : null}

      {message ? (
        <p className="admin-notice" role="alert">
          {message}
        </p>
      ) : null}

      {fees.length > 0 ? (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Fee</th>
              <th scope="col">Owed by</th>
              <th scope="col">Rate</th>
              <th scope="col">Net</th>
              <th scope="col">ДДС</th>
              <th scope="col">Total</th>
              <th scope="col">Status</th>
              <th scope="col">Raised</th>
            </tr>
          </thead>
          <tbody>
            {fees.map((fee) => (
              <tr key={fee.id}>
                <td>{KIND_LABEL[fee.kind]}</td>
                <td>{fee.party === "seller" ? "Seller" : "Buyer"}</td>
                <td className="num">
                  {/* Stored as a decimal fraction; read as a percentage. */}
                  {fee.rate ? `${(Number(fee.rate) * 100).toFixed(2)}%` : "—"}
                </td>
                <td className="num">{fee.netFormatted}</td>
                <td className="num">{fee.vatFormatted}</td>
                <td className="num">{fee.grossFormatted}</td>
                <td>{fee.status}</td>
                <td>{fee.chargedAt ?? "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Total
              </th>
              <td className="num">{netTotalFormatted}</td>
              <td className="num">{vatTotalFormatted}</td>
              <td className="num">—</td>
              <td colSpan={2}>
                {/* Said plainly, because it is the number that matters and
                    the one most easily got wrong. */}
                <span className="hint">Net is revenue. ДДС is collected for НАП.</span>
              </td>
            </tr>
          </tfoot>
        </table>
      ) : null}

      {canInvoice ? (
        <div className="admin-form-actions">
          {dueFor("seller") ? (
            <form action={raiseSeller}>
              <button className="admin-btn" type="submit" disabled={raisingSeller}>
                {raisingSeller ? "Raising…" : "Invoice the seller"}
              </button>
            </form>
          ) : null}

          {dueFor("buyer") ? (
            <form action={raiseBuyer}>
              <button className="admin-btn" type="submit" disabled={raisingBuyer}>
                {raisingBuyer ? "Raising…" : "Invoice the buyer"}
              </button>
            </form>
          ) : null}

          {!dueFor("seller") && !dueFor("buyer") && fees.length > 0 ? (
            <span className="hint">Everything here has been invoiced.</span>
          ) : null}
        </div>
      ) : fees.length > 0 ? (
        <p className="hint">Only an auctioneer can raise an invoice.</p>
      ) : null}
    </section>
  );
}
