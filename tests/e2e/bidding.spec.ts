import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient, type LotStatus } from "@prisma/client";

/*
 * Bidding from the browser, and the worker that closes lots.
 *
 * The engine itself is covered by unit tests against a real database;
 * what is only testable here is the chain — that the panel shows the
 * right state to each kind of viewer, that a bid placed through the form
 * actually lands, that a repeat submission does not become a second bid,
 * and that identities stay out of the public history.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const SLUG = "tristaen-lozenets-sofia";
const PREVIEW_SLUG = "mezonet-more-varna";
const PREFIX = "pw-bid-";
const APPROVED_EMAIL = `${PREFIX}approved@example.bg`;
const PENDING_EMAIL = `${PREFIX}pending@example.bg`;
const PASSWORD = "granite harbour lantern fold";

let lotId = "";
let approvedId = "";
/** Restored in afterAll so the seeded catalogue is left as it was found. */
let originalCloseAt: Date | null = null;
/*
 * The worker tests close whatever is genuinely due, which can include a
 * seeded lot that aged past its clock. Snapshotting every lot and putting
 * them back is the only way this spec can promise it leaves the catalogue
 * as it found it — other specs assert on how many lots are listable.
 */
let lotSnapshot: { id: string; status: LotStatus; closedAt: Date | null }[] = [];

