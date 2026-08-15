import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

/*
 * The same suite, run against a production build instead of `next dev`.
 *
 * This exists because of a real escape: Auth.js trusts the request Host
 * implicitly in development and validates it in production, so admin
 * login worked under every `npm run test:e2e` and failed outright under
 * `next start` — a deploy-day outage that no amount of dev-server
 * testing could surface.
 *
 * Other things only production mode exercises: minified client bundles,
 * no React strict-mode double-render, real static/dynamic route
 * decisions, and next/font resolved at build time.
 *
 * Run with `npm run test:e2e:prod`, which builds first. A separate
 * config rather than an env var because inline `VAR=x cmd` in an npm
 * script is not portable to Windows.
 *
 * One trap worth knowing: this leaves a production build in `.next`, and
 * a subsequent `npm run test:e2e` makes `next dev` recompile everything
 * from it. That run takes minutes rather than seconds and blows the
 * expect timeout on most specs — 40 spurious failures, with nothing
 * actually broken. Run `npm run clean` between the two.
 */
export default defineConfig({
  ...baseConfig,
  /*
   * Lets a spec tell which build it is running against.
   *
   * Read as test.info().config.metadata.mode. Metadata rather than an
   * environment variable because inline `VAR=x cmd` in an npm script is
   * not portable to Windows — the same reason this config exists at all.
   *
   * Needed because `next dev` serialises server-component data into the
   * RSC payload that production omits, so a handful of assertions about
   * what reaches the browser are only true of the artefact that ships.
   */
  metadata: { mode: "prod" },
  /*
   * No route warming needed: a production build compiles everything
   * ahead of time, which is also why this suite finishes in well under a
   * minute while the dev one takes minutes.
   *
   * It still has to re-seed, though. This was `globalSetup: undefined`
   * for a while, and the reasoning above is exactly how it got there —
   * "warming is a dev concern" is true, but the dev setup was also the
   * only thing refreshing the catalogue's relative dates. The suite we
   * run most often was the one running against a database that aged all
   * session.
   */
  globalSetup: "./tests/e2e/reseed.ts",
  webServer: {
    ...baseConfig.webServer,
    command: "npm run start",
    // Never silently fall back to a dev server someone left running —
    // that would defeat the whole point of this config.
    reuseExistingServer: false,
  },
});
