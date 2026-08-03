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
  // `next dev` compiles routes and server actions on first request, so the
  // first navigation to /admin and the first login POST each pay a compile
  // cost the warm run never shows. Against the 5s default, a warm run left
  // ~0.5s of headroom and a cold one failed outright — surfacing as
  // "login didn't redirect", which reads as an auth bug rather than a
  // build delay. The webServer url below only pre-compiles /admin/login.
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    ...(existsSync(preinstalledChromium)
      ? { launchOptions: { executablePath: preinstalledChromium } }
      : {}),
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/admin/login",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
