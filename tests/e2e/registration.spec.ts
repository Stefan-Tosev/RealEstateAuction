import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/*
 * The bidder registration journey, end to end: fill the form, follow the
 * emailed link, sign in.
 *
 * Runs serially and removes its own accounts, so the seeded catalogue
 * and the other specs are unaffected.
 *
 * Note the two-second wait before every submit. That is not padding for
 * flakiness — the server-issued form token enforces a minimum fill time
 * (§6), so submitting instantly is treated as a bot and silently
 * discarded. A test that skipped the wait would "pass" while creating
 * nothing.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const PREFIX = "pw-reg-";
const PASSWORD = "granite harbour lantern fold";

/** Older than the 2s minimum fill time the form token requires. */
async function respectTimeGate(page: Page) {
  await page.waitForTimeout(2500);
}

function dobYearsAgo(years: number, dayOffset = 0): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

async function fillIndividual(page: Page, email: string, overrides: Record<string, string> = {}) {
  await page.getByLabel("First name").fill(overrides.firstName ?? "Иван");
  await page.getByLabel("Last name").fill(overrides.lastName ?? "Петров");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Phone").fill(overrides.phone ?? "0888123456");
  await page.getByLabel("Date of birth").fill(overrides.dateOfBirth ?? dobYearsAgo(30));
  await page.getByLabel("Password").fill(overrides.password ?? PASSWORD);
  if (overrides.terms !== "skip") await page.getByLabel(/I agree to the Terms/).check();
}

/*
 * Mints a verification token the same way src/server/identity/verification.ts
 * does, writing only the SHA-256 hash.
 *
 * Deliberately reimplemented rather than imported: the app modules use
 * the "@/" path alias, which Playwright's loader does not resolve. It
 * also means the test independently asserts the storage format — a row
 * holding plaintext would make this fail.
 */
async function mintVerificationToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: createHash("sha256").update(token, "utf8").digest("hex"),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

async function cleanup() {
  await prisma.outbox.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

test.beforeAll(cleanup);

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test.describe("the form itself", () => {
  test("renders in both languages", async ({ page }) => {
    await page.goto("/en/register");
    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();

    await page.goto("/bg/register");
    await expect(page.getByRole("heading", { name: "Създайте профил" })).toBeVisible();
  });

  test("consent boxes start unticked and marketing is separately refusable", async ({ page }) => {
    // Pre-ticked consent is invalid under GDPR.
    await page.goto("/en/register");

    await expect(page.getByLabel(/I agree to the Terms/)).not.toBeChecked();
    await expect(page.getByLabel(/notifications about new lots/)).not.toBeChecked();
  });

  test("company fields appear only for a company account", async ({ page }) => {
    await page.goto("/en/register");
    await expect(page.getByTestId("company-fields")).toHaveCount(0);

    await page.getByRole("button", { name: "Company" }).click();
    await expect(page.getByTestId("company-fields")).toBeVisible();
    await expect(page.getByLabel("EIK / BULSTAT")).toBeVisible();

    // Switching back must hide them again — a populated hidden field
    // produces a form that fails with no visible reason.
    await page.getByRole("button", { name: "Individual" }).click();
    await expect(page.getByTestId("company-fields")).toHaveCount(0);
  });

  test("the honeypot is present but not reachable by a person", async ({ page }) => {
    await page.goto("/en/register");

    const honeypot = page.locator('input[name="website"]');
    await expect(honeypot).toHaveCount(1);

    /*
     * Positioned off-screen rather than display:none, on purpose — many
     * bots skip fields that are display:none but will happily fill a
     * positioned one, which is the entire point of the trap.
     *
     * So the assertion is not toBeVisible(): Playwright judges that on
     * display and visibility, not on where the element sits, and an
     * off-screen input counts as visible to it. What actually protects a
     * person is that it is outside the viewport, hidden from assistive
     * technology, and not in the tab order.
     */
    const box = await honeypot.boundingBox();
    expect(box, "honeypot should have a box but be off-screen").not.toBeNull();
    expect(box!.x + box!.width).toBeLessThan(0);

    await expect(honeypot).toHaveAttribute("tabindex", "-1");
    await expect(page.locator('.honeypot[aria-hidden="true"]')).toHaveCount(1);
  });

  test("the password hint warns about typing it elsewhere", async ({ page }) => {
    // Stefan's concern about Cyrillic keyboards, answered with guidance
    // rather than a charset restriction.
    await page.goto("/en/register");
    await expect(page.getByText(/type it on every device you sign in from/i)).toBeVisible();
  });
});

test.describe("validation", () => {
  test("shows field errors in the page's language, from API codes", async ({ page }) => {
    await page.goto("/en/register");
    await respectTimeGate(page);

    // Underage, and terms not accepted.
    await fillIndividual(page, `${PREFIX}underage@example.bg`, {
      dateOfBirth: dobYearsAgo(18, 1),
      terms: "skip",
    });
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("You must be at least 18.")).toBeVisible();
    await expect(page.getByText("You must accept the Terms and Conditions.")).toBeVisible();

    expect(await prisma.user.count({ where: { email: `${PREFIX}underage@example.bg` } })).toBe(0);
  });

  test("renders the same errors in Bulgarian", async ({ page }) => {
    /*
     * The API returns codes, never prose — this is what proves it. An
     * English message from the server would appear untranslated here.
     */
    await page.goto("/bg/register");
    await respectTimeGate(page);

    // Exact names, including the required-marker asterisk: "Име" is a
    // substring of "Имейл", so a loose match hits both.
    await page.getByLabel("Име*", { exact: true }).fill("Иван");
    await page.getByLabel("Фамилия*", { exact: true }).fill("Петров");
    await page.getByLabel("Имейл*", { exact: true }).fill(`${PREFIX}bg@example.bg`);
    await page.getByLabel("Телефон*", { exact: true }).fill("0888123456");
    await page.getByLabel("Дата на раждане*", { exact: true }).fill(dobYearsAgo(18, 1));
    await page.getByLabel("Парола*", { exact: true }).fill(PASSWORD);
    await page.getByLabel(/Съгласен съм/).check();
    await page.getByRole("button", { name: "Създай профил" }).click();

    await expect(page.getByText("Трябва да сте навършили 18 години.")).toBeVisible();
  });

  test("rejects a short password and a bad ЕИК together", async ({ page }) => {
    await page.goto("/en/register");
    await respectTimeGate(page);

    await page.getByRole("button", { name: "Company" }).click();
    await fillIndividual(page, `${PREFIX}company@example.bg`, { password: "elevenchars" });
    await page.getByLabel("Company name").fill("Тест ЕООД");
    // Transposed digits — exactly what the mod-11 checksum catches.
    await page.getByLabel("EIK / BULSTAT").fill("831641719");

    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText(/password is too short/i)).toBeVisible();
    await expect(page.getByText(/checksum does not match/i)).toBeVisible();
  });
});

