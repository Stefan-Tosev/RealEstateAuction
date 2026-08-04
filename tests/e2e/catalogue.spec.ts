import { expect, test } from "@playwright/test";
import { DRAFT_SEED_SLUG, LISTABLE_SEED_SLUGS, LISTINGS } from "../../prisma/seeds/listings";

/*
 * Depends on a seeded database, exactly as admin-login.spec.ts depends
 * on ADMIN_EMAIL. Expectations are imported from the seed rather than
 * duplicated, so the two cannot drift — the failure CLAUDE.md documents
 * for v1's hand-synced index.html and LISTINGS array.
 */

const bySlug = (slug: string) => {
  const listing = LISTINGS.find((l) => l.slug === slug);
  if (!listing) throw new Error(`No seed listing for ${slug}`);
  return listing;
};

const URGENT_LOT = bySlug("dvustaen-karshiyaka-plovdiv"); // closes in 30h
const RELAXED_LOT = bySlug("tristaen-lozenets-sofia"); // closes in 4d
const PREVIEW_LOT = bySlug("mezonet-more-varna"); // PUBLISHED
const CLOSED_LOT = bySlug("targovsko-vitosha-sofia"); // CLOSED_SOLD

test.describe("locale routing", () => {
  /*
   * Negotiation honours the browser's Accept-Language, so the
   * destination depends on the browser context — asserting a fixed
   * locale here would only be testing Playwright's default.
   */
  test("the root redirects a Bulgarian browser to /bg", async ({ browser }) => {
    const context = await browser.newContext({ locale: "bg-BG" });
    const page = await context.newPage();

    await page.goto("/");
    await expect(page).toHaveURL(/\/bg\/lots$/);

    await context.close();
  });

  test("the root redirects an English browser to /en", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();

    await page.goto("/");
    await expect(page).toHaveURL(/\/en\/lots$/);

    await context.close();
  });

  test("an unrecognised browser language falls back to Bulgarian", async ({ browser }) => {
    const context = await browser.newContext({ locale: "de-DE" });
    const page = await context.newPage();

    await page.goto("/");
    await expect(page).toHaveURL(/\/bg\/lots$/);

    await context.close();
  });

  test("an unsupported locale is a 404", async ({ page }) => {
    const response = await page.goto("/fr/lots");
    expect(response?.status()).toBe(404);
  });

  test("each locale renders its own language and lang attribute", async ({ page }) => {
    await page.goto("/en/lots");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { name: "Current lots" })).toBeVisible();

    await page.goto("/bg/lots");
    await expect(page.locator("html")).toHaveAttribute("lang", "bg");
    await expect(page.getByRole("heading", { name: "Текущи лотове" })).toBeVisible();
  });

  test("the language switch keeps you on the same lot", async ({ page }) => {
    await page.goto(`/bg/lots/${URGENT_LOT.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(URGENT_LOT.titleBg);

    await page.getByRole("link", { name: /Switch language|Смени езика/i }).click();

    await expect(page).toHaveURL(new RegExp(`/en/lots/${URGENT_LOT.slug}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(URGENT_LOT.titleEn);
  });

  test("declares canonical and hreflang alternates", async ({ page }) => {
    await page.goto(`/bg/lots/${URGENT_LOT.slug}`);

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`/bg/lots/${URGENT_LOT.slug}$`),
    );
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      "href",
      new RegExp(`/en/lots/${URGENT_LOT.slug}$`),
    );
    // An unmatched crawler should land on Bulgarian.
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
      "href",
      new RegExp(`/bg/lots/${URGENT_LOT.slug}$`),
    );
  });
});

test.describe("the lots index", () => {
  test("shows exactly the listable lots", async ({ page }) => {
    await page.goto("/bg/lots");
    await expect(page.locator("article.lot-card")).toHaveCount(LISTABLE_SEED_SLUGS.length);
  });

  test("hides the draft and the closed lot", async ({ page }) => {
    await page.goto("/bg/lots");

    await expect(page.getByText(bySlug(DRAFT_SEED_SLUG).titleBg)).toHaveCount(0);
    await expect(page.getByText(CLOSED_LOT.titleBg)).toHaveCount(0);
  });

  test("every card has an image", async ({ page }) => {
    await page.goto("/bg/lots");

    // Every listed property must have photography. The gradient fallback
    // exists for lots published before their photos are uploaded, but no
    // seeded lot should be relying on it.
    const cards = page.locator("article.lot-card");
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      await expect(cards.nth(i).locator("img.lot-image-photo")).toHaveCount(1);
      await expect(cards.nth(i).locator("img.lot-image-photo")).not.toHaveAttribute("alt", "");
    }
  });
});

