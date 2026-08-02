import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL!;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;

test("unauthenticated visitor to /admin is redirected to /admin/login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("admin can log in, reach the dashboard, and log out", async ({ page }) => {
  await page.goto("/admin/login");

  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(/\/admin\/login/, { timeout: 15_000 });
});

test("wrong password shows an error and does not log in", async ({ page }) => {
  await page.goto("/admin/login");

  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.locator(".admin-auth-error")).toHaveText("Invalid email or password.");
  await expect(page).toHaveURL(/\/admin\/login/);
});
