import "dotenv/config";
import { rm } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";

/*
 * The admin CRUD flow, end to end: create a property, upload a
 * photograph, create a lot, and get it published — including the things
 * that must refuse to happen.
 *
 * Runs serially and cleans up after itself, so the seeded catalogue the
 * other specs assert against is unchanged.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();

const SLUG = "e2e-admin-created-property";
const TITLE_BG = "Тестов имот от админ панела";
const TITLE_EN = "Test property from the admin";
const STAFF_EMAIL = "e2e-staff@auctionhouse.test";
const STAFF_PASSWORD = "e2e-staff-password-9f3c1a";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
}

async function signInAsAuctioneer(page: Page) {
  await signIn(page, process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
}

async function cleanup() {
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: (await lotAndPropertyIds()).all } },
  });
  // Fees hold a restrictive foreign key to the lot on purpose: a billing
  // record must not vanish silently with whatever it was raised against.
  await prisma.fee.deleteMany({ where: { lot: { property: { slug: SLUG } } } });
  await prisma.lot.deleteMany({ where: { property: { slug: SLUG } } });
  await prisma.propertyImage.deleteMany({ where: { property: { slug: SLUG } } });
  await prisma.property.deleteMany({ where: { slug: SLUG } });
  await prisma.adminUser.deleteMany({ where: { email: STAFF_EMAIL } });

  /*
   * Deleting the rows directly bypasses deletePropertyImage(), which is
   * what removes the file — so the uploaded blobs have to go explicitly.
   * Without this the repo accumulates an orphaned media directory on
   * every run.
   */
  await rm(path.join(process.cwd(), "media", "properties", SLUG), {
    recursive: true,
    force: true,
  });
}

async function lotAndPropertyIds() {
  const property = await prisma.property.findUnique({
    where: { slug: SLUG },
    select: { id: true, lots: { select: { id: true } }, images: { select: { id: true } } },
  });
  if (!property) return { all: [] as string[] };
  return {
    all: [property.id, ...property.lots.map((l) => l.id), ...property.images.map((i) => i.id)],
  };
}

test.beforeAll(async () => {
  await cleanup();

  // A `staff` account, to prove the role gate is real rather than a
  // disabled button. Password hashed the same way the seed does it.
  const { hashPassword } = await import("../../src/server/identity/password");
  await prisma.adminUser.create({
    data: {
      email: STAFF_EMAIL,
      passwordHash: await hashPassword(STAFF_PASSWORD),
      name: "E2E Staff",
      role: "staff",
    },
  });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("an operator can create a property", async ({ page }) => {
  await signInAsAuctioneer(page);

  await page.goto("/admin/properties/new");
  await page.getByLabel("Slug").fill(SLUG);
  await page.getByLabel("Title (BG)").fill(TITLE_BG);
  await page.getByLabel("Title (EN)").fill(TITLE_EN);
  await page.getByLabel("Description (BG)").fill("Описание на български за тестовия имот.");
  await page.getByLabel("Description (EN)").fill("English description for the test property.");
  await page.getByLabel("Address").fill("ул. Тестова 5, София");
  await page.getByLabel("City").fill("София");
  await page.getByLabel("Region").fill("София");
  await page.getByLabel("Rooms").fill("3");
  await page.getByLabel("Area (sqm)").fill("88");

  await page.getByRole("button", { name: "Create property" }).click();

  await expect(page).toHaveURL(/\/admin\/properties$/);
  await expect(page.getByText(TITLE_BG)).toBeVisible();
});

test("validation refuses a half-translated listing", async ({ page }) => {
  await signInAsAuctioneer(page);
  await page.goto("/admin/properties/new");

  // Bulgarian only — the bilingual columns are NOT NULL and the whole
  // pattern exists to stop exactly this.
  await page.getByLabel("Slug").fill("e2e-should-not-be-created");
  await page.getByLabel("Title (BG)").fill("Само на български");
  await page.getByLabel("Description (BG)").fill("Само на български.");
  await page.getByLabel("Address").fill("ул. Тестова 5");
  await page.getByLabel("City").fill("София");
  await page.getByLabel("Region").fill("София");

  await page.getByRole("button", { name: "Create property" }).click();

  await expect(page.getByText("English title is required.")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/properties\/new$/);

  expect(
    await prisma.property.count({ where: { slug: "e2e-should-not-be-created" } }),
  ).toBe(0);
});

test("validation refuses a duplicate slug", async ({ page }) => {
  await signInAsAuctioneer(page);
  await page.goto("/admin/properties/new");

  await page.getByLabel("Slug").fill(SLUG);
  await page.getByLabel("Title (BG)").fill("Дубликат");
  await page.getByLabel("Title (EN)").fill("Duplicate");
  await page.getByLabel("Description (BG)").fill("Дубликат.");
  await page.getByLabel("Description (EN)").fill("Duplicate.");
  await page.getByLabel("Address").fill("ул. Тестова 6");
  await page.getByLabel("City").fill("София");
  await page.getByLabel("Region").fill("София");

  await page.getByRole("button", { name: "Create property" }).click();

  // A slug clash is a validation failure, not a 500 from the unique index.
  await expect(page.getByText("That slug is already in use.")).toBeVisible();
});

test("an operator can upload a photograph", async ({ page }) => {
  await signInAsAuctioneer(page);

  const property = await prisma.property.findUniqueOrThrow({ where: { slug: SLUG } });
  await page.goto(`/admin/properties/${property.id}`);

  await expect(page.getByText("No photographs yet.")).toBeVisible();

  const jpeg = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: "#2E4FA3" },
  })
    .jpeg()
    .toBuffer();

  await page.getByLabel("Add a photograph").setInputFiles({
    name: "test-photo.jpg",
    mimeType: "image/jpeg",
    buffer: jpeg,
  });
  await page.getByLabel("Alt text (BG)").fill("Тестова снимка");
  await page.getByLabel("Alt text (EN)").fill("Test photograph");
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.getByText("Image uploaded.")).toBeVisible();

  const image = await prisma.propertyImage.findFirstOrThrow({
    where: { property: { slug: SLUG } },
  });
  expect(image.width).toBe(1200);
  expect(image.height).toBe(900);
  // Normalised on the way in, whatever was sent.
  expect(image.storageKey).toMatch(/\.jpg$/);
});

