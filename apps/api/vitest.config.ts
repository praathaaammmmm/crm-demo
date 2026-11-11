import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Tests read connection settings from the root .env. Values are loaded into the process only, never printed.
const repoRoot = path.resolve(import.meta.dirname, "../..");
Object.assign(process.env, loadEnv("test", repoRoot, ""));

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    pool: "forks",
    // Files run one at a time, each against its own throwaway database copied from the template.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
