/**
 * Local public-demo preview. Run with: PREVIEW_STATE_FILE=<path> node tests/demo/preview.ts
 *
 * Creates and seeds one crm_demo_test_<32 hex> database, builds the web app with DEMO_MODE=true, serves the API
 * on :4100 and the web app on 127.0.0.1:3100, and keeps running. On SIGTERM/SIGINT it stops both servers, drops
 * only that database, and prints the isolation checks. The per-run demo password is written only to
 * PREVIEW_STATE_FILE (mode 0600) for the person running the preview; it is never printed to stdout.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { requireEnv, withDatabase } from "../../apps/api/dist/test/db.js";
import { createDemoTestDatabase, dropDemoTestDatabase, isolationReport, tableCounts } from "../../apps/api/dist/test/demo-db.js";
import { portsFree, preflight, REPO_ROOT } from "./preflight.ts";
import { runSeed } from "./seed-trial.ts";

const API_PORT = 4100;
const WEB_PORT = 3100;
const WEB_ORIGIN = `http://127.0.0.1:${String(WEB_PORT)}`;
const WEB_DIR = path.join(REPO_ROOT, "apps/web");
const NEXT_BIN = path.join(path.dirname(createRequire(import.meta.url).resolve("next/package.json", { paths: [WEB_DIR] })), "dist/bin/next");
const STATE_FILE = process.env["PREVIEW_STATE_FILE"] ?? "";

const children: ChildProcess[] = [];
let database: string | undefined;
let stopping = false;

const baseEnv = () => ({ PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" });

function start(args: string[], cwd: string, env: Record<string, string>): ChildProcess {
  // Server output is discarded: nothing from the servers reaches this log.
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "ignore", "ignore"] });
  children.push(child);
  return child;
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

async function shutdown(baseline: Record<string, number>): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const child of children.toReversed()) await stop(child);
  if (database) await dropDemoTestDatabase(database);
  const post = await isolationReport();
  console.log(`post: demoDatabases=${String(post.demoDatabases)} demoConnections=${String(post.demoConnections)} template=${String(post.templateExists)}`);
  console.log(`portsFree=${String(portsFree([WEB_PORT, API_PORT]))}`);
  console.log(`childrenExited=${String(children.every((child) => child.exitCode !== null || child.signalCode !== null))}`);
  console.log(`crmUnchanged=${String(JSON.stringify(await tableCounts("crm")) === JSON.stringify(baseline))}`);
  console.log("Preview stopped.");
}

async function main(): Promise<void> {
  if (!STATE_FILE) throw new Error("PREVIEW_STATE_FILE is not set");
  const pre = await preflight();
  if (!pre.ok) throw new Error("Preflight failed");
  const password = randomBytes(12).toString("base64url");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void shutdown(pre.crmCounts).then(() => process.exit(0));
    });
  }

  database = await createDemoTestDatabase();
  const seeded = await runSeed(database, { DEMO_SEED_CONFIRM: database, DEMO_ACCOUNT_PASSWORD: password });
  if (seeded.code !== 0) throw new Error(seeded.output);
  console.log("seed=ok");

  const build = start([NEXT_BIN, "build"], WEB_DIR, { ...baseEnv(), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", DEMO_MODE: "true", API_INTERNAL_URL: `http://127.0.0.1:${String(API_PORT)}` });
  const [buildCode] = (await once(build, "exit")) as [number | null];
  if (buildCode !== 0) throw new Error("Web build failed");
  console.log("webBuild=ok");

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
  await waitUntil(`http://127.0.0.1:${String(API_PORT)}/api/v1/auth/me`, 401, api, 30_000);
  const web = start([NEXT_BIN, "start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], WEB_DIR, {
    ...baseEnv(),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    DEMO_MODE: "true",
    DEMO_LOGIN_PASSWORD: password,
    API_INTERNAL_URL: `http://127.0.0.1:${String(API_PORT)}`,
    ORG_TIMEZONE: requireEnv("ORG_TIMEZONE"),
  });
  await waitUntil(`${WEB_ORIGIN}/login`, 200, web, 60_000);

  // Confirm the banner and demo accounts are served before reporting ready.
  const login = await (await fetch(`${WEB_ORIGIN}/login`)).text();
  console.log(`banner=${String(login.includes("Demo data — changes are not saved"))} demoAccounts=${String(login.includes("ceo@example.test"))}`);
  const blocked = await fetch(`http://127.0.0.1:${String(API_PORT)}/api/v1/tasks`, { method: "POST", headers: { origin: WEB_ORIGIN } });
  console.log(`apiReadOnly=${String(blocked.status === 403 && ((await blocked.json()) as { code?: string }).code === "DEMO_READ_ONLY")}`);

  await writeFile(STATE_FILE, `${JSON.stringify({ database, password, url: WEB_ORIGIN, pid: process.pid })}\n`, { mode: 0o600 });
  console.log(`database=${database}`);
  console.log("PREVIEW READY");
  for (const child of [api, web]) {
    child.on("exit", () => {
      if (!stopping) {
        console.log("A preview server exited unexpectedly; stopping.");
        void shutdown(pre.crmCounts).then(() => process.exit(1));
      }
    });
  }
}

main().catch(async (error: unknown) => {
  console.error(`Preview failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`);
  await shutdown({}).catch(() => undefined);
  process.exit(1);
});
