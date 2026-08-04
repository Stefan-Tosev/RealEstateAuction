import "dotenv/config";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/*
 * States the seeded catalogue does not produce, but production will.
 *
 * A lot published before its photographs are uploaded, and a lot
 * published before its dates are agreed, are both ordinary things for an
 * operator to do. Neither was rendered even once before this spec — the
 * mappers were unit-tested, but nothing proved the components handled
 * what they returned.
 *
 * Creates its own fixture and removes it again, so the rest of the suite
 * still sees exactly the seeded catalogue.
 */

const prisma = new PrismaClient();

const SLUG = "e2e-fixture-no-images-no-dates";

test.beforeAll(async () => {
  const admin = await prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("Seed the admin user before running the e2e suite.");

  await prisma.property.deleteMany({ where: { slug: SLUG } });

  const property = await prisma.property.create({
    data: {
      slug: SLUG,
      titleBg: "Лот без снимки и без дати",
      titleEn: "Lot with no photos and no dates",
      descriptionBg: "Тестов запис.",
      descriptionEn: "Test record.",
      address: "ул. Тестова 1, София",
      city: "София",
      region: "София",
      propertyType: "apartment",
      rooms: 2,
      areaSqm: 70,
    },
  });

  await prisma.lot.create({
    data: {
      propertyId: property.id,
      lotNumber: 901,
      status: "PUBLISHED",
      // No images, and deliberately no biddingOpensAt — the "scheduled"
      // phase, meaning dates to be announced.
      startingPriceMinor: 12_345_600n,
      reservePriceMinor: 13_000_000n,
      reserveAgreedBy: admin.id,
      reserveAgreedAt: new Date(),
    },
  });
});

test.afterAll(async () => {
  // Lots reference properties with onDelete: Restrict, so the lot goes
  // first; images would cascade but there are none.
  await prisma.lot.deleteMany({ where: { property: { slug: SLUG } } });
  await prisma.property.deleteMany({ where: { slug: SLUG } });
  await prisma.$disconnect();
});

test("a lot with no photographs renders the gradient placeholder", async ({ page }) => {
  await page.goto(`/bg/lots/${SLUG}`);

  const main = page.locator(".gallery-main");
  await expect(main.locator("img")).toHaveCount(0);

  const placeholder = main.locator('div.lot-image[role="img"]');
  await expect(placeholder).toHaveCount(1);
  // A gradient standing in for a photo still has to announce itself.
  await expect(placeholder).toHaveAttribute("aria-label", /Лот без снимки/);
  await expect(placeholder).toHaveClass(/lot-image-[1-8]/);
});

test("a lot with no agreed dates shows no countdown at all", async ({ page }) => {
  await page.goto(`/bg/lots/${SLUG}`);

  // Scoped to the panel: "similar properties" below carries countdowns
  // for other lots, and those are correct.
  const panel = page.locator(".price-panel");

  // Better nothing than a countdown to an invented date.
  await expect(panel.locator("[data-countdown]")).toHaveCount(0);
  await expect(panel.getByText("Наддаването отваря след")).toHaveCount(0);
  await expect(panel.getByText("Приключва след")).toHaveCount(0);
});

test("it still renders price, description and key details", async ({ page }) => {
  await page.goto(`/bg/lots/${SLUG}`);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Лот без снимки и без дати");
  await expect(page.locator(".price-panel-value")).toContainText("123");
  await expect(page.locator(".key-detail-value")).toHaveCount(2);
});

test("it appears in the index with a placeholder card", async ({ page }) => {
  await page.goto("/bg/lots");

  const card = page.locator("article.lot-card", { hasText: "Лот без снимки и без дати" });
  await expect(card).toHaveCount(1);
  await expect(card.locator('div.lot-image[role="img"]')).toHaveCount(1);
  await expect(card.locator("img")).toHaveCount(0);
});
