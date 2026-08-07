import Link from "next/link";
import { notFound } from "next/navigation";
import { getSale } from "@/server/sales/sale";
import { requireAdmin, canPerform } from "@/server/identity/authz";
import { formatMoney } from "@/lib/money";
import { SaleControls } from "../sale-controls";

export const dynamic = "force-dynamic";

const sofia = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", dateStyle: "long" });
const day = (date: Date | null) => (date ? sofia.format(date) : null);

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  const { id } = await params;

  const sale = await getSale(id);
  if (!sale) notFound();

  return (
    <>
      <div className="admin-page-head">
        <h1>
          Lot {String(sale.lot.lotNumber).padStart(3, "0")} — {sale.lot.property.titleBg}
        </h1>
        <Link className="admin-btn" href="/admin/sales">
          Back to sales
        </Link>
      </div>

      {sale.overdue ? (
        <p className="admin-notice" data-tone="error">
          {/* The one thing worth interrupting an operator about. */}
          <strong>Overdue.</strong> Completion was due {sofia.format(sale.completionDueAt)} and this
          sale has neither completed nor been recorded as defaulted.
        </p>
      ) : null}

      <table className="admin-table">
        <tbody>
          <tr>
            <th scope="row">Buyer</th>
            <td>
              {sale.user.firstName} {sale.user.lastName} — {sale.user.email}
              {sale.user.phone ? ` — ${sale.user.phone}` : ""}
            </td>
          </tr>
          <tr>
            <th scope="row">Property</th>
            <td>{sale.lot.property.address}</td>
          </tr>
          <tr>
            <th scope="row">Hammer price</th>
            <td className="num">{formatMoney(sale.hammerMinor, "en")}</td>
          </tr>
          <tr>
            <th scope="row">Deposit held</th>
            {/* It comes off the price — that is what it was taken for. */}
            <td className="num">{formatMoney(sale.depositMinor, "en")}</td>
          </tr>
          <tr>
            <th scope="row">Balance to pay</th>
            <td className="num">
              <strong>{formatMoney(sale.balanceMinor, "en")}</strong>
            </td>
          </tr>
          <tr>
            <th scope="row">Completion due</th>
            <td>{sofia.format(sale.completionDueAt)}</td>
          </tr>
          <tr>
            <th scope="row">Contract signed</th>
            <td>{day(sale.contractSignedAt) ?? "—"}</td>
          </tr>
          <tr>
            <th scope="row">Balance paid</th>
            <td>{day(sale.balancePaidAt) ?? "—"}</td>
          </tr>
          <tr>
            <th scope="row">Deed signed</th>
            <td>{day(sale.completedAt) ?? "—"}</td>
          </tr>
          {sale.notes ? (
            <tr>
              <th scope="row">Notes</th>
              <td>{sale.notes}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <hr style={{ border: 0, borderTop: "1px solid var(--admin-border)", margin: "2rem 0" }} />

      <SaleControls
        saleId={sale.id}
        contractSignedAt={day(sale.contractSignedAt)}
        balancePaidAt={day(sale.balancePaidAt)}
        completedAt={day(sale.completedAt)}
        defaulted={Boolean(sale.defaultedAt)}
        canAct={canPerform(actor.role, "deposit.record")}
      />
    </>
  );
}
