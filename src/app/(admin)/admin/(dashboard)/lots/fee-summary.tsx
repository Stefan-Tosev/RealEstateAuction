/*
 * What the auction house is owed on a lot — §10.
 *
 * Net and ДДС are shown as separate columns rather than one total,
 * because that is what an invoice has to say and because only the net is
 * revenue: the ДДС is collected for НАП and passes straight through. A
 * summary that totalled the gross would overstate what the business
 * actually earns by a fifth.
 *
 * A server component: nothing here is interactive yet. Marking a fee
 * invoiced or paid is the next piece, and it belongs with whatever
 * raises the invoice.
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
}: {
  fees: AdminFee[];
  netTotalFormatted: string;
  vatTotalFormatted: string;
}) {
  return (
    <section>
      <h2>Fees</h2>

      {fees.length === 0 ? (
        <p className="admin-empty">
          Nothing due yet. The entry fee is raised when the lot is published; commission and
          premium when it sells.
        </p>
      ) : (
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
      )}
    </section>
  );
}
