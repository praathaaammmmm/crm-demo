import { defineConfig, devices } from "@playwright/test";
import { WEB_ORIGIN } from "./fixtures.js";

/**
 * Browser tests against a throwaway database. Run with:
 *   PLAYWRIGHT_BROWSERS_PATH=<project>/.playwright-browsers npx --no-install playwright test -c tests/e2e/playwright.config.ts
 * Traces, videos and screenshots are off so no captured page, cookie or token is kept.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: ".results",
  globalSetup: "./global-setup.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: WEB_ORIGIN,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
