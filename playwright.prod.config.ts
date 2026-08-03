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
 */
export default defineConfig({
  ...baseConfig,
  webServer: {
    ...baseConfig.webServer,
    command: "npm run start",
    // Never silently fall back to a dev server someone left running —
    // that would defeat the whole point of this config.
    reuseExistingServer: false,
  },
});
