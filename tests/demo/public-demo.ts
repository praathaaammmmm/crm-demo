/**
 * Phase B: local browser check of the public demo. Run with: node tests/demo/public-demo.ts
 *
 * Creates and seeds one crm_demo_test_<32 hex> database, builds the web app with DEMO_MODE=true, serves the
 * API (DEMO_MODE=true, crm_app on that database only) on :4100 and the web app on :3100, runs the demo
 * Playwright spec with recording off, then always stops the servers, drops the database and removes results.
 * Loads .env into this process only. Child output is kept in memory and checked for the demo password.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { requireEnv, withDatabase } from "../../apps/api/dist/test/db.js";
import { createDemoTestDatabase, dropDemoTestDatabase, isolationReport, tableCounts } from "../../apps/api/dist/test/demo-db.js";
import { portsFree, preflight, REPO_ROOT } from "./preflight.ts";
import { check, results, runSeed } from "./seed-trial.ts";

const API_PORT = 4100;
const WEB_PORT = 3100;
const WEB_ORIGIN = `http://localhost:${String(WEB_PORT)}`;
const WEB_DIR = path.join(REPO_ROOT, "apps/web");
const RESULTS_DIR = path.join(REPO_ROOT, "tests/demo/.results");
const NEXT_BIN = path.join(path.dirname(createRequire(import.meta.url).resolve("next/package.json", { paths: [WEB_DIR] })), "dist/bin/next");
const PLAYWRIGHT_BIN = path.join(REPO_ROOT, "node_modules/@playwright/test/cli.js");
/** Sign-in and sign-out are the only writes demo mode allows; they touch only these tables. */
const SESSION_TABLES = new Set(["sessions", "attendance_events"]);

let output = "";
const children: ChildProcess[] = [];

function start(args: string[], cwd: string, env: Record<string, string>): ChildProcess {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  children.push(child);
  return child;
}

async function finish(child: ChildProcess): Promise<number> {
  if (child.exitCode !== null) return child.exitCode;
  const [code] = (await once(child, "exit")) as [number | null];
  return code ?? 1;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  if ((await Promise.race([exited.then(() => "exited"), sleep(10_000).then(() => "timeout")])) === "timeout") {
    child.kill("SIGKILL");
    await exited;
  }
}

