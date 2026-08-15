import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { formatMoney } from "../../src/lib/money";

/*
 * /admin/live — the operations view for lots that are mid-auction.
 *
 * This page shipped with unit tests for its signal arithmetic and
 * nothing at all for the page itself: the only evidence it rendered was
 * a screenshot taken by hand. That is exactly the gap CLAUDE.md warns
 * about — twice a whole suite was green while a page rendered with no
 * shell at all — so the first assertion here is that the shell exists.
 *
 * The alert states cannot be reached from seeded data, because a lot
 * past its close or 30 minutes past its schedule is by definition not
 * something a healthy seed produces. Those tests mutate the two lots
 * they need and put them back exactly as they found them; the suite runs
 * with workers: 1, so nothing else is reading them meanwhile.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();

/** The seeded lot in EXTENDING: three extensions, fifteen minutes over. */
const EXTENDED_LOT = 13;
/** A seeded lot that is simply open, used for the overdue case. */
const OPEN_LOT = 11;

type Snapshot = {
  id: string;
  extensionCount: number;
  scheduledCloseAt: Date | null;
  effectiveCloseAt: Date | null;
};

const snapshots = new Map<number, Snapshot>();

async function snapshot(lotNumber: number) {
  const lot = await prisma.lot.findFirstOrThrow({
    where: { lotNumber },
    select: { id: true, extensionCount: true, scheduledCloseAt: true, effectiveCloseAt: true },
  });
  snapshots.set(lotNumber, lot);
  return lot;
}

/**
 * Puts a lot back byte for byte.
 *
 * Not a re-seed: that would refresh every relative date in the
 * catalogue, and specs that run afterwards assert on how far away those
 * are. Restoring only what this file touched leaves everything else as
 * it was.
 */
async function restore(lotNumber: number) {
  const before = snapshots.get(lotNumber);
  if (!before) return;

  await prisma.lot.update({
    where: { id: before.id },
    data: {
      extensionCount: before.extensionCount,
      scheduledCloseAt: before.scheduledCloseAt,
      effectiveCloseAt: before.effectiveCloseAt,
    },
  });
}

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel("Password").fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
}

test.beforeAll(async () => {
  await snapshot(EXTENDED_LOT);
  await snapshot(OPEN_LOT);
});

test.afterAll(async () => {
  await restore(EXTENDED_LOT);
  await restore(OPEN_LOT);
  await prisma.$disconnect();
});

test.describe("the live lots page", () => {
  test("renders inside the admin shell, with Live marked as the current section", async ({
    page,
  }) => {
    /*
     * The layout assertion is the point of this test. A page that throws
     * inside the layout still answers 200 with a heading, so asserting
     * content alone is how a shell-less page passed a whole suite twice.
     */
    await signIn(page);
    await page.goto("/admin/live");

    await expect(page.locator(".admin-shell")).toBeVisible();
    await expect(page.locator(".admin-sidebar")).toBeVisible();
    await expect(page.locator(".admin-main")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Live lots" })).toBeVisible();

    const live = page.locator('.admin-nav-link[href="/admin/live"]');
    await expect(live).toHaveAttribute("aria-current", "page");
    // And only this one — the bug the nav component was written to fix
    // highlighted every enabled item at once.
    await expect(page.locator('.admin-nav-link[aria-current="page"]')).toHaveCount(1);
  });

  test("requires a session like every other admin page", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/admin/live");
    await expect(page).toHaveURL(/\/admin\/login/);

    await context.close();
  });

  test("summarises what is open and what is in extension", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/live");

    // Three lots are live in the seeded catalogue; exactly one of them
    // is EXTENDING.
    await expect(page.locator("table.admin-table tbody tr")).toHaveCount(3);
    await expect(page.locator(".hint").first()).toContainText("3");
    await expect(page.locator(".hint").first()).toContainText("1");
    await expect(page.locator('.admin-chip[data-status="EXTENDING"]')).toHaveCount(1);
  });

  test("shows how deep an extension has gone and how far past schedule", async ({ page }) => {
    /*
     * The seed gives lot 13 three extensions at the 300s window, so it
     * sits a quarter of an hour past its published close. Both numbers
     * are the ones an auctioneer is actually looking for.
     */
    await signIn(page);
    await page.goto("/admin/live");

    const row = page.locator("table.admin-table tbody tr", { hasText: "013" });
    await expect(row).toContainText("×3");
    await expect(row).toContainText("15m");
  });

  test("never renders a reserve price", async ({ page }) => {
    /*
     * docs/architecture.md §3 invariant 7. This page reads the reserve
     * on the server to decide met/not-met and must emit only the
     * verdict — an operations list gets read over somebody's shoulder,
     * and the figure is the one thing on it that cannot be unsaid.
     */
    await signIn(page);
    await page.goto("/admin/live");

    const reserves = await prisma.lot.findMany({
      where: { status: { in: ["BIDDING_OPEN", "EXTENDING"] } },
      select: { reservePriceMinor: true },
    });
    expect(reserves.length).toBeGreaterThan(0);

    const html = await page.content();

    for (const { reservePriceMinor } of reserves) {
      // Formatted the way the app would render money, and also as raw
      // minor units, in case it ever reaches the client unformatted in
      // a prop or a JSON payload.
      expect(html).not.toContain(formatMoney(reservePriceMinor, "en"));
      expect(html).not.toContain(formatMoney(reservePriceMinor, "bg"));
      expect(html).not.toContain(reservePriceMinor.toString());
    }

    // The verdict itself is expected to be there.
    await expect(page.locator("table.admin-table tbody")).toContainText(/met/);
  });

  test("warns that nothing is closing lots when one is past its close", async ({ page }) => {
    /*
     * The one signal on this page that is not about the auction: a lot
     * past its close and still open means the worker is not running.
     * Unreachable from seeded data, so the state is made and unmade.
     */
    const lot = snapshots.get(OPEN_LOT)!;
    await prisma.lot.update({
      where: { id: lot.id },
      data: { effectiveCloseAt: new Date(Date.now() - 10 * 60_000) },
    });

    try {
      await signIn(page);
      await page.goto("/admin/live");

      const notice = page.locator(".admin-notice[data-tone='error']");
      await expect(notice).toBeVisible();
      await expect(notice).toContainText("past the close and still open");
      // Naming the worker is what makes the alert actionable.
      await expect(notice).toContainText("closing worker");
    } finally {
      await restore(OPEN_LOT);
    }
  });

  test("flags a lot that has run far past its schedule", async ({ page }) => {
    const lot = snapshots.get(EXTENDED_LOT)!;
    await prisma.lot.update({
      where: { id: lot.id },
      data: {
        extensionCount: 9,
        // Well past the 30-minute threshold, and still in the future so
        // this does not also trip the overdue alert.
        effectiveCloseAt: new Date(lot.scheduledCloseAt!.getTime() + 50 * 60_000),
      },
    });

    try {
      await signIn(page);
      await page.goto("/admin/live");

      await expect(page.locator(".hint").first()).toContainText("running long");

      const row = page.locator("table.admin-table tbody tr", { hasText: "013" });
      await expect(row).toContainText("×9");
      await expect(row).toContainText("50m");
      await expect(row).toHaveAttribute("data-overdue", "true");
    } finally {
      await restore(EXTENDED_LOT);
    }
  });
});
