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
const SELLER_NAME = "E2E Продавач ООД";
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

/** Enough of a PDF for the magic-byte sniff to accept it. */
const LEGAL_PACK_PDF = Buffer.concat([
  Buffer.from("%PDF-1.7\n"),
  Buffer.from("admin-catalogue legal pack fixture\n"),
]);

async function cleanup() {
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: (await lotAndPropertyIds()).all } },
  });

  /*
   * Documents before lots: the rows hold a foreign key, and the files
   * they own live outside the database entirely. Deleting the row is not
   * deleting the file — that has leaked twice in this repo.
   */
  const lotIds = (
    await prisma.lot.findMany({ where: { property: { slug: SLUG } }, select: { id: true } })
  ).map((lot) => lot.id);

  await prisma.lotDocument.deleteMany({ where: { lotId: { in: lotIds } } });

  for (const lotId of lotIds) {
    await rm(path.join(process.cwd(), "private", "documents", lotId), {
      recursive: true,
      force: true,
    });
  }
  // Fees hold a restrictive foreign key to the lot on purpose: a billing
  // record must not vanish silently with whatever it was raised against.
  await prisma.fee.deleteMany({ where: { lot: { property: { slug: SLUG } } } });
  await prisma.lot.deleteMany({ where: { property: { slug: SLUG } } });
  await prisma.propertyImage.deleteMany({ where: { property: { slug: SLUG } } });
  await prisma.property.deleteMany({ where: { slug: SLUG } });
  await prisma.adminUser.deleteMany({ where: { email: STAFF_EMAIL } });
  // After the properties that point at it, and after the fees.
  await prisma.seller.deleteMany({ where: { name: SELLER_NAME } });

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

test("a lot cannot be published until somebody owns the property", async ({ page }) => {
  /*
   * A live lot with no seller has nobody to telephone when it closes
   * below reserve, nobody to bill the commission to, and nobody to send
   * the bid log. §11 keeps sourcing admin-curated, so the record has to
   * be entered by an operator.
   */
  await signInAsAuctioneer(page);

  await page.goto("/admin/sellers");
  await expect(page.getByText(/Never shown in the public catalogue/i)).toBeVisible();

  await page.goto("/admin/sellers/new");
  await page.getByLabel("Seller is").selectOption("company");
  await page.getByLabel("Registered name").fill(SELLER_NAME);
  await page.getByLabel("Email").fill("seller@example.bg");
  await page.getByLabel("Telephone").fill("+359888123456");

  // A company is invoiced as one, and an invoice with a bad ЕИК comes back.
  await page.getByLabel("ЕИК").fill("123456780");
  await page.getByRole("button", { name: "Create seller" }).click();
  await expect(page.getByText(/does not pass its check digit/i)).toBeVisible();

  await page.getByLabel("ЕИК").fill("831641791");
  await page.getByRole("button", { name: "Create seller" }).click();

  await expect(page).toHaveURL(/\/admin\/sellers$/);
  await expect(page.getByText(SELLER_NAME)).toBeVisible();

  // Attach it to the property created earlier.
  const property = await prisma.property.findFirstOrThrow({ where: { slug: SLUG } });
  await page.goto(`/admin/properties/${property.id}`);
  await page.getByLabel("Seller").selectOption({ label: SELLER_NAME });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/properties$/);

  const after = await prisma.property.findFirstOrThrow({ where: { slug: SLUG } });
  expect(after.sellerId).not.toBeNull();
});

