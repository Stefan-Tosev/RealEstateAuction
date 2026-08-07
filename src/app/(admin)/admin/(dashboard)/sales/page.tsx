import Link from "next/link";
import { listSales } from "@/server/sales/sale";
import { requireAdmin } from "@/server/identity/authz";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const sofia = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", dateStyle: "medium" });

const STATUS_LABEL: Record<string, string> = {
  "awaiting-contract": "Awaiting contract",
  "awaiting-balance": "Awaiting balance",
  "awaiting-completion": "Awaiting notary",
  completed: "Completed",
  defaulted: "Defaulted",
};

/*
 * The operations view: which sales are outstanding, and what each is
 * waiting on.
 *
 * Before this existed the answer lived on paper and in somebody's head,
 * which is fine for one sale and impossible for ten.
 */
export default async function SalesPage() {
  await requireAdmin();
  const sales = await listSales();

  const outstanding = sales.filter((s) => s.status !== "completed" && s.status !== "defaulted");
  const overdue = outstanding.filter((s) => s.overdue);
  const owed = outstanding.reduce((total, s) => total + s.balanceMinor, 0n);

  return (
    <>
      <div className="admin-page-head">
        <h1>Sales</h1>
      </div>

      {sales.length === 0 ? (
        <p className="admin-empty">
          No sales yet. One opens automatically the moment a lot is sold.
        </p>
      ) : (
        <>
          <p className="hint">
            {/* The three numbers an auctioneer actually opens this page for. */}
            <strong>{outstanding.length}</strong> in progress · <strong>{formatMoney(owed, "en")}</strong>{" "}
            still to be paid
            {overdue.length > 0 ? (
              <>
                {" "}
                · <strong data-tone="error">{overdue.length} overdue</strong>
              </>
            ) : null}
          </p>

          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Lot</th>
                <th scope="col">Buyer</th>
                <th scope="col">Price</th>
                <th scope="col">Balance</th>
                <th scope="col">Waiting on</th>
                <th scope="col">Due</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id} data-overdue={sale.overdue ? "true" : undefined}>
                  <td>
                    <Link href={`/admin/sales/${sale.id}`}>
                      {String(sale.lot.lotNumber).padStart(3, "0")}
                    </Link>{" "}
                    <span className="hint">{sale.lot.property.titleBg}</span>
                  </td>
                  <td>
                    {sale.user.firstName} {sale.user.lastName}
                  </td>
                  <td className="num">{formatMoney(sale.hammerMinor, "en")}</td>
                  <td className="num">
                    {sale.status === "completed" || sale.status === "defaulted"
                      ? "—"
                      : formatMoney(sale.balanceMinor, "en")}
                  </td>
                  <td>{STATUS_LABEL[sale.status]}</td>
                  <td>
                    {sale.completedAt || sale.defaultedAt
                      ? "—"
                      : `${sofia.format(sale.completionDueAt)}${sale.overdue ? " — overdue" : ""}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
