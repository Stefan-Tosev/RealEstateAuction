import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/*
 * Bidder approval and deposit recording, and the thing they exist for:
 * opening the two gates that currently refuse every bid.
 *
 * The chain matters more than either screen — an operator approves, an
 * operator records money, and only then does placeBid stop saying no.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const PREFIX = "pw-bidder-";
const BIDDER_EMAIL = `${PREFIX}one@example.bg`;
const UNVERIFIED_EMAIL = `${PREFIX}unverified@example.bg`;
const PASSWORD = "granite harbour lantern fold";

let lotId = "";
let bidderId = "";

async function cleanup() {
  await prisma.$executeRawUnsafe("ALTER TABLE bids DISABLE TRIGGER bids_append_only");
  try {
    await prisma.bid.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  } finally {
    await prisma.$executeRawUnsafe("ALTER TABLE bids ENABLE TRIGGER bids_append_only");
  }
  await prisma.deposit.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  // Sales before users: sales_user_id_fkey is RESTRICT, so a completion
  // in progress will not vanish with a deleted account.
  await prisma.sale.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.bidderApproval.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.outbox.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

async function signInAsOperator(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel("Password").fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
}

test.beforeAll(async () => {
  await cleanup();

  const argon2 = await import("@node-rs/argon2");
  const passwordHash = await argon2.hash(PASSWORD, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const base = {
    passwordHash,
    firstName: "Иван",
    lastName: "Петров",
    dateOfBirth: new Date("1990-01-01"),
    accountType: "individual" as const,
  };

  const bidder = await prisma.user.create({
    data: { ...base, email: BIDDER_EMAIL, emailVerifiedAt: new Date() },
    select: { id: true },
  });
  bidderId = bidder.id;

  await prisma.user.create({
    data: { ...base, email: UNVERIFIED_EMAIL, lastName: "Непотвърден" },
  });

  // A lot that requires a deposit, so both gates are in play.
  const lot = await prisma.lot.findFirstOrThrow({
    where: { property: { slug: "dvustaen-karshiyaka-plovdiv" } },
    orderBy: { lotNumber: "desc" },
  });
  lotId = lot.id;
  await prisma.lot.update({
    where: { id: lotId },
    data: { depositRequiredMinor: 500_000n },
  });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.lot.update({ where: { id: lotId }, data: { depositRequiredMinor: null } });
  await prisma.$disconnect();
});

test.describe("the bidders screen", () => {
  test("lists registered bidders with their status", async ({ page }) => {
    await signInAsOperator(page);
    await page.goto("/admin/bidders");

    await expect(page.getByRole("heading", { name: "Bidders" })).toBeVisible();
    await expect(page.getByText(BIDDER_EMAIL)).toBeVisible();
    await expect(page.getByText(UNVERIFIED_EMAIL)).toBeVisible();
  });

  test("will not let an unconfirmed address be approved", async ({ page }) => {
    /*
     * Approval is what lets someone commit to a five-figure purchase.
     * Resting that on an address nobody has proven they control is the
     * wrong order, so the button is disabled and the server refuses too.
     */
    await signInAsOperator(page);
    await page.goto("/admin/bidders");

    const row = page.locator("tr", { hasText: UNVERIFIED_EMAIL });
    await expect(row.getByText("email unconfirmed")).toBeVisible();
    await expect(row.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  test("approves a bidder, with the note and reviewer recorded", async ({ page }) => {
    await signInAsOperator(page);
    await page.goto("/admin/bidders");

    const row = page.locator("tr", { hasText: BIDDER_EMAIL });
    await row.getByRole("textbox").fill("ID checked in person");
    await row.getByRole("button", { name: "Approve" }).click();

    await expect(page.getByText("Bidder approved.")).toBeVisible();

    const approval = await prisma.bidderApproval.findFirstOrThrow({
      where: { userId: bidderId },
      orderBy: { createdAt: "desc" },
    });
    expect(approval.status).toBe("approved");
    expect(approval.notes).toBe("ID checked in person");
    // Who decided, and when — what an AML audit asks for.
    expect(approval.reviewedBy).not.toBeNull();
    expect(approval.reviewedAt).not.toBeNull();
  });

  test("keeps the decision history rather than overwriting it", async ({ page }) => {
    /*
     * §7 puts KYC records under a five-year retention that overrides
     * erasure, so a later decision must not erase an earlier one.
     */
    await signInAsOperator(page);
    await page.goto("/admin/bidders");

    const row = page.locator("tr", { hasText: BIDDER_EMAIL });
    await row.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText("Bidder rejected.")).toBeVisible();

    const all = await prisma.bidderApproval.findMany({ where: { userId: bidderId } });
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.some((a) => a.status === "approved")).toBe(true);
    expect(all.some((a) => a.status === "rejected")).toBe(true);
  });
});

