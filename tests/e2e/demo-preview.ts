/**
 * Temporary local demo preview. Run with: node tests/e2e/demo-preview.ts
 *
 * - Uses one validated throwaway database (crm_test_<32 hex>) copied from crm_test_template. Real crm is
 *   never targeted: every connection is checked with current_database() by the compiled test helpers.
 * - Seeds test-only @example.test accounts and demo data through the real API (audit and permissions apply).
 * - Serves the built API on localhost:4100 and the built web app on localhost:3100.
 * - On SIGINT or SIGTERM: stops both servers and drops the throwaway database.
 * Values from .env are loaded into this process only and never printed.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { assertTestDatabaseName, createTestDatabase, requireEnv, withDatabase, type TestDatabase } from "../../apps/api/dist/test/db.js";
import { createUser } from "../../apps/api/dist/test/helpers.js";
import { BOOTSTRAP_CONFIRMATION, bootstrapSuperAdmin } from "../../apps/api/dist/src/modules/organization/index.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const API_PORT = 4100;
const WEB_PORT = 3100;
const API_ORIGIN = `http://localhost:${String(API_PORT)}`;
const WEB_ORIGIN = `http://localhost:${String(WEB_PORT)}`;
const API_SCRIPT = path.join(REPO_ROOT, "apps/api/dist/src/server.js");
const WEB_DIR = path.join(REPO_ROOT, "apps/web");
const NEXT_BIN = path.join(path.dirname(createRequire(import.meta.url).resolve("next/package.json", { paths: [WEB_DIR] })), "dist/bin/next");
const SESSION_COOKIE = "crm_session";

/** Test-only demo accounts. These are not real credentials. */
const DEMO = {
  ceo: { email: "ceo@example.test", name: "Demo CEO", password: "demo-ceo-password-2026" },
  vp: { email: "vp@example.test", name: "Demo VP", password: "demo-vp-password-2026" },
  cfo: { email: "cfo@example.test", name: "Demo CFO", password: "demo-cfo-password-2026" },
  cgo: { email: "cgo@example.test", name: "Demo CGO", password: "demo-cgo-password-2026" },
  employee: { email: "employee@example.test", name: "Demo Employee", password: "demo-employee-password-2026" },
} as const;
type Who = keyof typeof DEMO;

let db: TestDatabase | undefined;
let api: ChildProcess | undefined;
let web: ChildProcess | undefined;
let stopping = false;

function start(script: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [script, ...args], { cwd, env, stdio: ["ignore", "ignore", "inherit"] });
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const result = await Promise.race([exited.then(() => "exited" as const), sleep(10_000).then(() => "timeout" as const)]);
  if (result === "timeout") {
    child.kill("SIGKILL");
    await exited;
  }
}

async function teardown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const step of [() => stop(web), () => stop(api), () => db?.close() ?? Promise.resolve()]) {
    try {
      await step();
    } catch {
      console.error("Demo teardown step failed");
    }
  }
}

