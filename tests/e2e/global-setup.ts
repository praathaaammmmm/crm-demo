import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import migrateTemplate from "../../apps/api/test/global-setup.js";
import {
  assertTestDatabaseName,
  createTestDatabase,
  requireEnv,
  withDatabase,
  type TestDatabase,
} from "../../apps/api/test/db.js";
import { createSuperAdmin, createUser } from "../../apps/api/test/helpers.js";
import {
  API_ORIGIN,
  API_PORT,
  AUTH_DIR,
  authFile,
  QUALITY_SEED,
  REPO_ROOT,
  USERS,
  WEB_ORIGIN,
  WEB_PORT,
  type SavedRole,
} from "./fixtures.js";

/**
 * 1. Migrate crm_test_template (pending migrations only), create one validated crm_test_<hex> database.
 * 2. Seed users in it as crm_migrator.
 * 3. Start the built API (crm_app on the throwaway database only) and the built web app, from local paths.
 * 4. Seed approval requests and save logins through the API, sending the web Origin.
 * The returned teardown always stops both servers, deletes saved logins and drops the database.
 */

const API_SCRIPT = path.join(REPO_ROOT, "apps/api/dist/src/server.js");
const WEB_DIR = path.join(REPO_ROOT, "apps/web");
const NEXT_BIN = path.join(path.dirname(createRequire(import.meta.url).resolve("next/package.json", { paths: [WEB_DIR] })), "dist/bin/next");

const SESSION_COOKIE = "crm_session";

