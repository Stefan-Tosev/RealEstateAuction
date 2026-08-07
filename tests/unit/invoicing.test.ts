import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  InvoiceRefused,
  cancelInvoice,
  getInvoice,
  markInvoicePaid,
  raiseInvoice,
} from "@/server/fees/invoice";
import { DEMO_ISSUER, invoiceSeries, issuer, issuerBlockers, isDemoIssuer } from "@/server/fees/issuer";
import { isValidEik } from "@/server/identity/validators";

/*
 * Invoicing.
 *
 * The part worth testing hardest is the number. Bulgarian фактури are
 * numbered consecutively, and a gap is not a cosmetic problem — it is
 * the thing an auditor asks about, and "a database transaction failed"
 * is not an answer.
 */

const prisma = new PrismaClient();
const PREFIX = "vitest-invoice-";

let actor: { id: string; email: string; role: "admin" };
let sellerId = "";
/*
 * Tracked by id, not matched by name.
 *
 * One test below renames the seller — that is the point of it, proving
 * an invoice keeps the details it was issued with. A cleanup filtering on
 * `name startsWith PREFIX` then misses the row entirely, which is how
 * this suite started leaving sellers and invoices behind. Cleanup keyed
 * on a field a test mutates is fragile by construction.
 */
const createdSellerIds: string[] = [];
let lotId = "";
let propertyId = "";

async function cleanup() {
  const sellerIds = [...createdSellerIds];

  await prisma.fee.deleteMany({ where: { lot: { property: { slug: PREFIX + "prop" } } } });
  await prisma.fee.deleteMany({ where: { sellerId: { in: sellerIds } } });
  await prisma.invoice.deleteMany({ where: { sellerId: { in: sellerIds } } });
  await prisma.lot.deleteMany({ where: { property: { slug: PREFIX + "prop" } } });
  await prisma.property.deleteMany({ where: { slug: PREFIX + "prop" } });
  await prisma.property.deleteMany({ where: { sellerId: { in: sellerIds } } });
  await prisma.seller.deleteMany({ where: { id: { in: sellerIds } } });
  // Belt and braces for anything created before ids were tracked.
  await prisma.seller.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { entityType: "invoice" } });
}

