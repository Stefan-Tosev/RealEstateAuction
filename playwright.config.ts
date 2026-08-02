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