async function waitUntilReady(url: string, readyStatus: number, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited before ${url} was ready`);
    try {
      if ((await fetch(url)).status === readyStatus) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const tokens = new Map<Who, string>();

async function login(who: Who): Promise<void> {
  const response = await fetch(`${API_ORIGIN}/api/v1/auth/login`, {
    method: "POST",
    headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email: DEMO[who].email, password: DEMO[who].password }),
  });
  if (response.status !== 200) throw new Error(`Demo login failed with status ${String(response.status)}`);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  const token = cookie?.slice(SESSION_COOKIE.length + 1).split(";")[0];
  if (!token) throw new Error("Demo login returned no session cookie");
  tokens.set(who, token);
}

/** POST as a demo user; expects 200 or 201 and returns the parsed body. */
async function post(who: Who, pathname: string, payload: object = {}): Promise<unknown> {
  const token = tokens.get(who);
  if (token === undefined) throw new Error("Not logged in");
  const response = await fetch(`${API_ORIGIN}/api/v1${pathname}`, {
    method: "POST",
    headers: { origin: WEB_ORIGIN, "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify(payload),
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`Seed request to ${pathname} failed with status ${String(response.status)}`);
  }
  return (await response.json()) as unknown;
}

/** Reads `body[key].id` without trusting the body's shape. */
function idOf(body: unknown, key: string): string {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[key] : undefined;
  const id = typeof record === "object" && record !== null ? (record as Record<string, unknown>)["id"] : undefined;
  if (typeof id !== "string") throw new Error(`Seed response had no ${key} id`);
  return id;
}

const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

async function seed(database: TestDatabase, userIds: Record<Exclude<Who, "ceo">, string>): Promise<void> {
  for (const who of Object.keys(DEMO) as Who[]) await login(who);

  const project = async (name: string, description: string) => idOf(await post("ceo", "/projects", { name, description }), "project");
  const portal = await project("Customer Portal", "Self-service portal for customers.");
  const billing = await project("Billing Revamp", "New invoicing and pricing.");
  const mobile = await project("Mobile App", "iOS and Android release.");

  const task = async (projectId: string, title: string, assignee: Exclude<Who, "ceo">, priority: string, due: number) =>
    idOf(
      await post("ceo", "/tasks", { projectId, title, priority, dueDate: inDays(due), assigneeId: userIds[assignee], description: `${title} for the demo.` }),
      "task",
    );
  const proofAndSubmit = async (who: Who, taskId: string, url: string) => {
    await post(who, `/tasks/${taskId}/proofs`, { url, note: "Ready for review" });
    await post(who, `/tasks/${taskId}/submit`, {});
  };

  // Every task status.
  const design = await task(portal, "Design login page", "employee", "medium", 10); // todo
  const profile = await task(portal, "Build profile settings", "employee", "high", 5); // in_progress, overdue
  await post("employee", `/tasks/${profile}/status`, { status: "in_progress" });
  await post("employee", `/tasks/${profile}/updates`, { note: "Avatar upload works; saving preferences next." });
  const payment = await task(portal, "Integrate payment SDK", "employee", "urgent", 7); // blocked
  await post("employee", `/tasks/${payment}/status`, { status: "in_progress" });
  await post("employee", `/tasks/${payment}/status`, { status: "blocked", note: "Waiting for sandbox keys" });
  const onboarding = await task(portal, "Write onboarding emails", "employee", "medium", 6); // in_review
  await post("employee", `/tasks/${onboarding}/status`, { status: "in_progress" });
  await proofAndSubmit("employee", onboarding, "https://example.test/onboarding-draft");
  const session = await task(portal, "Fix session timeout", "employee", "high", 4); // changes_requested
  await post("employee", `/tasks/${session}/status`, { status: "in_progress" });
  await proofAndSubmit("employee", session, "https://example.test/session-fix");
  await post("ceo", `/tasks/${session}/review`, { decision: "changes_requested", note: "Please add a test for the 12-hour limit." });
  const ci = await task(portal, "Set up CI pipeline", "vp", "medium", 8); // completed (VP)
  await post("vp", `/tasks/${ci}/status`, { status: "in_progress" });
  await proofAndSubmit("vp", ci, "https://example.test/ci-run");
  await post("ceo", `/tasks/${ci}/review`, { decision: "approved" });
  const invoices = await task(billing, "Reconcile invoice exports", "cfo", "high", 9);
  await post("cfo", `/tasks/${invoices}/status`, { status: "in_progress" });
  await task(billing, "Update pricing table", "cgo", "low", 14);
  const checklist = await task(mobile, "Release checklist", "employee", "medium", 3); // completed
  await post("employee", `/tasks/${checklist}/status`, { status: "in_progress" });
  await proofAndSubmit("employee", checklist, "https://example.test/release-checklist");
  await post("ceo", `/tasks/${checklist}/review`, { decision: "approved" });

  // The API refuses past due dates, so one task is made overdue directly in this throwaway database only.
  const [row] = await database.query<{ name: string }>("SELECT current_database() AS name");
  assertTestDatabaseName(row?.name ?? "");
  await database.query("UPDATE tasks SET due_date = current_date - 2 WHERE id = $1", [profile]);

  // QA checks and results (VP).
  const check = async (taskId: string, title: string) => idOf(await post("vp", `/tasks/${taskId}/qa-checks`, { title }), "qaCheck");
  const failedCheck = await check(profile, "Profile saves on mobile");
  await post("vp", `/qa-checks/${failedCheck}/results`, { outcome: "failed", note: "Avatar is lost after saving on iOS." });
  const passedCheck = await check(onboarding, "Onboarding emails render");
  await post("vp", `/qa-checks/${passedCheck}/results`, { outcome: "passed", evidenceUrl: "https://example.test/email-render-report" });
  const blockedCheck = await check(payment, "Payment SDK smoke test");
  await post("vp", `/qa-checks/${blockedCheck}/results`, { outcome: "blocked", note: "No sandbox credentials yet." });
  await check(session, "Session expires after 12h"); // not run

  // Defects in every status (reported by VP).
  const defect = async (taskId: string, title: string, severity: string, extra: object = {}) =>
    idOf(await post("vp", `/tasks/${taskId}/defects`, { title, severity, reproductionSteps: `Steps to reproduce: ${title}.`, ...extra }), "defect");
  await defect(profile, "Profile save loses avatar", "critical", { qaCheckId: failedCheck }); // open
  const doubleSubmit = await defect(payment, "Payment form double-submits", "high");
  await post("employee", `/defects/${doubleSubmit}/status`, { status: "in_progress" });
  const footer = await defect(onboarding, "Email footer link broken", "medium");
  await post("employee", `/defects/${footer}/status`, { status: "in_progress" });
  await post("employee", `/defects/${footer}/updates`, { note: "Fixed the link target.", evidenceUrl: "https://example.test/footer-fix" });
  await post("employee", `/defects/${footer}/status`, { status: "fixed", note: "Link now points to the help centre." });
  const typo = await defect(onboarding, "Typo in welcome email", "low");
  await post("employee", `/defects/${typo}/status`, { status: "in_progress" });
  await post("employee", `/defects/${typo}/status`, { status: "fixed", note: "Corrected the spelling." });
  await post("vp", `/defects/${typo}/status`, { status: "verified" });
  const layout = await defect(design, "Legacy browser layout shift", "low");
  await post("vp", `/defects/${layout}/status`, { status: "wont_fix", note: "Legacy browsers are out of scope." });

  // Readiness: Mobile App ready (VP); Customer Portal at risk (CEO, since VP has a task there); Billing Revamp none.
  await post("vp", `/projects/${mobile}/readiness`, { label: "v2.3", readiness: "ready" });
  await post("ceo", `/projects/${portal}/readiness`, { label: "v1.0", readiness: "at_risk", note: "Critical profile defect open." });
}

async function main(): Promise<void> {
  process.loadEnvFile(path.join(REPO_ROOT, ".env"));
  // No migration step: the throwaway database is copied from crm_test_template as it is (already at 0000–0009).
  db = await createTestDatabase();
  const [row] = await db.query<{ name: string }>("SELECT current_database() AS name");
  const name = row?.name ?? "";
  assertTestDatabaseName(name);

  await bootstrapSuperAdmin(db.migrator, {
    ...DEMO.ceo,
    passwordConfirmation: DEMO.ceo.password,
    confirmation: BOOTSTRAP_CONFIRMATION,
  });
  const userIds = {
    vp: await createUser(db.migrator, { ...DEMO.vp, role: "vp_engineering_quality" }),
    cfo: await createUser(db.migrator, { ...DEMO.cfo, role: "cfo" }),
    cgo: await createUser(db.migrator, { ...DEMO.cgo, role: "cgo" }),
    employee: await createUser(db.migrator, { ...DEMO.employee, role: "employee" }),
  };

  // The API gets crm_app on the throwaway database only.
  api = start(API_SCRIPT, [], path.join(REPO_ROOT, "apps/api"), {
    PATH: process.env["PATH"] ?? "",
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    API_PORT: String(API_PORT),
    APP_ORIGIN: WEB_ORIGIN,
    DATABASE_URL_APP: withDatabase(requireEnv("DATABASE_URL_APP"), name),
    ORG_TIMEZONE: requireEnv("ORG_TIMEZONE"),
  });
  await waitUntilReady(`${API_ORIGIN}/api/v1/auth/me`, 401, api, 30_000);

  web = start(NEXT_BIN, ["start", "-p", String(WEB_PORT), "-H", "127.0.0.1"], WEB_DIR, {
    PATH: process.env["PATH"] ?? "",
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    API_INTERNAL_URL: API_ORIGIN,
  });
  await waitUntilReady(`http://127.0.0.1:${String(WEB_PORT)}/login`, 200, web, 60_000);

  await seed(db, userIds);

  for (const child of [api, web]) {
    child.on("exit", () => {
      if (!stopping) {
        console.error("A demo server exited unexpectedly; stopping the demo.");
        void teardown().then(() => process.exit(1));
      }
    });
  }
  console.log(`Demo ready on ${WEB_ORIGIN} (throwaway database ${name}). Send SIGTERM to stop.`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void teardown().then(() => {
      console.log("Demo stopped and its throwaway database was dropped.");
      process.exit(0);
    });
  });
}

main().catch(async (error: unknown) => {
  console.error(`Demo failed to start: ${error instanceof Error ? error.message : "unknown error"}`);
  await teardown();
  process.exit(1);
});