beforeEach(async () => {
  /*
   * Reset before every test. These are process-wide, and a test that
   * flips demo mode would otherwise decide the outcome of whichever ran
   * next — which is how a suite starts passing or failing on ordering.
   */
  process.env.INVOICE_DEMO_MODE = "false";
  process.env.INVOICE_ISSUER_NAME = "Auction House EOOD";
  process.env.INVOICE_ISSUER_EIK = "831641791";
  process.env.INVOICE_ISSUER_ADDRESS = "ул. Тестова 1, София";
  process.env.INVOICE_ISSUER_IBAN = "BG00TEST00000000000000";

  await cleanup();

  const admin = await prisma.adminUser.findFirstOrThrow({ select: { id: true, email: true } });
  actor = { id: admin.id, email: admin.email, role: "admin" };

  const seller = await prisma.seller.create({
    data: {
      name: `${PREFIX}Продавач ООД`,
      kind: "company",
      eik: "831641791",
      address: "ул. Първа 1, Пловдив",
    },
    select: { id: true },
  });
  sellerId = seller.id;
  createdSellerIds.push(seller.id);

  const property = await prisma.property.create({
    data: {
      slug: PREFIX + "prop",
      sellerId,
      titleBg: "Тестов имот",
      titleEn: "Test property",
      descriptionBg: "—",
      descriptionEn: "—",
      address: "ул. Тестова 1",
      city: "София",
      region: "София",
      propertyType: "apartment",
    },
    select: { id: true },
  });
  propertyId = property.id;

  const lot = await prisma.lot.create({
    data: {
      propertyId,
      lotNumber: 990_001,
      status: "CLOSED_SOLD",
      startingPriceMinor: 10_000_000n,
      reservePriceMinor: 10_000_000n,
    },
    select: { id: true },
  });
  lotId = lot.id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/** A seller fee that is due. */
async function dueFee(kind: "entry" | "commission", netMinor: bigint, vatMinor: bigint) {
  await prisma.fee.create({
    data: {
      lotId,
      sellerId,
      party: "seller",
      kind,
      basis: kind === "entry" ? "fixed" : "percent",
      netMinor,
      vatMinor,
      vatRate: "0.2000",
    },
  });
}

describe("invoice numbers", () => {
  it("are consecutive", async () => {
    await dueFee("entry", 30_000n, 6_000n);
    const first = await raiseInvoice(actor, lotId, "seller");

    await dueFee("commission", 250_000n, 50_000n);
    const second = await raiseInvoice(actor, lotId, "seller");

    expect(Number(second.number)).toBe(Number(first.number) + 1);
    // Ten digits, zero padded — the Bulgarian convention.
    expect(first.number).toMatch(/^\d{10}$/);
  });

  it("are NOT burned by a failed attempt", async () => {
    /*
     * The reason the counter is a locked row and not a Postgres sequence.
     * nextval() survives a rollback, so an aborted transaction would
     * consume a number nobody can account for — and a gap in the
     * numbering is exactly what an auditor asks about.
     */
    await dueFee("entry", 30_000n, 6_000n);
    const first = await raiseInvoice(actor, lotId, "seller");

    // Nothing due now, so this throws INSIDE the transaction.
    await expect(raiseInvoice(actor, lotId, "seller")).rejects.toThrow(InvoiceRefused);

    await dueFee("commission", 250_000n, 50_000n);
    const next = await raiseInvoice(actor, lotId, "seller");

    expect(Number(next.number)).toBe(Number(first.number) + 1);
  });

  it("stay used when an invoice is cancelled", async () => {
    // A cancelled invoice is part of the record. Reusing its number, or
    // deleting the row, would put the hole back.
    await dueFee("entry", 30_000n, 6_000n);
    const first = await raiseInvoice(actor, lotId, "seller");

    await cancelInvoice(actor, first.id, "Raised against the wrong lot");
    const again = await raiseInvoice(actor, lotId, "seller");

    expect(again.number).not.toBe(first.number);
    expect(Number(again.number)).toBe(Number(first.number) + 1);
  });
});

describe("what gets billed", () => {
  it("covers every due fee for that party on one document", async () => {
    // A seller's entry fee and commission belong on one piece of paper.
    await dueFee("entry", 30_000n, 6_000n);
    await dueFee("commission", 250_000n, 50_000n);

    const raised = await raiseInvoice(actor, lotId, "seller");
    const invoice = await getInvoice(raised.id);

    expect(invoice!.fees).toHaveLength(2);
    expect(invoice!.netMinor).toBe(280_000n);
    expect(invoice!.vatMinor).toBe(56_000n);
  });

  it("never bills the same fee twice", async () => {
    /*
     * The failure that costs somebody real money and real trust: an
     * already-invoiced fee appearing on a second document.
     */
    await dueFee("entry", 30_000n, 6_000n);
    await raiseInvoice(actor, lotId, "seller");

    await expect(raiseInvoice(actor, lotId, "seller")).rejects.toThrow(/nothing due/i);
  });

  it("copies the party's details rather than joining them later", async () => {
    /*
     * An invoice records what was billed on a date. If the seller moves
     * house, the document already sent must not silently change.
     */
    await dueFee("entry", 30_000n, 6_000n);
    const raised = await raiseInvoice(actor, lotId, "seller");

    await prisma.seller.update({
      where: { id: sellerId },
      data: { name: "Съвсем друго име", address: "друг адрес" },
    });

    const invoice = await getInvoice(raised.id);
    expect(invoice!.billedName).toContain("Продавач");
    expect(invoice!.billedAddress).toBe("ул. Първа 1, Пловдив");
    expect(invoice!.billedEik).toBe("831641791");
  });
});

describe("the lifecycle", () => {
  it("moves the fees along with the invoice", async () => {
    await dueFee("entry", 30_000n, 6_000n);
    const raised = await raiseInvoice(actor, lotId, "seller");

    let fees = await prisma.fee.findMany({ where: { lotId } });
    expect(fees.every((fee) => fee.status === "invoiced")).toBe(true);

    await markInvoicePaid(actor, raised.id);

    fees = await prisma.fee.findMany({ where: { lotId } });
    expect(fees.every((fee) => fee.status === "paid")).toBe(true);
  });

  it("returns the fees to due when an invoice is cancelled", async () => {
    await dueFee("entry", 30_000n, 6_000n);
    const raised = await raiseInvoice(actor, lotId, "seller");

    await cancelInvoice(actor, raised.id, "Wrong party");

    const fees = await prisma.fee.findMany({ where: { lotId } });
    expect(fees.every((fee) => fee.status === "due")).toBe(true);
    expect(fees.every((fee) => fee.invoiceId === null)).toBe(true);
  });

  it("refuses to cancel an invoice that has been paid", async () => {
    await dueFee("entry", 30_000n, 6_000n);
    const raised = await raiseInvoice(actor, lotId, "seller");
    await markInvoicePaid(actor, raised.id);

    await expect(cancelInvoice(actor, raised.id, "changed my mind")).rejects.toThrow(/paid/i);
  });

  it("records who marked it paid", async () => {
    await dueFee("entry", 30_000n, 6_000n);
    const raised = await raiseInvoice(actor, lotId, "seller");
    await markInvoicePaid(actor, raised.id);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: raised.id, action: "invoice.paid" },
    });
    expect(audit.actorUserId).toBe(actor.id);
  });
});

