import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/datetime";
import type { Locale } from "@/lib/i18n/locales";

/*
 * An invoice as the party it bills sees it, behind a signed link.
 *
 * Separate from getInvoice() in invoice.ts, which is the admin reader and
 * uses `include`. This one is a select allowlist for the same reason the
 * catalogue has one: the page it feeds renders under (public), where
 * nothing may be one field name away from leaking. An invoice carries no
 * reserve price and no other party's details, and this keeps it that way
 * by construction rather than by remembering.
 *
 * Everything crossing out of here is a string. Prisma hands back bigint,
 * Decimal and Date, none of which survive the trip to a client
 * component, and dates are formatted server-side in Sofia so there is no
 * hydration mismatch to have.
 */

const SELECT = {
  id: true,
  number: true,
  status: true,
  billedName: true,
  billedAddress: true,
  billedEik: true,
  billedVat: true,
  netMinor: true,
  vatMinor: true,
  issuedAt: true,
  note: true,
  fees: {
    select: {
      id: true,
      kind: true,
      netMinor: true,
      vatMinor: true,
      rate: true,
      baseMinor: true,
      lot: { select: { lotNumber: true, property: { select: { titleBg: true, titleEn: true } } } },
    },
  },
} as const;

export type InvoiceLine = {
  id: string;
  kind: string;
  lotRef: string;
  lotTitle: string;
  /** The amount the percentage was taken on, already formatted, or null. */
  base: string | null;
  rate: string | null;
  net: string;
  vat: string;
};

export type InvoiceView = {
  id: string;
  number: string;
  status: string;
  issuedAt: string;
  note: string | null;
  billedName: string;
  billedAddress: string | null;
  billedEik: string | null;
  billedVat: string | null;
  lines: InvoiceLine[];
  net: string;
  vat: string;
  total: string;
};

export async function getInvoiceForRecipient(
  id: string,
  locale: Locale,
): Promise<InvoiceView | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id }, select: SELECT });
  if (!invoice) return null;

  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    issuedAt: formatDate(invoice.issuedAt, locale),
    note: invoice.note,
    billedName: invoice.billedName,
    billedAddress: invoice.billedAddress,
    billedEik: invoice.billedEik,
    billedVat: invoice.billedVat,
    lines: invoice.fees.map((fee) => ({
      id: fee.id,
      kind: fee.kind,
      lotRef: String(fee.lot.lotNumber).padStart(3, "0"),
      lotTitle: locale === "bg" ? fee.lot.property.titleBg : fee.lot.property.titleEn,
      base: fee.baseMinor ? formatMoney(fee.baseMinor, locale) : null,
      // Stored as the rate that was actually applied, so an invoice
      // reissued after the statute changes still shows what was charged.
      rate: fee.rate ? `${(Number(fee.rate) * 100).toFixed(2)}%` : null,
      net: formatMoney(fee.netMinor, locale),
      vat: formatMoney(fee.vatMinor, locale),
    })),
    net: formatMoney(invoice.netMinor, locale),
    vat: formatMoney(invoice.vatMinor, locale),
    total: formatMoney(invoice.netMinor + invoice.vatMinor, locale),
  };
}