async function waitUntil(url: string, status: number, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited before ${url} was ready`);
    try {
      if ((await fetch(url)).status === status) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const baseEnv = () => ({ PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" });

const withoutSessions = (counts: Record<string, number>) =>
  JSON.stringify(Object.fromEntries(Object.entries(counts).filter(([table]) => !SESSION_TABLES.has(table))));

async function main(): Promise<number> {
  const pre = await preflight();
  if (!pre.ok) return 1;
  const password = randomBytes(18).toString("base64url");
  let database: string | undefined;
  let failed = false;
  try {
    database = await createDemoTestDatabase();
    const seeded = await runSeed(database, { DEMO_SEED_CONFIRM: database, DEMO_ACCOUNT_PASSWORD: password });
    check("seed succeeds", seeded.code === 0 && seeded.output === "Demo database seeded.", seeded.code === 0 ? undefined : seeded.output);
    if (seeded.code !== 0) return 1;

    // Web build with demo mode on, as a demo deployment would build it.
    const build = start([NEXT_BIN, "build"], WEB_DIR, { ...baseEnv(), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", DEMO_MODE: "true", API_INTERNAL_URL: `http://localhost:${String(API_PORT)}` });
    check("web build", (await finish(build)) === 0);

    const api = start([path.join(REPO_ROOT, "apps/api/dist/src/server.js")], path.join(REPO_ROOT, "apps/api"), {
      ...baseEnv(),
      NODE_ENV: "test",
      LOG_LEVEL: "error",
      API_PORT: String(API_PORT),
      APP_ORIGIN: WEB_ORIGIN,
      DATABASE_URL_APP: withDatabase(requireEnv("DATABASE_URL_APP"), database),
      ORG_TIMEZONE: requireEnv("ORG_TIMEZONE"),
      DEMO_MODE: "true",
    });
    await waitUntil(`http://localhost:${String(API_PORT)}/api/v1/auth/me`, 401, api, 30_000);
    const web = start([NEXT_BIN, "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], WEB_DIR, {
      ...baseEnv(),
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      DEMO_MODE: "true",
      DEMO_LOGIN_PASSWORD: password,
      API_INTERNAL_URL: `http://localhost:${String(API_PORT)}`,
      ORG_TIMEZONE: requireEnv("ORG_TIMEZONE"),
    });
    await waitUntil(`http://127.0.0.1:${String(WEB_PORT)}/login`, 200, web, 60_000);

    const before = await tableCounts(database);
    const playwrightStart = output.length;
    const playwright = start([PLAYWRIGHT_BIN, "test", "-c", "tests/demo/playwright.demo.config.ts"], REPO_ROOT, {
      ...baseEnv(),
      // Project-local browsers only; never the global Playwright cache.
      PLAYWRIGHT_BROWSERS_PATH: path.join(REPO_ROOT, ".playwright-browsers"),
      DEMO_E2E_PASSWORD: password,
    });
    const code = await finish(playwright);
    const summary = output
      .slice(playwrightStart)
      .split("\n")
      // Playwright may print a test's stdout mid-line, so INSPECT text is taken from wherever it starts.
      .filter((line) => /›|^\s*\d+ (passed|failed|flaky|skipped|did not run)/.test(line))
      .map((line) => line.replaceAll(password, "<redacted>"));
    for (const line of summary) console.log(line.trimEnd());
    if (code !== 0) {
      // Redacted failure diagnostics: error, expectation and locator lines only, password replaced, capped.
      const detail = output
        .slice(playwrightStart)
        .split("\n")
        .filter((line) => /^\s+\d+\) |Error:|Expected|Received|Locator:|locator\(|getBy|Timeout|waiting for|Call log|status\(\)|›.*:\d+:\d+$|^\s+at .*spec\.ts:\d+/.test(line))
        .slice(0, 120)
        .map((line) => line.replaceAll(password, "<redacted>").trimEnd());
      console.log("--- redacted failure diagnostics ---");
      for (const line of detail) console.log(line);
      console.log("--- end diagnostics ---");
    }
    // Inspection text from the temporary results file, printed (redacted) before cleanup removes it.
    const inspection = await readFile(path.join(RESULTS_DIR, "inspect.txt"), "utf8").catch(() => "");
    console.log("--- dashboard inspection ---");
    for (const line of inspection.split("\n").filter(Boolean)) console.log(line.replaceAll(password, "<redacted>"));
    console.log("--- end inspection ---");
    const summaries = inspection.split("\n").filter((line) => / panels=\d+ issues=\d+$/.test(line));
    check("inspection output written for 5 dashboards x 2 widths", summaries.length === 10);
    check("every dashboard inspected at 1280px and 390px", ["@1280", "@390"].every((width) => summaries.filter((line) => line.includes(` ${width} `)).length === 5));
    check("no layout issue (including cut-off labels) at either width", summaries.every((line) => line.endsWith(" issues=0")) && !inspection.includes("INSPECT-ISSUE"));
    check("inspection output has no password", !inspection.includes(password));
    check("playwright demo spec", code === 0);
    check("business data unchanged after browser run", withoutSessions(await tableCounts(database)) === withoutSessions(before));
  } catch (error) {
    failed = true;
    console.error(`Phase B error: ${error instanceof Error ? error.message.replaceAll(password, "<redacted>") : "unknown"}`);
  } finally {
    for (const child of children.toReversed()) await stop(child);
    if (database) await dropDemoTestDatabase(database);
    await rm(RESULTS_DIR, { recursive: true, force: true });
  }
  check("demo password never appears in server or test output", !output.includes(password));
  const post = await isolationReport();
  console.log(`post: demoDatabases=${String(post.demoDatabases)} demoConnections=${String(post.demoConnections)} template=${String(post.templateExists)} crm=${String(post.crmExists)}`);
  check("no crm_demo_test_* databases remain", post.demoDatabases === 0);
  check("no demo connections remain", post.demoConnections === 0);
  check("crm row counts unchanged", JSON.stringify(await tableCounts("crm")) === JSON.stringify(pre.crmCounts));
  check("ports 3100 and 4100 free", portsFree([WEB_PORT, API_PORT]));
  check("all child processes exited", children.every((child) => child.exitCode !== null || child.signalCode !== null));
  const failures = results.filter((result) => !result.ok).length;
  console.log(`Phase B checks: ${String(results.length - failures)}/${String(results.length)} passed`);
  return failed || failures > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`Phase B error: ${error instanceof Error ? error.name : "unknown"}`);
    process.exitCode = 1;
  });
