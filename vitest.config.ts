import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    /*
     * Pin the runner's timezone. datetime.ts formats in Europe/Sofia, and
     * on a machine already set to Sofia a test asserting that would pass
     * without proving anything — the bug it guards against (formatting in
     * the server's local zone) would be invisible exactly where the
     * developer is most likely to be.
     */
    env: { TZ: "UTC" },
  },
});
