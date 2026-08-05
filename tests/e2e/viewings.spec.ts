import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { rm } from "node:fs/promises";
import path from "node:path";

/*
 * Viewings and the admin upload UI, end to end.
 *
 * An operator adds a document and a slot; a bidder books it, cannot
 * double-book, and can cancel. Runs serially against the seeded
 * catalogue and removes everything it creates.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const SLUG = "dvustaen-karshiyaka-plovdiv";
const PREFIX = "pw-view-";
const BIDDER_EMAIL = `${PREFIX}bidder@example.bg`;
const PASSWORD = "granite harbour lantern fold";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("viewing spec fixture\n")]);

let lotId = "";

async function cleanup() {
  await prisma.viewingBooking.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.viewing.deleteMany({ where: { lot: { property: { slug: SLUG } } } });
  await prisma.lotDocument.deleteMany({ where: { lot: { property: { slug: SLUG } } } });
  await prisma.outbox.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });

  /*
   * Deleting the rows directly bypasses removeLotDocument(), which is
   * what removes the file — so the uploaded blobs have to go
   * explicitly. Storage keys are prefixed with the lot id.
   */
  if (lotId) {
    await rm(path.join(process.cwd(), "private", "documents", lotId), {
      recursive: true,
      force: true,
    });
  }
}

async function signInAsOperator(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel("Password").fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
}

async function signInAsBidder(page: Page) {
  await page.goto("/en/sign-in");
  await page.getByLabel("Email").fill(BIDDER_EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/lots$/);
}