function start(script: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  // Explicit node executable and project-local script; only the listed variables are passed.
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

async function waitUntilReady(url: string, readyStatus: number, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server process exited before ${url} was ready`);
    try {
      const response = await fetch(url);
      if (response.status === readyStatus) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

/** Logs in directly against the API with the web app's Origin (CSRF check) and returns the session token. */
async function apiLogin(who: { email: string; password: string }): Promise<{ token: string; expires: number }> {
  const response = await fetch(`${API_ORIGIN}/api/v1/auth/login`, {
    method: "POST",
    headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email: who.email, password: who.password }),
  });
  if (response.status !== 200) throw new Error(`Seed login failed with status ${String(response.status)}`);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  const token = cookie?.slice(SESSION_COOKIE.length + 1).split(";")[0];
  if (!token) throw new Error("Seed login returned no session cookie");
  const body = (await response.json()) as { sessionExpiresAt: string };
  return { token, expires: Math.floor(new Date(body.sessionExpiresAt).getTime() / 1000) };
}

async function apiPost(token: string, pathname: string, payload: object): Promise<unknown> {
  const response = await fetch(`${API_ORIGIN}/api/v1${pathname}`, {
    method: "POST",
    headers: { origin: WEB_ORIGIN, "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify(payload),
  });
  if (response.status !== 201) throw new Error(`Seed request to ${pathname} failed with status ${String(response.status)}`);
  return response.json();
}

/** Reads `body[key].id` from a seed response without trusting its shape. */
function createdId(body: unknown, key: string): string {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[key] : undefined;
  const id = typeof record === "object" && record !== null ? (record as Record<string, unknown>)["id"] : undefined;
  if (typeof id !== "string") throw new Error(`Seed response had no ${key} id`);
  return id;
}

async function saveLogin(role: SavedRole, session: { token: string; expires: number }): Promise<void> {
  const state = {
    cookies: [
      {
        name: SESSION_COOKIE,
        value: session.token,
        domain: "localhost",
        path: "/",
        expires: session.expires,
        httpOnly: true,
        secure: true,
        sameSite: "Strict" as const,
      },
    ],
    origins: [],
  };
  await writeFile(authFile(role), JSON.stringify(state), { mode: 0o600 });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  // Values are loaded into this process only and never printed.
  process.loadEnvFile(path.join(REPO_ROOT, ".env"));

  let dropLeftovers: (() => Promise<void>) | undefined;
  let db: TestDatabase | undefined;
  let api: ChildProcess | undefined;
  let web: ChildProcess | undefined;

  const teardown = async () => {
    const failures: unknown[] = [];
    for (const step of [
      () => stop(web),
      () => stop(api),
      () => rm(AUTH_DIR, { recursive: true, force: true }),
      () => db?.close() ?? Promise.resolve(),
      () => dropLeftovers?.() ?? Promise.resolve(),
    ]) {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new Error(`e2e teardown had ${String(failures.length)} failure(s)`);
  };

  try {
    dropLeftovers = await migrateTemplate();
    db = await createTestDatabase();

    const [row] = await db.query<{ name: string }>("SELECT current_database() AS name");
    const name = row?.name ?? "";
    assertTestDatabaseName(name);
    const throwawayAppUrl = withDatabase(requireEnv("DATABASE_URL_APP"), name);

    await createSuperAdmin(db.migrator);
    const seedUsers = [
      [USERS.cfo, "cfo"],
      [USERS.cgo, "cgo"],
      [USERS.vp, "vp_engineering_quality"],
      [USERS.employee, "employee"],
      [USERS.authUser, "employee"],
      [USERS.targetApprove, "employee"],
      [USERS.targetReject, "employee"],
      [USERS.targetCancel, "employee"],
    ] as const;
    const ids = new Map<string, string>();
    for (const [who, role] of seedUsers) ids.set(who.email, await createUser(db.migrator, { ...who, role }));
    await createUser(db.migrator, { ...USERS.newUser, role: "employee", mustChangePassword: true });

    // The API gets crm_app on the throwaway database only: no migrator, admin, bootstrap or real-crm values.
    api = start(API_SCRIPT, [], path.join(REPO_ROOT, "apps/api"), {
      PATH: process.env["PATH"] ?? "",
      NODE_ENV: "test",
      LOG_LEVEL: "error",
      API_PORT: String(API_PORT),
      APP_ORIGIN: WEB_ORIGIN,
      DATABASE_URL_APP: throwawayAppUrl,
      ORG_TIMEZONE: requireEnv("ORG_TIMEZONE"),
    });
    await waitUntilReady(`${API_ORIGIN}/api/v1/auth/me`, 401, api, 30_000);

    web = start(NEXT_BIN, ["start", "-p", String(WEB_PORT)], WEB_DIR, {
      PATH: process.env["PATH"] ?? "",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      API_INTERNAL_URL: API_ORIGIN,
    });
    await waitUntilReady(`${WEB_ORIGIN}/login`, 200, web, 60_000);

    await mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
    const sessions = {
      ceo: await apiLogin(USERS.ceo),
      cfo: await apiLogin(USERS.cfo),
      cgo: await apiLogin(USERS.cgo),
      employee: await apiLogin(USERS.employee),
      vp: await apiLogin(USERS.vp),
    };
    for (const role of Object.keys(sessions) as SavedRole[]) await saveLogin(role, sessions[role]);

    const idOf = (email: string) => {
      const id = ids.get(email);
      if (!id) throw new Error("Seeded user id missing");
      return id;
    };
    await apiPost(sessions.cfo.token, "/approvals", {
      type: "user.role_change",
      targetUserId: idOf(USERS.targetApprove.email),
      payload: { newRole: "founder" },
      reason: "Moving to a founder role",
    });
    await apiPost(sessions.cgo.token, "/approvals", {
      type: "user.deactivate",
      targetUserId: idOf(USERS.targetReject.email),
      payload: {},
      reason: "Contract ended",
    });
    await apiPost(sessions.cfo.token, "/approvals", {
      type: "user.deactivate",
      targetUserId: idOf(USERS.targetCancel.email),
      payload: {},
      reason: "Duplicate account",
    });

    // quality.spec.ts: one project and one task assigned to the employee, created by the CEO through the API.
    const project = await apiPost(sessions.ceo.token, "/projects", { name: QUALITY_SEED.project });
    const due = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await apiPost(sessions.ceo.token, "/tasks", {
      projectId: createdId(project, "project"),
      title: QUALITY_SEED.task,
      priority: "high",
      dueDate: due,
      assigneeId: idOf(USERS.employee.email),
    });
    const vpProject = await apiPost(sessions.ceo.token, "/projects", { name: QUALITY_SEED.vpProject });
    await apiPost(sessions.ceo.token, "/tasks", {
      projectId: createdId(vpProject, "project"),
      title: QUALITY_SEED.vpTask,
      priority: "medium",
      dueDate: due,
      assigneeId: idOf(USERS.vp.email),
    });
  } catch (error) {
    await teardown();
    throw error;
  }

  return teardown;
}
