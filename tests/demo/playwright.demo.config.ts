import { defineConfig, devices } from "@playwright/test";

/**
 * Public demo browser checks. Started only by tests/demo/public-demo.ts, which owns the servers and the
 * disposable database. Traces, videos and screenshots are off: the login page shows the demo password.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "public-demo.spec.ts",
  outputDir: ".results",
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