async function cleanup() {
  // Bids are append-only by database trigger — the guarantee the whole
  // audit trail rests on. Test data is the one thing allowed past it.
  await prisma.$executeRawUnsafe("ALTER TABLE bids DISABLE TRIGGER bids_append_only");
  try {
    await prisma.bid.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  } finally {
    await prisma.$executeRawUnsafe("ALTER TABLE bids ENABLE TRIGGER bids_append_only");
  }
  await prisma.bidderApproval.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.outbox.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

async function signIn(page: Page, email: string) {
  await page.goto("/en/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/lots$/);
}

test.beforeAll(async () => {
  await cleanup();

  lotSnapshot = await prisma.lot.findMany({ select: { id: true, status: true, closedAt: true } });

  const argon2 = await import("@node-rs/argon2");
  const passwordHash = await argon2.hash(PASSWORD, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const base = {
    passwordHash,
    firstName: "Мария",
    lastName: "Иванова",
    dateOfBirth: new Date("1988-04-11"),
    accountType: "individual" as const,
    emailVerifiedAt: new Date(),
  };

  const approved = await prisma.user.create({
    data: { ...base, email: APPROVED_EMAIL },
    select: { id: true },
  });
  approvedId = approved.id;
  await prisma.bidderApproval.create({
    data: { userId: approvedId, status: "approved", reviewedAt: new Date() },
  });

  await prisma.user.create({ data: { ...base, email: PENDING_EMAIL, lastName: "Чакаща" } });

  const lot = await prisma.lot.findFirstOrThrow({
    where: { property: { slug: SLUG } },
    orderBy: { lotNumber: "desc" },
    select: { id: true, effectiveCloseAt: true },
  });
  lotId = lot.id;
  originalCloseAt = lot.effectiveCloseAt;

  /*
   * Well clear of the soft-close window, so a bid placed by these tests
   * does not extend the clock and change what the assertions expect.
   */
  await prisma.lot.update({
    where: { id: lotId },
    data: {
      status: "BIDDING_OPEN",
      depositRequiredMinor: null,
      effectiveCloseAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    },
  });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.lot.update({
    where: { id: lotId },
    data: { status: "BIDDING_OPEN", effectiveCloseAt: originalCloseAt },
  });

  /*
   * Only the lots the worker actually moved. Rewriting every row would
   * also clear winningBidId on lots that legitimately have one, which is
   * a worse mess than the one this is cleaning up.
   */
  const now = await prisma.lot.findMany({ select: { id: true, status: true } });
  const statusNow = new Map(now.map((lot) => [lot.id, lot.status]));
  for (const lot of lotSnapshot) {
    if (statusNow.get(lot.id) === lot.status) continue;
    await prisma.lot.update({
      where: { id: lot.id },
      // The winning bid pointed at a bid the cleanup above removed.
      data: { status: lot.status, closedAt: lot.closedAt, winningBidId: null },
    });
  }

  await prisma.$disconnect();
});

test.describe("what the panel offers each viewer", () => {
  test("asks an anonymous visitor to sign in, and shows no form", async ({ page }) => {
    await page.goto(`/en/lots/${SLUG}`);

    await expect(page.getByRole("link", { name: "Sign in to bid" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Place bid" })).toHaveCount(0);
  });

  test("tells an unapproved bidder what is missing, not just 'no'", async ({ page }) => {
    await signIn(page, PENDING_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    await expect(page.getByText(/awaiting approval/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Place bid" })).toHaveCount(0);
  });

  test("offers nothing to bid on during the preview", async ({ page }) => {
    /*
     * A PUBLISHED lot is a preview — bidding has not opened. The absence
     * of any bid affordance is the point, not an omission.
     */
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${PREVIEW_SLUG}`);

    await expect(page.getByText("Bidding is not open for this lot.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Place bid" })).toHaveCount(0);
  });
});

test.describe("placing a bid", () => {
  test("refuses one below the minimum, and records the refusal", async ({ page }) => {
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    await page.getByLabel("Your bid (EUR)").fill("1");
    await page.getByRole("button", { name: "Place bid" }).click();

    await expect(page.getByText("That bid is below the minimum.")).toBeVisible();

    // §3 invariant: rejected bids are stored too. An audit needs to see
    // what was attempted, not only what succeeded.
    const rejected = await prisma.bid.findFirst({
      where: { lotId, userId: approvedId, status: "rejected" },
    });
    expect(rejected).not.toBeNull();
    expect(rejected!.rejectReason).toBe("TOO_LOW");
  });

  test("accepts a bid at the minimum and counts it", async ({ page }) => {
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    // The form pre-fills the minimum; bidding exactly it proves the
    // floor is inclusive.
    await page.getByRole("button", { name: "Place bid" }).click();

    await expect(page.getByText("Your bid was accepted.")).toBeVisible();
    await expect(page.getByText("1 bid", { exact: false })).toBeVisible();

    const accepted = await prisma.bid.findMany({
      where: { lotId, userId: approvedId, status: "accepted" },
    });
    expect(accepted).toHaveLength(1);
  });

  test("shows the history without saying who bid", async ({ page }) => {
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    await expect(page.getByText("Recent bids")).toBeVisible();
    await expect(page.getByText("Bidder 1")).toBeVisible();

    /*
     * A seller or a rival who can tell who is bidding can approach them
     * directly, which is the disclosure that causes actual harm.
     */
    const html = await page.content();
    expect(html).not.toContain(APPROVED_EMAIL);
    expect(html).not.toContain("Иванова");
  });

  test("does not turn a repeat submission into a second bid", async ({ page }) => {
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    const before = await prisma.bid.count({ where: { lotId, status: "accepted" } });

    /*
     * Two clicks on one rendered form carry the same idempotency key, so
     * the second returns the first bid rather than placing another. This
     * is the failure that costs a bidder real money.
     */
    const button = page.getByRole("button", { name: "Place bid" });
    await button.click({ noWaitAfter: true });
    await button.click({ noWaitAfter: true, force: true }).catch(() => {
      // Fine — React may already have disabled it, which is the same
      // protection by a different route.
    });
    await expect(page.getByText(/accepted|below the minimum/i)).toBeVisible();

    const after = await prisma.bid.count({ where: { lotId, status: "accepted" } });
    expect(after).toBe(before + 1);
  });

  test("still allows a genuine second bid afterwards", async ({ page }) => {
    /*
     * The other half of idempotency, and the easier one to break: a key
     * that never changes would silently replay the first bid forever,
     * and the bidder would watch their raise do nothing.
     */
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    const before = await prisma.bid.count({ where: { lotId, status: "accepted" } });

    await page.getByRole("button", { name: "Place bid" }).click();
    await expect(page.getByText(/Your bid was accepted/)).toBeVisible();

    const after = await prisma.bid.count({ where: { lotId, status: "accepted" } });
    expect(after).toBe(before + 1);
  });

  test("reads an amount typed the Bulgarian way as the amount meant", async ({ page }) => {
    /*
     * The site prints €345,000.50 as "345 000,50 €". Stripping the comma
     * as a group separator — which every parser here used to do — turns
     * that back into €34,500,050, a hundredfold bid that clears every
     * downstream check because it is above the minimum. And a bid binds.
     */
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/bg/lots/${SLUG}`);

    const field = page.getByLabel("Вашата оферта (EUR)");
    const minimumMajor = await field.inputValue();
    const grouped = minimumMajor.replace(/\B(?=(\d{3})+(?!\d))/g, " ");

    await field.fill(`${grouped},50`);
    await page.getByRole("button", { name: "Наддай" }).click();
    await expect(page.getByText("Офертата ви е приета.")).toBeVisible();

    const highest = await prisma.bid.findFirstOrThrow({
      where: { lotId, status: "accepted" },
      orderBy: { amountMinor: "desc" },
      select: { amountMinor: true },
    });
    expect(highest.amountMinor).toBe(BigInt(minimumMajor) * 100n + 50n);
  });

  test("refuses an amount it cannot read rather than guessing", async ({ page }) => {
    await signIn(page, APPROVED_EMAIL);
    await page.goto(`/en/lots/${SLUG}`);

    await page.getByLabel("Your bid (EUR)").fill("three hundred thousand");
    await page.getByRole("button", { name: "Place bid" }).click();

    await expect(page.getByText(/Enter an amount like/)).toBeVisible();
  });

  test("never puts the reserve in the page", async ({ page }) => {
    const lot = await prisma.lot.findUniqueOrThrow({
      where: { id: lotId },
      select: { reservePriceMinor: true },
    });
    await signIn(page, APPROVED_EMAIL);
    const response = await page.goto(`/en/lots/${SLUG}`);
    const body = (await response!.text()) ?? "";

    // Bounded by digit boundaries — a bare substring matches float noise
    // in the dev payload and fails for the wrong reason.
    expect(body).not.toMatch(new RegExp(`(?<!\\d)${lot.reservePriceMinor}(?!\\d)`));
  });
});

test.describe("the closing worker", () => {
  test("is shut to a caller without the secret", async ({ request }) => {
    const anonymous = await request.post("/api/internal/close-lots");
    // 404 rather than 401 — an unauthenticated caller learns nothing.
    expect(anonymous.status()).toBe(404);

    const wrong = await request.post("/api/internal/close-lots", {
      headers: { authorization: "Bearer not-the-secret" },
    });
    expect(wrong.status()).toBe(404);
  });

  test("closes a lot whose clock has run out", async ({ request }) => {
    const draft = await prisma.lot.findFirstOrThrow({
      where: { property: { slug: "partsel-pirin-bansko" } },
      select: { id: true, status: true, effectiveCloseAt: true },
    });

    await prisma.lot.update({
      where: { id: draft.id },
      data: { status: "BIDDING_OPEN", effectiveCloseAt: new Date(Date.now() - 60_000) },
    });

    try {
      const response = await request.post("/api/internal/close-lots", {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
      expect(response.ok()).toBe(true);

      const after = await prisma.lot.findUniqueOrThrow({
        where: { id: draft.id },
        select: { status: true, closedAt: true },
      });
      // No bids were placed on it, so there is nothing to sell.
      expect(after.status).toBe("CLOSED_UNSOLD");
      expect(after.closedAt).not.toBeNull();
    } finally {
      await prisma.lot.update({
        where: { id: draft.id },
        data: { status: draft.status, effectiveCloseAt: draft.effectiveCloseAt, closedAt: null },
      });
    }
  });

  test("leaves a lot alone while its clock is still running", async ({ request }) => {
    const response = await request.post("/api/internal/close-lots", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    expect(response.ok()).toBe(true);

    const lot = await prisma.lot.findUniqueOrThrow({
      where: { id: lotId },
      select: { status: true },
    });
    expect(lot.status).toBe("BIDDING_OPEN");
  });
});
