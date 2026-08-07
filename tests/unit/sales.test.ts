import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  balanceMinor,
  getSale,
  isOverdue,
  openSale,
  recordDefault,
  recordMilestone,
  saleStatus,
} from "@/server/sales/sale";

/*
 * The sale that follows a winning bid — the gap between "you won" and the
 * keys.
 *
 * The parts worth testing hardest are the ones where money moves: the
 * deposit coming off the price, and what happens to it when a sale
 * completes versus when a buyer walks away.
 */

const prisma = new PrismaClient();
const PREFIX = "vitest-sale-";

let actor: { id: string; email: string; role: "admin" };
let buyerId = "";
let lotId = "";

async function cleanup() {
  await prisma.sale.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.deposit.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.outbox.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.auditLog.deleteMany({ where: { entityType: "sale" } });
  await prisma.lot.deleteMany({ where: { property: { slug: PREFIX + "prop" } } });
  await prisma.property.deleteMany({ where: { slug: PREFIX + "prop" } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();

  const admin = await prisma.adminUser.findFirstOrThrow({ select: { id: true, email: true } });
  actor = { id: admin.id, email: admin.email, role: "admin" };

  const buyer = await prisma.user.create({
    data: {
      email: `${PREFIX}buyer@example.bg`,
      passwordHash: "not-used",
      firstName: "Мария",
      lastName: "Иванова",
      dateOfBirth: new Date("1988-04-11"),
      accountType: "individual",
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  buyerId = buyer.id;

  const property = await prisma.property.create({
    data: {
      slug: PREFIX + "prop",
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

  const lot = await prisma.lot.create({
    data: {
      propertyId: property.id,
      lotNumber: 970_001,
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

async function heldDeposit(amountMinor: bigint) {
  await prisma.deposit.create({
    data: { userId: buyerId, lotId, amountMinor, status: "held", method: "sepa" },
  });
}

describe("status is derived, not stored", () => {
  /*
   * A status column somebody has to remember to advance drifts from the
   * facts. These are the facts.
   */
  it("reads the milestones in order", () => {
    const none = { contractSignedAt: null, balancePaidAt: null, completedAt: null, defaultedAt: null };
    expect(saleStatus(none)).toBe("awaiting-contract");
    expect(saleStatus({ ...none, contractSignedAt: new Date() })).toBe("awaiting-balance");
    expect(saleStatus({ ...none, contractSignedAt: new Date(), balancePaidAt: new Date() })).toBe(
      "awaiting-completion",
    );
  });

  it("lets a terminal outcome win over the milestones behind it", () => {
    // A defaulted sale with a signed contract is defaulted, not
    // "awaiting balance" — the outcome is the answer.
    const signed = { contractSignedAt: new Date(), balancePaidAt: null, completedAt: null };
    expect(saleStatus({ ...signed, defaultedAt: new Date() })).toBe("defaulted");
    expect(saleStatus({ ...signed, completedAt: new Date(), defaultedAt: null })).toBe("completed");
  });

  it("counts a sale overdue only while it is still open", () => {
    const past = new Date(Date.now() - 86_400_000);
    const open = { contractSignedAt: null, balancePaidAt: null, completedAt: null, defaultedAt: null };

    expect(isOverdue({ ...open, completionDueAt: past })).toBe(true);
    // Finished either way is not overdue — nobody needs chasing.
    expect(isOverdue({ ...open, completionDueAt: past, completedAt: new Date() })).toBe(false);
    expect(isOverdue({ ...open, completionDueAt: past, defaultedAt: new Date() })).toBe(false);
  });
});

describe("the deposit comes off the price", () => {
  it("is what the balance means", () => {
    // That is what the deposit was taken for.
    expect(balanceMinor(34_500_000n, 500_000n)).toBe(34_000_000n);
  });

  it("never goes negative", () => {
    // A deposit larger than the hammer should not produce a refund the
    // sale process would have to reason about.
    expect(balanceMinor(100_000n, 500_000n)).toBe(0n);
  });

  it("counts only deposits still held", async () => {
    // A released deposit is gone; treating it as paid would understate
    // what the buyer still owes.
    await heldDeposit(500_000n);
    await prisma.deposit.create({
      data: { userId: buyerId, lotId, amountMinor: 900_000n, status: "released", method: "sepa" },
    });

    await openSale(lotId, buyerId, 34_500_000n);

    const sale = await prisma.sale.findUniqueOrThrow({ where: { lotId } });
    expect(sale.depositMinor).toBe(500_000n);
  });
});

describe("opening a sale", () => {
  it("tells the buyer the number, the deadline, and that the deposit counts", async () => {
    await heldDeposit(500_000n);
    await openSale(lotId, buyerId, 34_500_000n);

    const message = await prisma.outbox.findFirstOrThrow({
      where: { userId: buyerId, template: "sale_next_steps" },
    });
    const payload = message.payload as Record<string, string>;

    expect(payload.balanceMinor).toBe("34000000");
    expect(payload.depositMinor).toBe("500000");
    expect(payload.completionDueAtIso).toBeTruthy();
  });

  it("does not open a second sale when a close runs twice", async () => {
    /*
     * Two sales on one lot would mean the property sold twice. Guarded
     * by the unique constraint rather than by checking first.
     */
    expect(await openSale(lotId, buyerId, 34_500_000n)).toBe(true);
    expect(await openSale(lotId, buyerId, 34_500_000n)).toBe(false);

    expect(await prisma.sale.count({ where: { lotId } })).toBe(1);
  });
});

describe("completion", () => {
  it("settles the deposit rather than releasing it", async () => {
    /*
     * "Released" means given back because nothing happened. On a
     * completed sale the money did its job and went toward the price,
     * which is a different fact and worth recording as one.
     */
    await heldDeposit(500_000n);
    await openSale(lotId, buyerId, 34_500_000n);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { lotId } });

    await recordMilestone(actor, sale.id, "completed", new Date(), null);

    const deposit = await prisma.deposit.findFirstOrThrow({ where: { lotId, userId: buyerId } });
    expect(deposit.status).toBe("refunded");

    const after = await getSale(sale.id);
    expect(after!.status).toBe("completed");
  });

  it("records the date it happened, not the date it was typed in", async () => {
    /*
     * These are entered after the fact — the deed was signed on Tuesday
     * and somebody records it on Thursday. Defaulting to today would put
     * the wrong date on the document a dispute turns on.
     */
    await openSale(lotId, buyerId, 34_500_000n);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { lotId } });

    const tuesday = new Date("2026-08-04T10:00:00Z");
    await recordMilestone(actor, sale.id, "contract", tuesday, "Signed at the notary");

    const after = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(after.contractSignedAt?.toISOString()).toBe(tuesday.toISOString());
  });

  it("accepts milestones out of order", async () => {
    /*
     * Deliberately not a state machine. An operator catching up on a sale
     * that completed last week must be able to record the contract after
     * the completion, and a system that argues gets worked around in a
     * spreadsheet.
     */
    await openSale(lotId, buyerId, 34_500_000n);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { lotId } });

    await recordMilestone(actor, sale.id, "completed", new Date(), null);
    await expect(
      recordMilestone(actor, sale.id, "contract", new Date(), null),
    ).resolves.not.toThrow();
  });
});

describe("default", () => {
  it("forfeits the deposit and records why", async () => {
    await heldDeposit(500_000n);
    await openSale(lotId, buyerId, 34_500_000n);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { lotId } });

    await recordDefault(actor, sale.id, "No contact after three written reminders");

    const deposit = await prisma.deposit.findFirstOrThrow({ where: { lotId, userId: buyerId } });
    expect(deposit.status).toBe("forfeited");

    const after = await getSale(sale.id);
    expect(after!.status).toBe("defaulted");
    expect(after!.notes).toContain("three written reminders");

    // Forfeiting somebody's five figures needs a name against it.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: sale.id, action: "sale.defaulted" },
    });
    expect(audit.actorUserId).toBe(actor.id);
  });

  it("refuses to default a sale that has completed", async () => {
    await heldDeposit(500_000n);
    await openSale(lotId, buyerId, 34_500_000n);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { lotId } });

    await recordMilestone(actor, sale.id, "completed", new Date(), null);

    await expect(recordDefault(actor, sale.id, "changed my mind")).rejects.toThrow(/completed/i);
  });

  it("refuses further milestones once defaulted", async () => {
    // The deposit is gone. Recording progress afterwards would produce a
    // sale that looks alive with no money behind it.
    await openSale(lotId, buyerId, 34_500_000n);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { lotId } });

    await recordDefault(actor, sale.id, "walked away");

    await expect(
      recordMilestone(actor, sale.id, "contract", new Date(), null),
    ).rejects.toThrow(/defaulted/i);
  });
});
