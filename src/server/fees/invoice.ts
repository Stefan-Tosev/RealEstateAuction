import type { FeeParty } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit/record";
import type { AdminActor } from "@/server/identity/authz";
import { issuerBlockers } from "./issuer";

/*
 * Raising an invoice for the fees a party owes on a lot.
 *
 * A fee is what somebody owes; an invoice is the document raised for it.
 * One invoice covers several fees, because a seller's entry fee and
 * commission on the same lot belong on one piece of paper.
 */

export class InvoiceRefused extends Error {}

/**
 * The next number, taken under a row lock.
 *
 * Gapless because it must be: Bulgarian фактури are numbered
 * consecutively, and a Postgres sequence is the wrong tool — nextval()
 * survives a rollback, so an aborted transaction burns a number nobody
 * can account for.
 *
 * Locking the counter row serialises invoice creation. That is not a
 * cost to be engineered around; invoices genuinely have to be issued one
 * after another, and at this volume the lock is never contended.
 */
async function nextNumber(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  series: string,
): Promise<string> {
  await tx.$executeRaw`
    INSERT INTO invoice_counters (series, next) VALUES (${series}, 1)
    ON CONFLICT (series) DO NOTHING
  `;

  const rows = await tx.$queryRaw<{ next: number }[]>`
    SELECT next FROM invoice_counters WHERE series = ${series} FOR UPDATE
  `;

  const next = rows[0].next;
  await tx.$executeRaw`UPDATE invoice_counters SET next = ${next + 1} WHERE series = ${series}`;

  // Ten digits, the Bulgarian convention.
  return String(next).padStart(10, "0");
}

/**
 * Bill everything currently due from one party on one lot.
 *
 * Only `due` fees. An already-invoiced fee must never appear on a second
 * document — that is how somebody gets asked to pay twice — and a waived
 * one has been forgiven.
 */
export async function raiseInvoice(
  actor: AdminActor,
  lotId: string,
  party: FeeParty,
): Promise<{ id: string; number: string }> {
  const missing = issuerBlockers();
  if (missing.length > 0) {
    throw new InvoiceRefused(
      `The auction house's own invoice details are not configured: ${missing.join(", ")}.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const fees = await tx.fee.findMany({
      where: { lotId, party, status: "due" },
      select: { id: true, netMinor: true, vatMinor: true, sellerId: true, userId: true },
    });

    if (fees.length === 0) {
      throw new InvoiceRefused("There is nothing due from this party on this lot.");
    }

    const sellerId = fees.find((fee) => fee.sellerId)?.sellerId ?? null;
    const userId = fees.find((fee) => fee.userId)?.userId ?? null;

    if (!sellerId && !userId) {
      throw new InvoiceRefused(
        "These fees have no counterparty recorded, so there is nobody to invoice.",
      );
    }

    /*
     * Copied onto the invoice rather than joined at render time. An
     * invoice records what was billed on a date; if the party later
     * changes their address, the document already sent must not silently
     * change with it.
     */
    const billed = sellerId
      ? await tx.seller.findUniqueOrThrow({
          where: { id: sellerId },
          select: { name: true, address: true, eik: true, vat: true },
        })
      : await tx.user
          .findUniqueOrThrow({
            where: { id: userId! },
            select: { firstName: true, lastName: true, companyName: true, eik: true, vat: true },
          })
          .then((user) => ({
            name: user.companyName ?? `${user.firstName} ${user.lastName}`,
            address: null,
            eik: user.eik,
            vat: user.vat,
          }));

    const series = String(new Date().getFullYear());
    const number = await nextNumber(tx, series);

    const invoice = await tx.invoice.create({
      data: {
        number,
        series,
        sellerId,
        userId: sellerId ? null : userId,
        billedName: billed.name,
        billedAddress: billed.address,
        billedEik: billed.eik,
        billedVat: billed.vat,
        netMinor: fees.reduce((total, fee) => total + fee.netMinor, 0n),
        vatMinor: fees.reduce((total, fee) => total + fee.vatMinor, 0n),
      },
      select: { id: true, number: true },
    });

    await tx.fee.updateMany({
      where: { id: { in: fees.map((fee) => fee.id) } },
      data: { status: "invoiced", invoiceId: invoice.id },
    });

    return invoice;
  });
}

/** Money arrived. Marks the invoice and everything on it. */
export async function markInvoicePaid(actor: AdminActor, invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { status: true, number: true },
  });

  if (invoice.status !== "issued") {
    throw new InvoiceRefused(`Invoice ${invoice.number} is already ${invoice.status}.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "paid", paidAt: new Date() },
    });
    await tx.fee.updateMany({ where: { invoiceId }, data: { status: "paid" } });
  });

  await recordAudit({
    actorId: actor.id,
    action: "invoice.paid",
    entityType: "invoice",
    entityId: invoiceId,
    after: { number: invoice.number },
  });
}

/**
 * Cancel an issued invoice, returning its fees to `due`.
 *
 * The invoice row stays, and its number stays used. Deleting it would
 * leave a hole in the sequence, which is the one thing the counter design
 * exists to prevent — a cancelled invoice is part of the record, not an
 * embarrassment to be erased.
 */
export async function cancelInvoice(
  actor: AdminActor,
  invoiceId: string,
  reason: string,
): Promise<void> {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { status: true, number: true },
  });

  if (invoice.status === "paid") {
    throw new InvoiceRefused(`Invoice ${invoice.number} is paid and cannot be cancelled.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "cancelled", note: reason },
    });
    await tx.fee.updateMany({ where: { invoiceId }, data: { status: "due", invoiceId: null } });
  });

  await recordAudit({
    actorId: actor.id,
    action: "invoice.cancelled",
    entityType: "invoice",
    entityId: invoiceId,
    after: { number: invoice.number, reason },
  });
}

export function listInvoices() {
  return prisma.invoice.findMany({
    orderBy: { issuedAt: "desc" },
    select: {
      id: true,
      number: true,
      status: true,
      billedName: true,
      netMinor: true,
      vatMinor: true,
      issuedAt: true,
      paidAt: true,
    },
  });
}

export function getInvoice(id: string) {
  return prisma.invoice.findUnique({
    where: { id },
    include: {
      fees: {
        select: {
          id: true,
          kind: true,
          netMinor: true,
          vatMinor: true,
          rate: true,
          baseMinor: true,
          lot: { select: { lotNumber: true, property: { select: { titleBg: true } } } },
        },
      },
    },
  });
}