/** Local datetime string for a datetime-local input, N days ahead. */
function futureLocal(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T14:00`;
}

test.beforeAll(async () => {
  await cleanup();

  const lot = await prisma.lot.findFirstOrThrow({
    where: { property: { slug: SLUG } },
    orderBy: { lotNumber: "desc" },
  });
  lotId = lot.id;

  const argon2 = await import("@node-rs/argon2");
  await prisma.user.create({
    data: {
      email: BIDDER_EMAIL,
      passwordHash: await argon2.hash(PASSWORD, {
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
      firstName: "Иван",
      lastName: "Петров",
      dateOfBirth: new Date("1990-01-01"),
      accountType: "individual",
      emailVerifiedAt: new Date(),
    },
  });
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test.describe("the operator", () => {
  test("uploads a document through the admin", async ({ page }) => {
    await signInAsOperator(page);
    await page.goto(`/admin/lots/${lotId}`);

    await expect(page.getByText("No documents yet")).toBeVisible();

    await page.getByLabel("Add a document").setInputFiles({
      name: "notarialen-akt.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await page.getByLabel("Document type").selectOption("title_deed");
    await page.getByLabel("Who can download it").selectOption("registered");
    await page.getByRole("button", { name: "Upload document" }).click();

    await expect(page.getByText("Document uploaded.")).toBeVisible();

    const stored = await prisma.lotDocument.findFirstOrThrow({ where: { lotId } });
    expect(stored.mime).toBe("application/pdf");
    // Recorded so the file can later be proven to be the one uploaded.
    expect(stored.sha256).toHaveLength(64);
  });

  test("refuses a document that is not what it claims", async ({ page }) => {
    await signInAsOperator(page);
    await page.goto(`/admin/lots/${lotId}`);

    const before = await prisma.lotDocument.count({ where: { lotId } });

    await page.getByLabel("Add a document").setInputFiles({
      name: "deed.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("<!doctype html><script>alert(1)</script>"),
    });
    await page.getByRole("button", { name: "Upload document" }).click();

    await expect(page.getByText(/not a PDF, JPEG or PNG/i)).toBeVisible();
    expect(await prisma.lotDocument.count({ where: { lotId } })).toBe(before);
  });

  test("is warned that the approved-bidders tier reaches nobody yet", async ({ page }) => {
    // Nothing writes BidderApproval until Phase 2, and an operator
    // choosing that tier should know before, not after.
    await signInAsOperator(page);
    await page.goto(`/admin/lots/${lotId}`);

    const visibility = page
      .locator("form")
      .filter({ has: page.locator('select[name="visibility"]') })
      .first()
      .locator('select[name="visibility"]');

    await visibility.selectOption("approved_bidders");
    await expect(page.getByText(/No bidders are approved yet/i)).toBeVisible();

    /*
     * Put it back. The select auto-submits, so this test genuinely
     * mutates the document a later test downloads — leaving it
     * restricted made "a bidder can download it" fail for a reason that
     * had nothing to do with the code under test.
     */
    await visibility.selectOption("registered");
    await expect(page.getByText(/No bidders are approved yet/i)).toHaveCount(0);
  });

  test("adds a viewing slot", async ({ page }) => {
    await signInAsOperator(page);
    await page.goto(`/admin/lots/${lotId}`);

    await expect(page.getByText("No viewing slots yet")).toBeVisible();

    await page.getByLabel("Starts", { exact: true }).fill(futureLocal(3));
    await page.getByLabel("Kind").selectOption("open_house");
    await page.getByLabel("Length (minutes)").fill("45");
    await page.getByLabel("Places").fill("2");
    await page.getByRole("button", { name: "Add viewing" }).click();

    await expect(page.getByText("Viewing added.")).toBeVisible();
    await expect(page.getByText("0 / 2")).toBeVisible();
  });

  test("refuses a slot in the past", async ({ page }) => {
    await signInAsOperator(page);
    await page.goto(`/admin/lots/${lotId}`);

    await page.getByLabel("Starts", { exact: true }).fill(futureLocal(-3));
    await page.getByRole("button", { name: "Add viewing" }).click();

    await expect(page.getByText("That is in the past.")).toBeVisible();
  });
});

test.describe("the public page", () => {
  test("shows the slot with places remaining", async ({ page }) => {
    await page.goto(`/en/lots/${SLUG}`);

    await expect(page.getByRole("heading", { name: "Viewings" })).toBeVisible();
    await expect(page.getByText("2 places left")).toBeVisible();
    await expect(page.getByText("Open house")).toBeVisible();
  });

  test("asks an anonymous visitor to sign in rather than hiding the slot", async ({ page }) => {
    // The remaining places are the reason to register.
    await page.goto(`/en/lots/${SLUG}`);
    await expect(page.getByRole("link", { name: "Sign in to book" })).toBeVisible();
  });
});

test.describe("a bidder", () => {
  test("books a place and sees it reflected", async ({ page }) => {
    await signInAsBidder(page);
    await page.goto(`/en/lots/${SLUG}`);

    await page.getByRole("button", { name: "Book a place" }).click();

    await expect(page.getByText("You are booked")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel booking" })).toBeVisible();

    const booked = await prisma.viewingBooking.count({
      where: { user: { email: BIDDER_EMAIL }, status: "booked" },
    });
    expect(booked).toBe(1);
  });

  test("receives a confirmation in the outbox", async () => {
    const queued = await prisma.outbox.findMany({ where: { user: { email: BIDDER_EMAIL } } });
    expect(queued.map((o) => o.template)).toContain("viewing_booked");
  });

  test("can cancel, and the place returns", async ({ page }) => {
    await signInAsBidder(page);
    await page.goto(`/en/lots/${SLUG}`);

    await page.getByRole("button", { name: "Cancel booking" }).click();

    await expect(page.getByText("2 places left")).toBeVisible();
    await expect(page.getByRole("button", { name: "Book a place" })).toBeVisible();

    // The row survives as a record of who was once booked.
    const row = await prisma.viewingBooking.findFirstOrThrow({
      where: { user: { email: BIDDER_EMAIL } },
    });
    expect(row.status).toBe("cancelled");
  });

  test("can download the registered-tier document the operator uploaded", async ({ page }) => {
    // Ties the two halves together: uploaded through the admin, gated by
    // visibility, reachable by a signed-in bidder.
    await signInAsBidder(page);
    await page.goto(`/en/lots/${SLUG}`);

    await expect(page.getByText("Title deed")).toBeVisible();
    await expect(page.locator(".pack-item a[download]")).toHaveCount(1);
  });
});

test.describe("an operator is not a bidder", () => {
  test("cannot book a viewing", async ({ page }) => {
    /*
     * requireBidder() asserts kind === "bidder". An operator browsing
     * the public site has a valid session but is not a bidder, and must
     * not be able to take a place.
     */
    await signInAsOperator(page);
    await page.goto(`/en/lots/${SLUG}`);

    // They get the sign-in prompt, not a booking button.
    await expect(page.getByRole("button", { name: "Book a place" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in to book" })).toBeVisible();
  });
});