test.describe("preview vs bidding", () => {
  /*
   * The most important assertion in this file. docs/architecture.md §1:
   * PUBLISHED is a 21-day preview with "No bidding." A bid affordance
   * appearing during preview would be a straightforward breach of the
   * auction's own rules.
   */
  test("a preview lot offers no way to bid", async ({ page }) => {
    await page.goto(`/bg/lots/${PREVIEW_LOT.slug}`);

    await expect(page.getByRole("button", { name: /Наддай|Place Bid/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Наддай|Place Bid/i })).toHaveCount(0);
  });

  test("a preview lot counts down to bidding opening, not to a close", async ({ page }) => {
    await page.goto(`/bg/lots/${PREVIEW_LOT.slug}`);

    /*
     * Scoped to the price panel on purpose: "similar properties" at the
     * foot of the page renders cards for lots that really are in the
     * bidding phase, so a whole-page assertion would fail on correct
     * output.
     */
    const panel = page.locator(".price-panel");
    await expect(panel.getByText("Наддаването отваря след")).toBeVisible();
    await expect(panel.getByText("Приключва след")).toHaveCount(0);
  });

  test("a bidding lot counts down to its close", async ({ page }) => {
    await page.goto(`/bg/lots/${URGENT_LOT.slug}`);

    const panel = page.locator(".price-panel");
    await expect(panel.getByText("Приключва след")).toBeVisible();
    await expect(panel.getByText("Наддаването отваря след")).toHaveCount(0);
  });
});

test.describe("countdown", () => {
  test("ticks in the documented format", async ({ page }) => {
    await page.goto(`/bg/lots/${URGENT_LOT.slug}`);

    // Server renders a placeholder; the client replaces it once it has
    // the server-time offset.
    await expect(page.locator("[data-countdown]").first()).toHaveText(
      /^\d{2,}d \d{2}:\d{2}:\d{2}$/,
      { timeout: 10_000 },
    );
  });

  test("marks a lot inside 48 hours as urgent, and one outside it not", async ({ page }) => {
    await page.goto("/bg/lots");

    const urgent = page.locator("article.lot-card", { hasText: URGENT_LOT.titleBg });
    const relaxed = page.locator("article.lot-card", { hasText: RELAXED_LOT.titleBg });

    await expect(urgent.locator("[data-countdown][data-urgent]")).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(relaxed.locator("[data-countdown][data-urgent]")).toHaveCount(0);
  });

  test("a preview countdown is never urgent", async ({ page }) => {
    // A lot approaching its *opening* is good news; amber would invert
    // the meaning. Scoped to the panel — "similar properties" below can
    // legitimately contain an urgent lot.
    await page.goto(`/bg/lots/${PREVIEW_LOT.slug}`);

    const panel = page.locator(".price-panel");
    await expect(panel.locator("[data-countdown]")).toHaveCount(1);
    await expect(panel.locator("[data-countdown][data-urgent]")).toHaveCount(0);
  });
});

test.describe("visibility rules", () => {
  test("the draft lot is not reachable by URL", async ({ page }) => {
    const response = await page.goto(`/bg/lots/${DRAFT_SEED_SLUG}`);
    expect(response?.status()).toBe(404);
  });

  test("an unknown slug is a 404", async ({ page }) => {
    const response = await page.goto("/bg/lots/no-such-property");
    expect(response?.status()).toBe(404);
  });

  test("a closed lot still resolves, so shared links survive", async ({ page }) => {
    const response = await page.goto(`/bg/lots/${CLOSED_LOT.slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(CLOSED_LOT.titleBg);
  });
});

test.describe("the reserve price never reaches the client", () => {
  /*
   * docs/architecture.md §3 invariant 7. The unit tests guard the select
   * allowlist and the DTOs; this checks the thing that actually ships —
   * the bytes on the wire — and would catch a leak introduced anywhere
   * downstream of the mappers.
   */
  /*
   * Bounded by digit boundaries, not a bare substring search.
   *
   * A plain `toContain("11000000")` produced a false alarm: those digits
   * occur inside a float in Next's dev-mode RSC payload
   * ("start":163.26110000000335). A leak-detector that cries wolf gets
   * ignored, which is worse than not having one.
   */
  const containsAmount = (body: string, amount: bigint) =>
    new RegExp(`(?<!\\d)${amount}(?!\\d)`).test(body);

  for (const locale of ["bg", "en"] as const) {
    test(`not in the ${locale} detail HTML`, async ({ page }) => {
      const listing = URGENT_LOT;
      const reserveMinor = (listing.startingPriceMinor * 110n) / 100n;

      const response = await page.request.get(`/${locale}/lots/${listing.slug}`);
      const body = await response.text();

      expect(containsAmount(body, reserveMinor), "raw minor units").toBe(false);

      // The major-unit rendering, in both thousands-separator styles.
      const major = Number(reserveMinor / 100n);
      expect(body).not.toContain(major.toLocaleString("en-GB"));
      expect(body).not.toMatch(/reserve_?price/i);
    });
  }

  test("not in the lots index HTML", async ({ page }) => {
    const response = await page.request.get("/bg/lots");
    const body = await response.text();

    for (const listing of LISTINGS) {
      const reserveMinor = (listing.startingPriceMinor * 110n) / 100n;
      expect(containsAmount(body, reserveMinor), `lot ${listing.lotNumber}`).toBe(false);
    }
  });
});

test.describe("accessibility basics", () => {
  test("the skip link is the first focusable element", async ({ page }) => {
    await page.goto("/bg/lots");
    await page.keyboard.press("Tab");

    await expect(page.locator(":focus")).toHaveClass(/skip-link/);
  });

  test("a detail page has exactly one h1", async ({ page }) => {
    await page.goto(`/bg/lots/${URGENT_LOT.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});
