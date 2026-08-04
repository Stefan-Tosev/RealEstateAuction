import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/*
 * The legal pack on a lot page, and the download route behind it.
 *
 * Seeds one document per visibility tier against the existing catalogue,
 * so the gating is exercised against real rows and real bytes rather
 * than mocks, then removes them again.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const SLUG = "dvustaen-karshiyaka-plovdiv";
const PREFIX = "pw-doc-";
const BIDDER_EMAIL = `${PREFIX}bidder@example.bg`;
const BIDDER_PASSWORD = "granite harbour lantern fold";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("legal pack test bytes\n")]);
const DOCUMENT_ROOT = path.join(process.cwd(), "private", "documents");

const ids: Record<string, string> = {};

async function seedDocument(
  lotId: string,
  adminId: string,
  visibility: "public" | "registered" | "approved_bidders",
  kind: "title_deed" | "sketch" | "encumbrances",
  filename: string,
) {
  const storageKey = `${PREFIX}${visibility}.pdf`;
  const target = path.join(DOCUMENT_ROOT, storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, PDF);

  const row = await prisma.lotDocument.create({
    data: {
      lotId,
      kind,
      filename,
      storageKey,
      size: BigInt(PDF.byteLength),
      mime: "application/pdf",
      sha256: createHash("sha256").update(PDF).digest("hex"),
      visibility,
      uploadedBy: adminId,
    },
  });

  ids[visibility] = row.id;
}

async function cleanup() {
  await prisma.lotDocument.deleteMany({ where: { storageKey: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  for (const visibility of ["public", "registered", "approved_bidders"]) {
    await rm(path.join(DOCUMENT_ROOT, `${PREFIX}${visibility}.pdf`), { force: true });
  }
}

async function signInAsBidder(page: Page) {
  await page.goto("/en/sign-in");
  await page.getByLabel("Email").fill(BIDDER_EMAIL);
  await page.getByLabel("Password").fill(BIDDER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/lots$/);
}

test.beforeAll(async () => {
  await cleanup();

  const admin = await prisma.adminUser.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const lot = await prisma.lot.findFirstOrThrow({
    where: { property: { slug: SLUG } },
    orderBy: { lotNumber: "desc" },
  });

  await seedDocument(lot.id, admin.id, "public", "sketch", "скица-публична.pdf");
  await seedDocument(lot.id, admin.id, "registered", "encumbrances", "тежести-ул-Съборна-14.pdf");
  await seedDocument(lot.id, admin.id, "approved_bidders", "title_deed", "нотариален-акт.pdf");

  /*
   * Hashed with the same library and parameters as
   * src/server/identity/password.ts. Imported directly rather than
   * through the app module because Playwright's loader does not resolve
   * the "@/" alias — if those parameters ever diverge, this bidder
   * simply fails to sign in and the tests say so loudly.
   */
  const argon2 = await import("@node-rs/argon2");
  await prisma.user.create({
    data: {
      email: BIDDER_EMAIL,
      passwordHash: await argon2.hash(BIDDER_PASSWORD, {
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

test.describe("an anonymous visitor", () => {
  test("sees every document listed, with kinds", async ({ page }) => {
    /*
     * The gate exists to capture leads (§5). Hiding the restricted rows
     * would mean nobody ever learns there is a pack worth registering
     * for.
     */
    await page.goto(`/en/lots/${SLUG}`);

    await expect(page.getByRole("heading", { name: "Legal pack" })).toBeVisible();
    await expect(page.locator(".pack-item")).toHaveCount(3);
    await expect(page.getByText("Cadastral sketch")).toBeVisible();
    await expect(page.getByText("Encumbrances certificate")).toBeVisible();
    await expect(page.getByText("Title deed")).toBeVisible();
  });

  test("is not shown the filenames of gated documents", async ({ page }) => {
    // Kinds are generic; filenames carry addresses and owner names.
    const body = await (await page.request.get(`/en/lots/${SLUG}`)).text();

    expect(body).toContain("скица-публична.pdf");
    expect(body).not.toContain("Съборна-14");
    expect(body).not.toContain("нотариален-акт.pdf");
  });

  test("can download the public document but not the others", async ({ page }) => {
    await page.goto(`/en/lots/${SLUG}`);

    const rows = page.locator(".pack-item");

    /*
     * Both gated rows say "sign in", including the approved-bidders one.
     * That is the correct next step for someone signed out — telling
     * them they also need approval, before they even have an account, is
     * noise. "Available to approved bidders" appears once signing in is
     * no longer the blocker.
     */
    await expect(rows.filter({ hasText: "Sign in to download" })).toHaveCount(2);
    await expect(rows.filter({ hasText: "Available to approved bidders" })).toHaveCount(0);

    // Exactly one real download link.
    await expect(page.locator(".pack-item a[download]")).toHaveCount(1);
  });
});

test.describe("a signed-in bidder", () => {
  test("gains the registered tier but not the approved one", async ({ page }) => {
    await signInAsBidder(page);
    await page.goto(`/en/lots/${SLUG}`);

    // Two downloadable now; the approved-bidders tier stays shut because
    // nothing writes BidderApproval until Phase 2.
    await expect(page.locator('.pack-item a[download]')).toHaveCount(2);
    await expect(page.getByText("Available to approved bidders")).toBeVisible();
  });

  test("sees the filename only for what they can open", async ({ page }) => {
    await signInAsBidder(page);
    const body = await (await page.request.get(`/en/lots/${SLUG}`)).text();

    expect(body).toContain("Съборна-14");
    // Still withheld: they cannot download it.
    expect(body).not.toContain("нотариален-акт.pdf");
  });
});

test.describe("the download route", () => {
  test("serves as an attachment, never inline", async ({ page }) => {
    /*
     * §5: never render a user-supplied PDF inline from our own origin —
     * a crafted PDF would run script with this site's cookies.
     */
    await page.goto(`/en/lots/${SLUG}`);
    const href = await page.locator('.pack-item a[download]').first().getAttribute("href");

    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);

    const headers = response.headers();
    expect(headers["content-disposition"]).toContain("attachment");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-security-policy"]).toContain("sandbox");
    expect(headers["cache-control"]).toContain("no-store");
  });

  test("refuses an unsigned link", async ({ page }) => {
    const response = await page.request.get(`/api/documents/${ids.public}`);
    expect(response.status()).toBe(404);
  });

  test("refuses a tampered signature", async ({ page }) => {
    await page.goto(`/en/lots/${SLUG}`);
    const href = await page.locator('.pack-item a[download]').first().getAttribute("href");

    const tampered = href!.replace(/sig=[^&]+/, "sig=forged");
    expect((await page.request.get(tampered)).status()).toBe(404);
  });

  test("answers 404, not 403, for a document the caller may not have", async ({ page }) => {
    /*
     * A 403 would confirm the document exists — and that a given lot has
     * an encumbrances certificate is itself information.
     */
    const response = await page.request.get(`/api/documents/${ids.approved_bidders}`);
    expect(response.status()).toBe(404);
  });

  test("a link minted for one viewer does not work for another", async ({ browser, page }) => {
    // Signed links are bound to the viewer, so forwarding one gains
    // nothing.
    await signInAsBidder(page);
    await page.goto(`/en/lots/${SLUG}`);

    const hrefs = await page.locator('.pack-item a[download]').evaluateAll((links) =>
      links.map((l) => (l as HTMLAnchorElement).getAttribute("href")),
    );
    const registeredLink = hrefs.find((h) => h?.includes(ids.registered));
    expect(registeredLink, "expected a link to the registered-tier document").toBeTruthy();

    // A fresh context is an anonymous visitor.
    const anon = await browser.newContext();
    expect((await anon.request.get(registeredLink!)).status()).toBe(404);
    await anon.close();
  });
});
