import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/*
 * Every admin page renders inside its shell.
 *
 * CLAUDE.md records the failure this exists for: "Twice a whole suite
 * was green while a page rendered with no shell at all." The suite is
 * strong on behaviour and blind to layout, and a page that throws inside
 * the layout still answers 200 with its heading — so content assertions
 * pass while the sidebar, the navigation and every style are missing.
 *
 * Deliberately shallow. This is a smoke test over breadth, not a check
 * of what any page does; the per-area specs own that. What it catches is
 * the whole-page failure that nothing else looks for.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();

/*
 * Every enabled nav destination. A test below asserts this list matches
 * the sidebar, so enabling an item in the layout without adding it here
 * fails rather than quietly going uncovered.
 */
const NAV_ROUTES = [
  "/admin",
  "/admin/lots",
  "/admin/live",
  "/admin/properties",
  "/admin/sellers",
  "/admin/bidders",
  "/admin/sales",
  "/admin/invoices",
];

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel("Password").fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
}

/** Asserts the frame, not the contents. */
async function expectShell(page: Page) {
  await expect(page.locator(".admin-shell")).toBeVisible();
  await expect(page.locator(".admin-sidebar")).toBeVisible();
  await expect(page.locator(".admin-main")).toBeVisible();

  // The brand and the sign-out live in the sidebar's two ends; a
  // half-rendered shell tends to lose one of them.
  await expect(page.locator(".admin-sidebar-brand")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  // Exactly one section highlighted. Highlighting all of them is a bug
  // this navigation has actually had.
  await expect(page.locator('.admin-nav-link[aria-current="page"]')).toHaveCount(1);

  // Every page owns exactly one h1. A layout that rendered twice — which
  // is what a misplaced root layout looks like — shows two.
  await expect(page.locator("h1")).toHaveCount(1);
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("the admin shell", () => {
  for (const route of NAV_ROUTES) {
    test(`${route} renders inside the shell`, async ({ page }) => {
      await signIn(page);

      const response = await page.goto(route);
      expect(response?.status()).toBe(200);

      await expectShell(page);

      /*
       * A styled page is the other half of "it rendered". The shell
       * class can exist in markup while the stylesheet 404s, which is
       * exactly what a broken build looks like and what a DOM assertion
       * cannot see.
       */
      const sidebarWidth = await page
        .locator(".admin-sidebar")
        .evaluate((el) => el.getBoundingClientRect().width);
      expect(sidebarWidth).toBeGreaterThan(100);
    });
  }

  test("the nav list and this spec's route list agree", async ({ page }) => {
    /*
     * The drift guard. Enabling a nav item without adding it above would
     * otherwise leave a page with no smoke coverage and nothing to say
     * so — the same shape of gap that let /admin/live ship untested.
     */
    await signIn(page);
    await page.goto("/admin");

    const hrefs = await page.locator(".admin-nav-link").evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")).filter((href): href is string => href !== null),
    );

    expect(hrefs.sort()).toEqual([...NAV_ROUTES].sort());
  });

  test("a lot detail page renders inside the shell too", async ({ page }) => {
    /*
     * The nav routes are all indexes. Detail pages take a different code
     * path — dynamic params, a database read that can return nothing —
     * and the lot detail is the busiest page in the admin.
     */
    const lot = await prisma.lot.findFirstOrThrow({
      where: { lotNumber: 11 },
      select: { id: true },
    });

    await signIn(page);
    const response = await page.goto(`/admin/lots/${lot.id}`);
    expect(response?.status()).toBe(200);

    await expectShell(page);
    // Lots stays highlighted on a child route, which is the whole reason
    // the nav matches on subtree rather than equality.
    await expect(page.locator('.admin-nav-link[href="/admin/lots"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("a lot id that does not exist is a 404 page, not a broken shell", async ({ page }) => {
    await signIn(page);

    const response = await page.goto("/admin/lots/00000000-0000-0000-0000-000000000000");
    expect(response?.status()).toBe(404);

    // No assertion about the shell here: Next's not-found renders
    // outside the dashboard layout by design. What matters is that it is
    // a real 404 rather than a 500 from a page that assumed a row.
  });
});
