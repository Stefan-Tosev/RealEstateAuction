import Link from "next/link";
import { listInvoices } from "@/server/fees/invoice";
import { issuerBlockers, isDemoIssuer } from "@/server/fees/issuer";
import { requireAdmin } from "@/server/identity/authz";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const sofia = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Sofia",
  dateStyle: "medium",
});

export default async function InvoicesPage() {
  await requireAdmin();
  const invoices = await listInvoices();
  const missing = issuerBlockers();

  const outstanding = invoices
    .filter((invoice) => invoice.status === "issued")
    .reduce((total, invoice) => total + invoice.netMinor + invoice.vatMinor, 0n);

  return (
    <>
      <div className="admin-page-head">
        <h1>Invoices</h1>
      </div>

      {isDemoIssuer() ? (
        <p className="admin-notice" data-tone="error">
          <strong>Demo mode.</strong> Invoices carry placeholder issuer details, are marked
          SPECIMEN, and are numbered in a separate <code>DEMO-</code> series — so real numbering
          still starts at 1 when you put your registration in and set{" "}
          <code>INVOICE_DEMO_MODE=false</code>.
        </p>
      ) : null}

      {missing.length > 0 ? (
        <p className="admin-notice" data-tone="error">
          {/* Refusing to issue beats issuing a document with gaps in it —
              an invoice already sent cannot be unsent. */}
          <strong>Nothing can be invoiced yet.</strong> The auction house&rsquo;s own details are
          not configured: {missing.join(", ")}.
        </p>
      ) : null}

      {invoices.length === 0 ? (
        <p className="admin-empty">
          No invoices raised. Fees become invoiceable from the lot they were charged on.
        </p>
      ) : (
        <>
          <p className="hint">
            {/* The number an operator actually wants on this page. */}
            Outstanding: <strong>{formatMoney(outstanding, "en")}</strong>
          </p>

          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Billed to</th>
                <th scope="col">Net</th>
                <th scope="col">ДДС</th>
                <th scope="col">Total</th>
                <th scope="col">Status</th>
                <th scope="col">Issued</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <Link href={`/admin/invoices/${invoice.id}`}>{invoice.number}</Link>
                  </td>
                  <td>{invoice.billedName}</td>
                  <td className="num">{formatMoney(invoice.netMinor, "en")}</td>
                  <td className="num">{formatMoney(invoice.vatMinor, "en")}</td>
                  <td className="num">
                    {formatMoney(invoice.netMinor + invoice.vatMinor, "en")}
                  </td>
                  <td>{invoice.status}</td>
                  <td>{sofia.format(invoice.issuedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
