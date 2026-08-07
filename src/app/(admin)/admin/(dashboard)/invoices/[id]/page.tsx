import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoice } from "@/server/fees/invoice";
import { issuer } from "@/server/fees/issuer";
import { requireAdmin, canPerform } from "@/server/identity/authz";
import { formatMoney } from "@/lib/money";
import { InvoiceControls } from "../invoice-controls";

export const dynamic = "force-dynamic";

const sofia = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", dateStyle: "long" });

const KIND_LABEL: Record<string, string> = {
  entry: "Entry / marketing fee",
  commission: "Seller's commission",
  premium: "Buyer's premium",
  withdrawal: "Withdrawal fee",
};

/*
 * The invoice itself, as a printable page.
 *
 * Not a generated PDF: a browser prints this to PDF perfectly well, and
 * a print stylesheet is a great deal less machinery than a rendering
 * library — with nothing to go stale when the layout changes.
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  const { id } = await params;

  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const from = issuer();
  const gross = invoice.netMinor + invoice.vatMinor;

  return (
    <>
      <div className="admin-page-head no-print">
        <h1>Invoice {invoice.number}</h1>
        <Link className="admin-btn" href="/admin/invoices">
          Back to invoices
        </Link>
      </div>

      <div className="no-print">
        <InvoiceControls
          invoiceId={invoice.id}
          status={invoice.status}
          canAct={canPerform(actor.role, "deposit.record")}
        />
      </div>

      <article className="invoice-sheet">
        <header className="invoice-head">
          <div>
            <h2>ФАКТУРА / INVOICE</h2>
            <p className="invoice-number">№ {invoice.number}</p>
            <p>Issued {sofia.format(invoice.issuedAt)}</p>
            {invoice.status === "cancelled" ? (
              <p className="invoice-cancelled">CANCELLED — {invoice.note}</p>
            ) : null}
          </div>

          <div className="invoice-parties">
            <section>
              <h3>From</h3>
              <p>{from.name}</p>
              <p>{from.address}</p>
              <p>ЕИК {from.eik}</p>
              {/* Omitted entirely when not registered, rather than shown
                  empty: a business below the threshold has no number and
                  charges no ДДС. */}
              {from.vat ? <p>ДДС № {from.vat}</p> : null}
              <p>IBAN {from.iban}</p>
            </section>

            <section>
              <h3>To</h3>
              <p>{invoice.billedName}</p>
              {invoice.billedAddress ? <p>{invoice.billedAddress}</p> : null}
              {invoice.billedEik ? <p>ЕИК {invoice.billedEik}</p> : null}
              {invoice.billedVat ? <p>ДДС № {invoice.billedVat}</p> : null}
            </section>
          </div>
        </header>

        <table className="admin-table invoice-lines">
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col">Rate</th>
              <th scope="col">Net</th>
              <th scope="col">ДДС</th>
            </tr>
          </thead>
          <tbody>
            {invoice.fees.map((fee) => (
              <tr key={fee.id}>
                <td>
                  {KIND_LABEL[fee.kind] ?? fee.kind}
                  <span className="invoice-line-lot">
                    {" "}
                    — lot {String(fee.lot.lotNumber).padStart(3, "0")},{" "}
                    {fee.lot.property.titleBg}
                    {fee.baseMinor ? ` (on ${formatMoney(fee.baseMinor, "en")})` : ""}
                  </span>
                </td>
                <td className="num">
                  {fee.rate ? `${(Number(fee.rate) * 100).toFixed(2)}%` : "—"}
                </td>
                <td className="num">{formatMoney(fee.netMinor, "en")}</td>
                <td className="num">{formatMoney(fee.vatMinor, "en")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Net
              </th>
              <td className="num" colSpan={2}>
                {formatMoney(invoice.netMinor, "en")}
              </td>
            </tr>
            <tr>
              <th scope="row" colSpan={2}>
                ДДС
              </th>
              <td className="num" colSpan={2}>
                {formatMoney(invoice.vatMinor, "en")}
              </td>
            </tr>
            <tr className="invoice-total">
              <th scope="row" colSpan={2}>
                Total due
              </th>
              <td className="num" colSpan={2}>
                {formatMoney(gross, "en")}
              </td>
            </tr>
          </tfoot>
        </table>
      </article>
    </>
  );
}
