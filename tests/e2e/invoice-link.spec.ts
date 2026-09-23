import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { formatMoney } from "../../src/lib/money";
import { signInvoicePath } from "../../src/server/fees/invoice-link";

/*
 * The public invoice page, reached only through a signed link.
 *
 * The signature is the whole of the authorisation — a seller has no
 * account — so the cases that matter are the ones where it is wrong:
 * tampered, missing, expired, or genuine but for a different invoice.
 * Each must show nothing of the invoice, and all but "expired" must be
 * indistinguishable from a page that does not exist.
 *
 * The invoice is inserted directly with a number outside the real
 * series, so the gapless InvoiceCounter is never touched.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const SLUG = "dvustaen-karshiyaka-plovdiv";
const NUMBER = `PW-INV-${Date.now()}`;
const BILLED = "Пробен Продавач ЕООД";
const TOTAL = 123457n + 24691n;

let invoiceId = "";
let otherInvoiceId = "";
let sellerId = "";

test.beforeAll(async () => {
  const lot = await prisma.lot.findFirstOrThrow({
    where: { property: { slug: SLUG } },
    select: { id: true },
  });

  // The schema requires an invoice to bill exactly one party.
  const seller = await prisma.seller.create({ data: { name: BILLED } });
  sellerId = seller.id;

  const invoice = await prisma.invoice.create({
    data: {
      number: NUMBER,
      sellerId,
      series: "PW",
      billedName: BILLED,
      billedAddress: "ул. Тестова 1, Пловдив",
      billedEik: "121212129",
      netMinor: 123457n,
      vatMinor: 24691n,
    },
  });
  invoiceId = invoice.id;

  await prisma.fee.create({
    data: {
      lotId: lot.id,
      party: "seller",
      kind: "withdrawal",
      basis: "fixed",
      netMinor: 123457n,
      vatMinor: 24691n,
      sellerId,
      invoiceId,
    },
  });

  const other = await prisma.invoice.create({
    data: {
      number: `${NUMBER}-B`,
      sellerId,
      series: "PW",
      billedName: "Друг Получател АД",
      netMinor: 100n,
      vatMinor: 20n,
    },
  });
  otherInvoiceId = other.id;
});

test.afterAll(async () => {
  // Keyed on values set before any insert, so a half-finished setup still cleans up.
  await prisma.fee.deleteMany({ where: { invoice: { number: { startsWith: NUMBER } } } });
  await prisma.invoice.deleteMany({ where: { number: { startsWith: NUMBER } } });
  if (sellerId) await prisma.seller.delete({ where: { id: sellerId } });
  await prisma.$disconnect();
});

/** Nothing identifying the invoice may appear on a refused page. */
async function expectNothingDisclosed(body: string) {
  expect(body).not.toContain(NUMBER);
  expect(body).not.toContain(BILLED);
  expect(body).not.toContain("121212129");
  expect(body).not.toContain(formatMoney(TOTAL, "bg"));
  expect(body).not.toContain(formatMoney(TOTAL, "en"));
}

test("a genuine link shows the invoice to its recipient", async ({ page }) => {
  const response = await page.goto(`/bg${signInvoicePath(invoiceId)}`);
  expect(response?.status()).toBe(200);

  await expect(page.locator(".invoice-number")).toContainText(NUMBER);
  await expect(page.getByText(BILLED)).toBeVisible();
  await expect(page.locator(".invoice-lines tbody tr")).toHaveCount(1);
  await expect(page.locator(".invoice-total")).toContainText(formatMoney(TOTAL, "bg"));

  // A bearer link to somebody's invoice must never be indexed.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  // The specimen stamp tracks the flag exactly — present in demo, absent otherwise.
  const demo = process.env.INVOICE_DEMO_MODE === "true";
  await expect(page.locator(".invoice-specimen")).toHaveCount(demo ? 1 : 0);
});

test("the locale is not signed, so a forwarded link can switch language", async ({ page }) => {
  const response = await page.goto(`/en${signInvoicePath(invoiceId)}`);
  expect(response?.status()).toBe(200);
  await expect(page.locator(".invoice-number")).toContainText(`Invoice No ${NUMBER}`);
});

test("a tampered signature is a 404 and discloses nothing", async ({ page }) => {
  const path = signInvoicePath(invoiceId);
  const sig = new URL(path, "http://x").searchParams.get("sig")!;
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);

  const response = await page.goto(`/bg${path.replace(sig, flipped)}`);
  expect(response?.status()).toBe(404);
  await expectNothingDisclosed(await page.content());
});

test("a link with no signature is a 404", async ({ page }) => {
  const response = await page.goto(`/bg/invoices/${invoiceId}`);
  expect(response?.status()).toBe(404);
  await expectNothingDisclosed(await page.content());
});

test("a stretched expiry breaks the signature rather than extending the link", async ({ page }) => {
  const path = signInvoicePath(invoiceId);
  const exp = new URL(path, "http://x").searchParams.get("exp")!;
  const later = String(Number(exp) + 86_400_000);

  const response = await page.goto(`/bg${path.replace(`exp=${exp}`, `exp=${later}`)}`);
  expect(response?.status()).toBe(404);
  await expectNothingDisclosed(await page.content());
});

test("a genuine signature for one invoice does not open another", async ({ page }) => {
  const path = signInvoicePath(otherInvoiceId).replace(otherInvoiceId, invoiceId);
  const response = await page.goto(`/bg${path}`);
  expect(response?.status()).toBe(404);
  await expectNothingDisclosed(await page.content());
});

test("a validly signed link to an invoice that does not exist is a 404", async ({ page }) => {
  const response = await page.goto(`/bg${signInvoicePath(randomUUID())}`);
  expect(response?.status()).toBe(404);
});

test("an expired genuine link says so, and shows nothing else", async ({ page }) => {
  // Signed 31 days ago, so it lapsed a day ago.
  const path = signInvoicePath(invoiceId, Date.now() - 31 * 86_400_000);

  await page.goto(`/en${path}`);
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
  await expectNothingDisclosed(await page.content());
});
