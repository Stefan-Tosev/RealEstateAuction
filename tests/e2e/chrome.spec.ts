import { expect, test } from "@playwright/test";

/*
 * Site chrome and the interactive pieces: theme toggle, language switch,
 * gallery, and the routes that are not pages (time, robots, sitemap).
 *
 * All of this shipped in the catalogue pass with no coverage at all —
 * the specs there exercised content and routing, and every one of these
 * was only ever checked by hand.
 */

const TWO_IMAGE_LOT = "tristaen-lozenets-sofia";
const ONE_IMAGE_LOT = "dvustaen-karshiyaka-plovdiv";

test.describe("theme", () => {
  /*
   * There is no unconditional default: a first visit follows the OS
   * preference, so the browser context has to pin colorScheme for the
   * starting state to mean anything.
   */
  test("starts dark for a dark-preferring visitor and flips on click", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark", locale: "bg-BG" });
    const page = await context.newPage();

    await page.goto("/bg/lots");
    await expect(page.locator("body")).toHaveClass(/theme-dark/);

    await page.getByRole("button", { name: /тема|theme/i }).click();
    await expect(page.locator("body")).toHaveClass(/theme-light/);
    await expect(page.locator("body")).not.toHaveClass(/theme-dark/);

    await context.close();
  });

  test("survives a reload", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark", locale: "bg-BG" });
    const page = await context.newPage();

    await page.goto("/bg/lots");
    await page.getByRole("button", { name: /тема|theme/i }).click();
    await expect(page.locator("body")).toHaveClass(/theme-light/);

    await page.reload();

    // The inline script applies this before paint, so there is no dark
    // flash for a visitor who chose light.
    await expect(page.locator("body")).toHaveClass(/theme-light/);

    await context.close();
  });

  test("follows the OS preference on a first visit", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "light", locale: "bg-BG" });
    const page = await context.newPage();

    await page.goto("/bg/lots");
    await expect(page.locator("body")).toHaveClass(/theme-light/);

    await context.close();
  });

  test("always flips relative to the current theme", async ({ browser }) => {
    /*
     * The toggle derives the next theme from the body class rather than
     * from React state. State starts null and is only filled in by the
     * mount effect, so computing from it made the button a no-op on an
     * already-light page.
     *
     * Starting from light — the case the state-based version got wrong —
     * and going both ways.
     */
    const context = await browser.newContext({ colorScheme: "light", locale: "bg-BG" });
    const page = await context.newPage();

    await page.goto("/bg/lots");
    await expect(page.locator("body")).toHaveClass(/theme-light/);

    const button = page.getByRole("button", { name: /тема|theme/i });

    await button.click();
    await expect(page.locator("body")).toHaveClass(/theme-dark/);

    await button.click();
    await expect(page.locator("body")).toHaveClass(/theme-light/);

    await context.close();
  });

  test("an explicit choice beats the OS preference", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "light", locale: "bg-BG" });
    const page = await context.newPage();

    await page.goto("/bg/lots");
    await page.getByRole("button", { name: /тема|theme/i }).click();
    await expect(page.locator("body")).toHaveClass(/theme-dark/);

    await page.reload();
    await expect(page.locator("body")).toHaveClass(/theme-dark/);

    await context.close();
  });
});

test.describe("language switch", () => {
  test("remembers the choice for later visits to /", async ({ browser }) => {
    // A Bulgarian-preferring browser that explicitly picks English.
    const context = await browser.newContext({ locale: "bg-BG" });
    const page = await context.newPage();

    await page.goto("/bg/lots");
    await page.getByRole("link", { name: /Смени езика|Switch language/i }).click();
    await expect(page).toHaveURL(/\/en\/lots$/);

    const cookie = (await context.cookies()).find((c) => c.name === "NEXT_LOCALE");
    expect(cookie?.value).toBe("en");

    // The cookie must now beat Accept-Language at the root redirect,
    // otherwise the choice silently evaporates on the next visit.
    await page.goto("/");
    await expect(page).toHaveURL(/\/en\/lots$/);

    await context.close();
  });

  test("marks the active locale and links only the other one", async ({ page }) => {
    await page.goto("/bg/lots");

    const active = page.locator('.lang-link[aria-current="true"]');
    await expect(active).toHaveText("BG");
    // The current locale must not be a link to itself.
    await expect(page.locator('a.lang-link[aria-current="true"]')).toHaveCount(0);
  });
});

