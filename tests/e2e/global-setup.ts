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

const ROUTES = [
  "/bg/lots",
  "/en/lots",
  "/bg/lots/dvustaen-karshiyaka-plovdiv",
  "/en/lots/dvustaen-karshiyaka-plovdiv",
  "/bg/lots/does-not-exist", // the not-found boundary
  "/api/time",
  "/robots.txt",
  "/sitemap.xml",
  "/admin/login",
  // Media is served by a route handler, so it compiles too.
  "/media/properties/dvustaen-karshiyaka-plovdiv/01.jpg",
];

export default async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const context = await request.newContext({ baseURL });

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