describe("the auction house's own details", () => {
  it("refuses to issue anything without them", async () => {
    // Demo mode fills the gaps on purpose, so it has to be off to see
    // the refusal at all.
    process.env.INVOICE_DEMO_MODE = "false";
    /*
     * An invoice missing the issuer's ЕИК is not a defective invoice, it
     * is not an invoice — and one already sent cannot be unsent.
     */
    const saved = process.env.INVOICE_ISSUER_EIK;
    process.env.INVOICE_ISSUER_EIK = "";

    try {
      expect(issuerBlockers()).toContain("ЕИК (INVOICE_ISSUER_EIK)");
      await dueFee("entry", 30_000n, 6_000n);
      await expect(raiseInvoice(actor, lotId, "seller")).rejects.toThrow(/not configured/i);
    } finally {
      process.env.INVOICE_ISSUER_EIK = saved;
    }
  });

  it("does not require a ДДС number, which a small business will not have", () => {
    process.env.INVOICE_DEMO_MODE = "false";
    const saved = process.env.INVOICE_ISSUER_VAT;
    process.env.INVOICE_ISSUER_VAT = "";
    try {
      expect(issuerBlockers()).toEqual([]);
    } finally {
      process.env.INVOICE_ISSUER_VAT = saved;
    }
  });
});

describe("demo mode", () => {
  /*
   * So invoicing can be exercised end to end before the company exists.
   * The safeguards matter more than the convenience: a demo document
   * that reads as real, or that quietly consumes real invoice numbers,
   * is worse than no demo at all.
   */
  const enable = () => {
    process.env.INVOICE_DEMO_MODE = "true";
    for (const key of [
      "INVOICE_ISSUER_NAME",
      "INVOICE_ISSUER_EIK",
      "INVOICE_ISSUER_ADDRESS",
      "INVOICE_ISSUER_IBAN",
    ]) {
      process.env[key] = "";
    }
  };

  it("uses an ЕИК that could never be a real company", () => {
    /*
     * The reason these are constants rather than generated. Any nine
     * digits with a VALID check digit stand a fair chance of belonging to
     * a real registered company, and putting somebody else's number on a
     * document is not a hypothetical harm.
     */
    expect(isValidEik(DEMO_ISSUER.eik)).toBe(false);
    expect(DEMO_ISSUER.name).toMatch(/DEMO/);
    expect(DEMO_ISSUER.iban).toMatch(/DEMO/);
    // No ДДС number invented at all — an unregistered business has none.
    expect(DEMO_ISSUER.vat).toBe("");
  });

  it("lets an invoice be raised with nothing configured", () => {
    enable();
    expect(issuerBlockers()).toEqual([]);
    expect(issuer().name).toBe(DEMO_ISSUER.name);
  });

  it("numbers demo invoices in their own series", () => {
    /*
     * The consequence that actually matters. Sharing a series would mean
     * the first REAL invoice is 0000000021, with 1 to 20 existing nowhere
     * in the accounts — a gap manufactured on purpose by the demo.
     */
    enable();
    expect(invoiceSeries(new Date("2026-08-07"))).toBe("DEMO-2026");

    process.env.INVOICE_DEMO_MODE = "false";
    expect(invoiceSeries(new Date("2026-08-07"))).toBe("2026");
  });

  it("still prefers a real value once one is supplied", () => {
    // So the switch to real details can be made one field at a time.
    enable();
    process.env.INVOICE_ISSUER_NAME = "Auction House EOOD";
    expect(issuer().name).toBe("Auction House EOOD");
    expect(issuer().eik).toBe(DEMO_ISSUER.eik);
  });
});