test.describe("deposits", () => {
  test("says plainly that the lot requires one", async ({ page }) => {
    await signInAsOperator(page);
    await page.goto(`/admin/lots/${lotId}`);

    await expect(page.getByText(/A bidder with no deposit held cannot bid/i)).toBeVisible();
    await expect(page.getByText("No deposits recorded.")).toBeVisible();
  });

  test("records money as received", async ({ page }) => {
    await signInAsOperator(page);
    await page.goto(`/admin/lots/${lotId}`);

    await page.getByLabel("Bidder").selectOption(bidderId);
    await page.getByLabel("Amount received (EUR)").fill("5000");
    await page.getByLabel("How it was paid").selectOption("sepa");
    await page.getByLabel("Bank reference (optional)").fill("REF-2026-0042");
    await page.getByRole("button", { name: "Record deposit as received" }).click();

    await expect(page.getByText("Deposit recorded.")).toBeVisible();

    const deposit = await prisma.deposit.findFirstOrThrow({ where: { userId: bidderId, lotId } });
    // Euros in, minor units stored.
    expect(deposit.amountMinor).toBe(500_000n);
    // Recorded as held: an operator adds this only once money arrived.
    expect(deposit.status).toBe("held");
    expect(deposit.providerRef).toBe("REF-2026-0042");
  });

  test("hides the form when there is nobody left to record one for", async ({ page }) => {
    await signInAsOperator(page);
    await page.goto(`/admin/lots/${lotId}`);

    // The only approved bidder now has a deposit on this lot, so the
    // form would offer an empty choice. Saying why beats an empty select.
    await expect(page.getByText(/No approved bidder is without a deposit/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Record deposit as received" }),
    ).toHaveCount(0);
  });

  test("tells the bidder their deposit arrived", async () => {
    const queued = await prisma.outbox.findMany({ where: { userId: bidderId } });
    expect(queued.map((o) => o.template)).toContain("deposit_received");
  });
});

test.describe("the gates open", () => {
  test("the state the bid gates require now exists", async () => {
    /*
     * The point of both screens. Before them placeBid refused every
     * attempt — NOT_APPROVED, then NO_DEPOSIT — and nothing in a browser
     * could change that.
     *
     * This asserts the state, not the bid: placeBid imports through the
     * "@/" alias, which Playwright's loader does not resolve, and the
     * accepted path is already covered deterministically in
     * tests/unit/bidding.test.ts ("allows the bid once a deposit is
     * held"). Duplicating it here would add a second, weaker copy.
     */
    await prisma.bidderApproval.create({ data: { userId: bidderId, status: "approved" } });

    const approvals = await prisma.bidderApproval.count({
      where: { userId: bidderId, status: "approved" },
    });
    const held = await prisma.deposit.count({
      where: { userId: bidderId, lotId, status: "held" },
    });

    // Exactly the two counts the gates in place-bid.ts read.
    expect(approvals).toBeGreaterThan(0);
    expect(held).toBe(1);
  });
});

test.describe("the post-auction negotiation window", () => {
  /*
   * RESERVE_NOT_MET used to have no onward transition at all, so the lot
   * with a verified buyer and money already down was the one ending an
   * operator could do nothing about. This drives the screen that fixed it.
   */
  const FIXTURE_LOT_NUMBER = 900_001;
  let negotiationLotId = "";

  /*
   * Removing this fixture is three tables in a particular order, so it
   * lives in one function that both beforeAll and afterAll call. A run
   * that fails partway otherwise leaves the lot behind, and the next run
   * dies on the lot_number unique constraint rather than on whatever
   * actually broke.
   */
  async function removeFixtureLot() {
    const existing = await prisma.lot.findMany({
      where: { lotNumber: FIXTURE_LOT_NUMBER },
      select: { id: true },
    });

    for (const { id } of existing) {
      // Accepting a negotiation opens a sale, which holds the lot.
      await prisma.sale.deleteMany({ where: { lotId: id } });
      await prisma.fee.deleteMany({ where: { lotId: id } });
      await prisma.deposit.deleteMany({ where: { lotId: id } });
      await prisma.auditLog.deleteMany({ where: { entityId: id } });

      // winningBidId points at the bid, so it has to let go first — and
      // bids are append-only by trigger, which only test data may bypass.
      await prisma.lot.update({ where: { id }, data: { winningBidId: null } });
      await prisma.$executeRawUnsafe("ALTER TABLE bids DISABLE TRIGGER bids_append_only");
      try {
        await prisma.bid.deleteMany({ where: { lotId: id } });
      } finally {
        await prisma.$executeRawUnsafe("ALTER TABLE bids ENABLE TRIGGER bids_append_only");
      }

      await prisma.lot.delete({ where: { id } });
    }
  }

  test.beforeAll(async () => {
    await removeFixtureLot();

    // Its own lot: the shared one carries the deposit assertions above.
    const property = await prisma.property.findFirstOrThrow({
      where: { slug: "kashta-stariya-grad-plovdiv" },
      select: { id: true },
    });

    const lot = await prisma.lot.create({
      data: {
        propertyId: property.id,
        lotNumber: FIXTURE_LOT_NUMBER,
        status: "RESERVE_NOT_MET",
        startingPriceMinor: 10_000_000n,
        reservePriceMinor: 20_000_000n,
        biddingOpensAt: new Date(Date.now() - 172_800_000),
        scheduledCloseAt: new Date(Date.now() - 3600_000),
        effectiveCloseAt: new Date(Date.now() - 3600_000),
        closedAt: new Date(Date.now() - 3600_000),
        negotiationEndsAt: new Date(Date.now() + 47 * 3600_000),
      },
      select: { id: true },
    });
    negotiationLotId = lot.id;

    /*
     * A real bid, because the panel's whole subject is the gap between
     * what was bid and what the seller wanted. A lot in RESERVE_NOT_MET
     * with no bid cannot exist — closeLot writes CLOSED_UNSOLD instead.
     */
    const bid = await prisma.bid.create({
      data: {
        lotId: negotiationLotId,
        userId: bidderId,
        amountMinor: 10_000_000n,
        status: "accepted",
        idempotencyKey: `negotiation-fixture-${Date.now()}`,
      },
      select: { id: true },
    });
    await prisma.lot.update({
      where: { id: negotiationLotId },
      data: { winningBidId: bid.id },
    });

    await prisma.deposit.create({
      data: {
        userId: bidderId,
        lotId: negotiationLotId,
        amountMinor: 500_000n,
        status: "held",
        method: "sepa",
      },
    });
  });

  test.afterAll(async () => {
    await removeFixtureLot();
  });

  test("shows the gap the seller has to be talked across", async ({ page }) => {
    await signInAsOperator(page);
    await page.goto(`/admin/lots/${negotiationLotId}`);

    await expect(page.getByRole("heading", { name: "Reserve not met" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Top bid/ })).toContainText("€100,000");
    await expect(page.getByRole("row", { name: /Reserve/ })).toContainText("€200,000");
    // The number the conversation is actually about.
    await expect(page.getByRole("row", { name: /Short by/ })).toContainText("€100,000");
  });

  test("sells at the top bid when the seller accepts, and tells the buyer", async ({ page }) => {
    await signInAsOperator(page);
    await page.goto(`/admin/lots/${negotiationLotId}`);

    await page.getByLabel("What the seller said").fill("Agreed by phone at 14:20");
    await page.getByRole("button", { name: /Seller accepts/ }).click();

    /*
     * The panel unmounts the moment the status changes, so the
     * confirmation cannot be a message inside it. What the operator sees
     * instead is read back out of the lot, and is still there tomorrow.
     */
    await expect(page.getByText(/Sold at €100,000 after negotiation/)).toBeVisible();

    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: negotiationLotId } });
    expect(lot.status).toBe("CLOSED_SOLD");
    // Left as the seller originally agreed it — the gap is the evidence
    // a negotiation happened.
    expect(lot.reservePriceMinor).toBe(20_000_000n);
    expect(lot.negotiationEndsAt).toBeNull();

    // Who concluded it and what they said. This is the record that a
    // sale below the agreed reserve was authorised.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: negotiationLotId, action: "lot.negotiationAccepted" },
    });
    expect(audit.actorUserId).not.toBeNull();
    expect(JSON.stringify(audit.after)).toContain("Agreed by phone at 14:20");
  });

  test("the outcome survives a reload; the decision form does not", async ({ page }) => {
    await signInAsOperator(page);
    await page.goto(`/admin/lots/${negotiationLotId}`);

    await expect(page.getByRole("heading", { name: "Reserve not met" })).toHaveCount(0);
    await expect(page.getByText(/Sold at €100,000 after negotiation/)).toBeVisible();
    // Concluded once and only once — a second accept would release a
    // deposit the sale is relying on.
    await expect(page.getByRole("button", { name: /Seller accepts/ })).toHaveCount(0);
  });
});
