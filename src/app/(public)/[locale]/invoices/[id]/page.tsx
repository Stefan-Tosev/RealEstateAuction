import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n";
import { isLocale } from "@/lib/i18n/locales";
import { verifyInvoiceSignature } from "@/server/fees/invoice-link";
import { getInvoiceForRecipient } from "@/server/fees/invoice-view";
import { issuer, isDemoIssuer } from "@/server/fees/issuer";
import "@/styles/invoice.css";

/*
 * An invoice, for the party it bills.
 *
 * A seller is a record rather than an account — §11 — so there is no
 * session to check here and the signed link is the whole of the
 * authorisation. That makes the order below load-bearing: verify the
 * signature first, and only then read anything from the database.
 *
 * A bad signature answers 404, never 403, for the same reason the
 * document route does: "this exists and you may not have it" is itself a
 * disclosure. An expired one is different — it proves the holder was
 * sent a genuine link — so it says so and nothing else. No number, no
 * amount, no party.
 *
 * Printing is the browser's job. The admin sheet takes the same view,
 * and a print stylesheet is a great deal less machinery than a PDF
 * renderer with nothing to go stale when the layout changes.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  /* Never indexed: it is somebody's invoice behind a bearer link. */
  robots: { index: false, follow: false },
};

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();

  const t = getDictionary(locale);
  const query = await searchParams;
  const one = (value: string | string[] | undefined): string | null =>
    typeof value === "string" ? value : null;

  const verdict = verifyInvoiceSignature(id, one(query.exp), one(query.sig));
  if (verdict === "bad-signature") notFound();

  if (verdict === "expired") {
    return (
      <main className="invoice-page">
        <div className="invoice-expired">
          <h1>{t.invoice.expiredHeading}</h1>
          <p>{t.invoice.expiredBody}</p>
        </div>
      </main>
    );
  }

  const invoice = await getInvoiceForRecipient(id, locale);
  if (!invoice) notFound();

  const from = issuer();

  return (
    <main className="invoice-page">
      <article className="invoice-sheet" data-demo={isDemoIssuer() ? "true" : undefined}>
        {isDemoIssuer() ? <p className="invoice-specimen">{t.invoice.specimen}</p> : null}

        <header className="invoice-head">
          <div>
            <h1 className="invoice-number">
              {t.invoice.heading.replace("{number}", invoice.number)}
            </h1>
            <p>{t.invoice.issued.replace("{date}", invoice.issuedAt)}</p>
            {invoice.status === "cancelled" ? (
              <p className="invoice-cancelled">
                {t.invoice.cancelled}
                {invoice.note ? ` — ${invoice.note}` : ""}
              </p>
            ) : null}
          </div>

          <div className="invoice-parties">
            <section>
              <h2>{t.invoice.from}</h2>
              <p>{from.name}</p>
              <p>{from.address}</p>
              <p>ЕИК {from.eik}</p>
              {/* Omitted when there is none, rather than shown empty: a
                  business below the threshold charges no ДДС. */}
              {from.vat ? <p>ДДС № {from.vat}</p> : null}
              <p>IBAN {from.iban}</p>
            </section>

            <section>
              <h2>{t.invoice.to}</h2>
              <p>{invoice.billedName}</p>
              {invoice.billedAddress ? <p>{invoice.billedAddress}</p> : null}
              {invoice.billedEik ? <p>ЕИК {invoice.billedEik}</p> : null}
              {invoice.billedVat ? <p>ДДС № {invoice.billedVat}</p> : null}
            </section>
          </div>
        </header>

        <table className="invoice-lines">
          <thead>
            <tr>
              <th scope="col">{t.invoice.description}</th>
              <th scope="col">{t.invoice.rate}</th>
              <th scope="col">{t.invoice.net}</th>
              <th scope="col">{t.invoice.vat}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  {t.invoice.kind[line.kind as keyof typeof t.invoice.kind] ?? line.kind}
                  <span className="invoice-line-lot">
                    {" — "}
                    {t.invoice.lot.replace("{ref}", line.lotRef)}, {line.lotTitle}
                    {line.base ? ` (${t.invoice.on.replace("{amount}", line.base)})` : ""}
                  </span>
                </td>
                <td className="num">{line.rate ?? "—"}</td>
                <td className="num">{line.net}</td>
                <td className="num">{line.vat}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                {t.invoice.net}
              </th>
              <td className="num" colSpan={2}>
                {invoice.net}
              </td>
            </tr>
            <tr>
              <th scope="row" colSpan={2}>
                {t.invoice.vat}
              </th>
              <td className="num" colSpan={2}>
                {invoice.vat}
              </td>
            </tr>
            <tr className="invoice-total">
              <th scope="row" colSpan={2}>
                {t.invoice.total}
              </th>
              <td className="num" colSpan={2}>
                {invoice.total}
              </td>
            </tr>
          </tfoot>
        </table>
      </article>
    </main>
  );
}
