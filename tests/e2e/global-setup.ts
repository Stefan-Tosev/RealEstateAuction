import { request } from "@playwright/test";

/*
 * Warms the dev server's route compilation before any test runs.
 *
 * `next dev` compiles each route the first time it is requested. With
 * fifteen-odd routes that cost lands inside whichever assertion happens
 * to hit them first, racing the expect timeout — from a cold .next only
 * 12 of 59 tests finished inside ten minutes, and the failures looked
 * like broken pages rather than a slow build.
 *
 * Paying it here instead, once and sequentially, takes it off the
 * critical path entirely.
 *
 * Not needed against a production build, where everything is compiled
 * ahead of time — playwright.prod.config.ts skips this.
 */

/*
 * Keep this in step with the routes the suite touches. It fell behind
 * once already: pass 3 added registration, sign-in, verification and the
 * document API, none of which were listed, and a cold run went from
 * 4.6 minutes to 26 with 46 tests timing out on compiles they were
 * paying for themselves.
 *
 * Admin pages cannot be warmed from here — they redirect without a
 * session — so their first hit still pays, which is what the 90s
 * per-test timeout is for.
 */
const ROUTES = [
  // Public catalogue
  "/bg/lots",
  "/en/lots",
  "/bg/lots/dvustaen-karshiyaka-plovdiv",
  "/en/lots/dvustaen-karshiyaka-plovdiv",
  "/bg/lots/does-not-exist", // the not-found boundary

  // Accounts
  "/bg/register",
  "/en/register",
  "/bg/sign-in",
  "/en/sign-in",
  "/bg/verify",
  "/en/verify",

  // Route handlers
  "/api/time",
  "/robots.txt",
  "/sitemap.xml",
  // Media and documents are both served by route handlers, so both compile.
  "/media/properties/dvustaen-karshiyaka-plovdiv/01.jpg",
  "/api/documents/00000000-0000-0000-0000-000000000000",

  "/admin/login",
];

/*
 * Re-seed before warming.
 *
 * The catalogue's close dates are stored as offsets from seed time, so a
 * database seeded yesterday has lots that have since closed — and the
 * suite then fails on countdowns and urgency badges with nothing
 * actually broken. That cost a full debugging round: "Приключил" where a
 * ticking clock was expected looks exactly like a bug.
 *
 * The seed is idempotent and upserts by natural key, so this refreshes
 * the timings without disturbing anything a spec creates for itself.
 */
async function reseed() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");

  try {
    await promisify(execFile)("npm", ["run", "db:seed"], { shell: true, timeout: 60_000 });
    console.log("[global-setup] re-seeded the catalogue");
  } catch (error) {
    // Not fatal: a spec that needs the data will fail with a far more
    // specific message than anything this could print.
    console.warn("[global-setup] re-seed failed:", (error as Error).message.split("\n")[0]);
  }
}

export default async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const context = await request.newContext({ baseURL });

  await reseed();

  const startedAt = Date.now();

  for (const route of ROUTES) {
    try {
      // Generous per-route budget: a first compile can take many seconds.
      await context.get(route, { timeout: 60_000, failOnStatusCode: false });
    } catch {
      // A route that will not warm is not a setup failure — let the test
      // that actually depends on it report the problem properly.
    }
  }

  console.log(`[global-setup] warmed ${ROUTES.length} routes in ${Date.now() - startedAt}ms`);
  await context.dispose();
}