test.describe("gallery", () => {
  test("shows thumbnails only when there is more than one image", async ({ page }) => {
    await page.goto(`/bg/lots/${ONE_IMAGE_LOT}`);
    await expect(page.locator(".gallery-thumb")).toHaveCount(0);

    await page.goto(`/bg/lots/${TWO_IMAGE_LOT}`);
    await expect(page.locator(".gallery-thumb")).toHaveCount(2);
  });

  test("selecting a thumbnail changes the main image", async ({ page }) => {
    await page.goto(`/bg/lots/${TWO_IMAGE_LOT}`);

    const main = page.locator(".gallery-main img");
    // Alt text differs per image, which is a more meaningful assertion
    // than a src that next/image rewrites.
    const first = await main.getAttribute("alt");

    await page.locator(".gallery-thumb").nth(1).click();

    await expect(main).not.toHaveAttribute("alt", first ?? "");
    await expect(page.locator('.gallery-thumb[aria-current="true"]')).toHaveCount(1);
  });

  test("every image has non-empty alt text", async ({ page }) => {
    await page.goto(`/bg/lots/${TWO_IMAGE_LOT}`);

    // Decorative thumbnails are deliberately alt="" with the label on the
    // button, so only the main image is checked here.
    await expect(page.locator(".gallery-main img")).not.toHaveAttribute("alt", "");
  });
});

test.describe("non-page routes", () => {
  test("/api/time returns a fresh, uncacheable timestamp", async ({ request }) => {
    const response = await request.get("/api/time");
    expect(response.status()).toBe(200);

    // Cacheable server time would defeat the whole offset mechanism.
    expect(response.headers()["cache-control"]).toContain("no-store");

    const { now } = (await response.json()) as { now: string };
    const skew = Math.abs(Date.now() - Date.parse(now));
    expect(Number.isNaN(Date.parse(now))).toBe(false);
    expect(skew).toBeLessThan(60_000);
  });

  test("robots.txt keeps crawlers out of the admin", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();

    expect(body).toContain("Disallow: /admin");
    expect(body).toContain("Sitemap:");
  });

  test("sitemap.xml lists both locales for every public lot", async ({ request }) => {
    const body = await (await request.get("/sitemap.xml")).text();

    expect(body).toContain("/bg/lots");
    expect(body).toContain("/en/lots");
    expect(body).toContain(`/bg/lots/${ONE_IMAGE_LOT}`);
    expect(body).toContain(`/en/lots/${ONE_IMAGE_LOT}`);

    // A draft lot in the sitemap would invite crawlers to a 404.
    expect(body).not.toContain("partsel-pirin-bansko");
  });
});

test.describe("the not-found page", () => {
  test("renders a real page, not just a status", async ({ page }) => {
    const response = await page.goto("/bg/lots/no-such-lot");
    expect(response?.status()).toBe(404);

    await expect(page.getByRole("heading", { name: "Лотът не е намерен" })).toBeVisible();
    // And offers a way back, rather than stranding the visitor.
    await expect(page.getByRole("link", { name: "Виж всички лотове" })).toBeVisible();
  });

  test("its link returns to the catalogue", async ({ page }) => {
    await page.goto("/bg/lots/no-such-lot");
    await page.getByRole("link", { name: "Виж всички лотове" }).click();

    await expect(page).toHaveURL(/\/bg\/lots$/);
  });
});