test("uploads that are not images are refused", async ({ page }) => {
  await signInAsAuctioneer(page);

  const property = await prisma.property.findUniqueOrThrow({ where: { slug: SLUG } });
  await page.goto(`/admin/properties/${property.id}`);

  const before = await prisma.propertyImage.count({ where: { propertyId: property.id } });

  // An SVG is a script container, not an image. The .jpg name and the
  // image/jpeg content type are both lies, which is the point.
  await page.getByLabel("Add a photograph").setInputFiles({
    name: "payload.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  await page.getByLabel("Alt text (BG)").fill("Опит");
  await page.getByLabel("Alt text (EN)").fill("Attempt");
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.getByText(/not a JPEG, PNG or WebP/i)).toBeVisible();
  expect(await prisma.propertyImage.count({ where: { propertyId: property.id } })).toBe(before);
});

test("an operator can create a lot", async ({ page }) => {
  await signInAsAuctioneer(page);
  await page.goto("/admin/lots/new");

  const property = await prisma.property.findUniqueOrThrow({ where: { slug: SLUG } });
  await page.getByLabel("Property").selectOption(property.id);
  await page.getByLabel("Lot number").fill("901");
  await page.getByLabel("Guide price").fill("250000");
  await page.getByLabel("Reserve price").fill("270000");
  await page.getByLabel("Bid increment (optional)").fill("5000");

  await page.getByRole("button", { name: "Create lot" }).click();

  await expect(page).toHaveURL(/\/admin\/lots$/);

  const lot = await prisma.lot.findFirstOrThrow({ where: { property: { slug: SLUG } } });
  // Money is parsed from euros to minor units as strings, never via
  // floating point.
  expect(lot.startingPriceMinor).toBe(25_000_000n);
  expect(lot.reservePriceMinor).toBe(27_000_000n);
  expect(lot.status).toBe("DRAFT");
});

test("a reserve below the guide price is refused", async ({ page }) => {
  await signInAsAuctioneer(page);
  const lot = await prisma.lot.findFirstOrThrow({ where: { property: { slug: SLUG } } });

  await page.goto(`/admin/lots/${lot.id}`);
  await page.getByLabel("Reserve price").fill("100000");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Reserve cannot be below the guide price.")).toBeVisible();
});

test("publishing is blocked until the reserve is agreed and dates are set", async ({ page }) => {
  await signInAsAuctioneer(page);
  const lot = await prisma.lot.findFirstOrThrow({ where: { property: { slug: SLUG } } });

  await page.goto(`/admin/lots/${lot.id}`);

  // architecture §10: no agreed reserve, no publication.
  await expect(
    page.getByText(/No auctioneer has agreed this reserve/i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();

  expect(
    (await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).status,
  ).toBe("DRAFT");
});

test("a staff account cannot agree a reserve", async ({ page }) => {
  await signIn(page, STAFF_EMAIL, STAFF_PASSWORD);
  const lot = await prisma.lot.findFirstOrThrow({ where: { property: { slug: SLUG } } });

  await page.goto(`/admin/lots/${lot.id}`);

  // Shown, disabled, with the reason — a control an operator cannot see
  // is a control they cannot understand the absence of.
  await expect(page.getByRole("button", { name: "Agree the reserve" })).toBeDisabled();
  await expect(page.getByText(/Restricted to auctioneer accounts/i).first()).toBeVisible();

  expect(
    (await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).reserveAgreedBy,
  ).toBeNull();
});

test("an auctioneer can agree the reserve, set dates and publish", async ({ page }) => {
  await signInAsAuctioneer(page);
  const lot = await prisma.lot.findFirstOrThrow({ where: { property: { slug: SLUG } } });

  await page.goto(`/admin/lots/${lot.id}`);
  await page.getByRole("button", { name: "Agree the reserve" }).click();
  await expect(page.getByText("Reserve agreed.")).toBeVisible();

  // Dates are still missing, so publication is still refused.
  await expect(page.getByText(/Set when bidding opens/i)).toBeVisible();

  const pad = (n: number) => String(n).padStart(2, "0");
  const future = (days: number) => {
    const d = new Date(Date.now() + days * 86_400_000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
  };

  await page.getByLabel("Preview starts").fill(future(1));
  await page.getByLabel("Bidding opens").fill(future(22));
  await page.getByLabel("Scheduled close").fill(future(27));
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/lots$/);

  await page.goto(`/admin/lots/${lot.id}`);
  await page.getByRole("button", { name: "Publish" }).click();

  await expect(page.locator('.admin-chip[data-status="PUBLISHED"]').first()).toBeVisible();
  expect((await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe("PUBLISHED");
});

test("the published lot appears on the public site", async ({ page }) => {
  // The whole point of the admin: content authored here reaches visitors.
  await page.goto(`/bg/lots/${SLUG}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE_BG);

  await page.goto(`/en/lots/${SLUG}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE_EN);

  // And the reserve does not come with it.
  const body = await (await page.request.get(`/bg/lots/${SLUG}`)).text();
  expect(body).not.toContain("27000000");
  expect(body).not.toContain("270,000");
});

test("the admin screens raise no console errors", async ({ page }) => {
  /*
   * Added after a real escape: the property edit page was handing a
   * Prisma Decimal to a client component, which React refuses — "Only
   * plain objects can be passed to Client Components". Every test still
   * passed, because the warning went to the server log and nothing was
   * watching it.
   */
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // The failing URL is in location(), not in text() — filtering on the
    // message alone silently lets resource 404s through.
    problems.push(`${msg.text()} @ ${msg.location().url}`);
  });
  page.on("pageerror", (error) => problems.push(error.message));

  await signInAsAuctioneer(page);

  const property = await prisma.property.findUniqueOrThrow({ where: { slug: SLUG } });
  const lot = await prisma.lot.findFirstOrThrow({ where: { property: { slug: SLUG } } });

  for (const url of [
    "/admin",
    "/admin/properties",
    "/admin/properties/new",
    `/admin/properties/${property.id}`,
    "/admin/lots",
    "/admin/lots/new",
    `/admin/lots/${lot.id}`,
  ]) {
    await page.goto(url, { waitUntil: "networkidle" });
  }

  const real = problems.filter((p) => !p.includes("favicon") && !p.includes("ERR_ABORTED"));
  expect(real).toEqual([]);
});

test("every mutation left an audit trail", async ({ page }) => {
  await signInAsAuctioneer(page);

  const ids = await lotAndPropertyIds();
  const entries = await prisma.auditLog.findMany({
    where: { entityId: { in: ids.all } },
    orderBy: { createdAt: "asc" },
  });

  const actions = entries.map((e) => e.action);
  expect(actions).toContain("property.create");
  expect(actions).toContain("image.add");
  expect(actions).toContain("lot.create");
  expect(actions).toContain("lot.agreeReserve");
  expect(actions).toContain("lot.status.published");

  // Every row names who did it, which is the entire point.
  for (const entry of entries) expect(entry.actorUserId).not.toBeNull();

  // And the before/after survived serialization — bigint and Date would
  // otherwise have thrown inside the audit write.
  const created = entries.find((e) => e.action === "lot.create");
  expect(JSON.stringify(created?.after)).toContain("25000000");
});