test("the copy drafter is offered, and says so when it is not configured", async ({ page }) => {
  /*
   * CI runs without ANTHROPIC_API_KEY, which is the state this asserts:
   * the tool is visible, disabled, and explains itself rather than
   * failing when pressed. Descriptions can always be written by hand.
   */
  await signInAsAuctioneer(page);
  await page.goto("/admin/properties/new");

  await expect(page.getByLabel("What is notable about this property?")).toBeVisible();

  // The only facts a draft may use are the ones on this form.
  await expect(page.getByText(/only facts the draft may use/i)).toBeVisible();

  const button = page.getByRole("button", { name: "Draft descriptions" });
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(page.getByText(/ANTHROPIC_API_KEY is unset/)).toBeVisible();
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

test("a rejected property form keeps everything else the operator typed", async ({ page }) => {
  /*
   * React 19 resets an uncontrolled form once its action completes, so a
   * validation failure used to empty the whole listing. On a form this
   * long that is an afternoon, and retyping prices and descriptions from
   * memory is how a different mistake gets introduced.
   *
   * It went unnoticed for months because no test ever re-submitted a form
   * after an error. This one does.
   */
  await signInAsAuctioneer(page);
  await page.goto("/admin/properties/new");

  await page.getByLabel("Slug").fill("e2e-form-reset-check");
  await page.getByLabel("Title (BG)").fill("Заглавие на български");
  await page.getByLabel("Description (BG)").fill("Описание на български.");
  await page.getByLabel("Description (EN)").fill("English description.");
  await page.getByLabel("Address").fill("ул. Тестова 9");
  await page.getByLabel("City").fill("Пловдив");
  await page.getByLabel("Region").fill("Пловдив");
  await page.getByLabel("Rooms").fill("4");
  await page.getByLabel("Property type").selectOption("house");

  // Title (EN) deliberately left empty — the form must come back with a
  // complaint about that field and nothing else lost.
  await page.getByRole("button", { name: "Create property" }).click();
  await expect(page.getByText("English title is required.")).toBeVisible();

  for (const [label, expected] of [
    ["Slug", "e2e-form-reset-check"],
    ["Title (BG)", "Заглавие на български"],
    ["Description (BG)", "Описание на български."],
    ["Address", "ул. Тестова 9"],
    ["City", "Пловдив"],
    ["Rooms", "4"],
  ] as const) {
    await expect(page.getByLabel(label), label).toHaveValue(expected);
  }

  /*
   * The selects specifically. React restores a <select> to its MOUNT-time
   * defaultValue, so echoing a submitted value into defaultValue does
   * nothing — they have to be controlled, and only an assertion catches
   * the difference.
   */
  await expect(page.getByLabel("Property type")).toHaveValue("house");

  // And fixing only the offending field is enough to get through.
  await page.getByLabel("Title (EN)").fill("English title");
  await page.getByRole("button", { name: "Create property" }).click();
  await expect(page).toHaveURL(/\/admin\/properties$/);

  await prisma.property.deleteMany({ where: { slug: "e2e-form-reset-check" } });
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

test("a rejected lot form keeps the prices and dates already entered", async ({ page }) => {
  /*
   * The same reset, on the fields where retyping is most dangerous: a
   * price or a close date re-entered from memory is exactly where a
   * different number creeps in.
   */
  await signInAsAuctioneer(page);
  const property = await prisma.property.findFirstOrThrow({ where: { slug: SLUG } });

  await page.goto("/admin/lots/new");
  await page.getByLabel("Property").selectOption(property.id);
  await page.getByLabel("Lot number").fill("777");
  await page.getByLabel("Guide price").fill("123000");
  // Below the guide — refused by the cross-field rule.
  await page.getByLabel("Reserve price").fill("1000");

  await page.getByRole("button", { name: "Create lot" }).click();
  await expect(page.getByText(/reserve/i).first()).toBeVisible();

  await expect(page.getByLabel("Lot number")).toHaveValue("777");
  await expect(page.getByLabel("Guide price")).toHaveValue("123000");
  await expect(page.getByLabel("Property")).toHaveValue(property.id);
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

  /*
   * The legal pack. A lot cannot be published without the two documents
   * a bidder needs in order to decide — completeness only; nothing here
   * or in the gate looks at what they say.
   */
  await page.goto(`/admin/lots/${lot.id}`);
  await expect(page.getByText(/legal pack is missing/i)).toBeVisible();

  for (const [name, kind] of [
    ["notarialen-akt.pdf", "title_deed"],
    ["udostoverenie-tezhesti.pdf", "encumbrances"],
  ] as const) {
    await page.getByLabel("Add a document").setInputFiles({
      name,
      mimeType: "application/pdf",
      buffer: LEGAL_PACK_PDF,
    });
    await page.getByLabel("Document type").selectOption(kind);
    await page.getByRole("button", { name: /Upload document/i }).click();
    await expect(page.getByText(name)).toBeVisible();
  }

  await page.goto(`/admin/lots/${lot.id}`);
  await expect(page.getByText(/legal pack is missing/i)).toHaveCount(0);

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
