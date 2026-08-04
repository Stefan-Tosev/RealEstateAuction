import "dotenv/config";
import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Pre-installed Chromium in some sandboxed dev environments may be a
// different revision than this package.json's @playwright/test expects.
// Fall back to it only if present; real dev machines resolve normally.
const preinstalledChromium = "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  /*
   * Runs headless — that is Playwright's default and nothing here
   * overrides it. `npm run test:e2e` needs no flags.
   */

  /*
   * `next dev` compiles each route on first request, and that cost lands
   * inside whichever assertion happens to reach it first. Against the 5s
   * default a warm run left ~0.5s of headroom and a cold one failed
   * outright, surfacing as "login didn't redirect" — an auth bug to read,
   * a build delay in fact.
   *
   * global-setup.ts now pays most of that up front, but the admin pages
   * cannot be warmed without a session, so the headroom stays.
   */
  expect: { timeout: 15_000 },

  /*
   * Per-test budget. The default 30s is not enough for the first test to
   * touch an uncompiled admin route: it pays the compile *and* does the
   * Argon2 work of a sign-in. Only the first test in each area is ever
   * this slow, so the raised ceiling costs nothing on a warm run.
   */
  timeout: 90_000,

  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    ...(existsSync(preinstalledChromium)
      ? { launchOptions: { executablePath: preinstalledChromium } }
      : {}),
  },
  webServer: {
    command: "npm run dev",
    /*
     * The readiness probe must hit the CHEAPEST route, not a
     * representative one.
     *
     * Playwright polls this with a 3s per-request timeout. Pointed at
     * /bg/lots it never succeeded on a cold .next — that route compiles
     * middleware, a layout and a database query, which takes far longer
     * than 3s — so the probe just retried until it gave up and no test
     * ever ran. /api/time compiles almost instantly and touches nothing.
     *
     * Warming the real routes is global-setup.ts's job, where each one
     * gets a 60s budget instead of 3.
     */
    url: "http://localhost:3000/api/time",
    reuseExistingServer: true,
    // A cold `next dev` boot can take a while before it serves anything.
    timeout: 180_000,
  },
});