test.describe("the happy path", () => {
  const email = `${PREFIX}journey@example.bg`;

  test("registers, verifies and signs in", async ({ page }) => {
    await page.goto("/en/register");
    await respectTimeGate(page);
    await fillIndividual(page, email);
    await page.getByRole("button", { name: "Create account" }).click();

    // The confirmation is deliberately conditional — it must not reveal
    // whether the address was already registered.
    await expect(page.getByTestId("registration-sent")).toBeVisible();
    await expect(page.getByText(/If that address can be used/i)).toBeVisible();

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { verificationTokens: true, consents: true },
    });
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.phone).toBe("+359888123456");
    expect(user.consents).toHaveLength(2);

    // An unverified account must not be able to sign in.
    await page.goto("/en/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/Wrong email or password, or the account is not confirmed/i)).toBeVisible();

    /*
     * Follow the link the way the recipient would. The plaintext token
     * only ever exists in the message, so the test regenerates one the
     * same way the service does rather than reading it from the row —
     * the row holds a hash by design.
     */
    const token = await mintVerificationToken(user.id);

    await page.goto(`/en/verify?token=${token}`);
    await expect(page.getByTestId("verify-message")).toHaveAttribute("data-ok", "true");

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt,
    ).not.toBeNull();

    // And now sign-in works.
    await page.goto("/en/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/en\/lots$/);
  });

  test("a verification link cannot be used twice", async ({ page }) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const token = await mintVerificationToken(user.id);

    await page.goto(`/en/verify?token=${token}`);
    await expect(page.getByTestId("verify-message")).toHaveAttribute("data-ok", "true");

    // Single use: a replayed link must not silently succeed.
    await page.goto(`/en/verify?token=${token}`);
    await expect(page.getByTestId("verify-message")).toHaveAttribute("data-ok", "false");
    await expect(page.getByText(/already been used/i)).toBeVisible();
  });

  test("an unknown token is refused", async ({ page }) => {
    await page.goto("/en/verify?token=not-a-real-token");
    await expect(page.getByTestId("verify-message")).toHaveAttribute("data-ok", "false");
  });

  test("a missing token says so rather than failing obscurely", async ({ page }) => {
    await page.goto("/en/verify");
    await expect(page.getByText(/No confirmation code supplied/i)).toBeVisible();
  });
});

test.describe("bot defences", () => {
  test("a filled honeypot looks like success but creates nothing", async ({ page }) => {
    const email = `${PREFIX}honeypot@example.bg`;

    await page.goto("/en/register");
    await respectTimeGate(page);
    await fillIndividual(page, email);
    // Fill the trap the way a naive bot would.
    await page.locator('input[name="website"]').fill("http://spam.example", { force: true });

    await page.getByRole("button", { name: "Create account" }).click();

    // Never reveal the trap.
    await expect(page.getByTestId("registration-sent")).toBeVisible();
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  test("cannot be submitted before the form has hydrated", async ({ page }) => {
    /*
     * The form posts JSON, so its handler only exists once React has
     * taken over. A click before that did a native browser submit: the
     * page reloaded and everything typed was lost, with nothing to
     * explain why.
     *
     * Invisible in development, where the page is slow enough that
     * hydration always wins — it only appeared against a production
     * build, which is to say on fast connections.
     */
    await page.goto("/en/register", { waitUntil: "commit" });

    const submit = page.getByRole("button", { name: "Create account" });
    await expect(submit).toBeDisabled();

    // And becomes usable once hydrated.
    await expect(submit).toBeEnabled({ timeout: 15_000 });
  });

  /*
   * The §6 time gate itself is covered deterministically in
   * tests/unit/registration.test.ts — too fast, forged, expired and
   * absent tokens all have their own case there.
   *
   * It is deliberately not tested through the UI: doing so races
   * hydration against a two-second wall clock, which is a flaky test
   * that proves less than the unit ones already do.
   */
});

test.describe("session separation", () => {
  test("a bidder cannot reach the admin area", async ({ page }) => {
    /*
     * The boundary that matters. requireAdmin() asserts kind === "admin"
     * rather than inferring authority from a role field, and this is the
     * end-to-end proof.
     */
    const email = `${PREFIX}journey@example.bg`;

    await page.goto("/en/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/en\/lots$/);

    // Signed in as a bidder, /admin must not open.
    await page.goto("/admin/lots");
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
