import { DEMO_READ_ONLY_MESSAGE } from "@crm/contracts/demo";
import type { Database } from "@crm/database/client";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

import { createTestDatabase, type TestDatabase } from "./db.js";
import {
  call,
  createSuperAdmin,
  createUser,
  getMe,
  loginToken,
  postLogin,
  postLogout,
  SUPER_ADMIN,
  TEST_ORIGIN,
  TEST_TIMEZONE,
} from "./helpers.js";

/** Every write route in the API except sign-in and sign-out. Each must exist and be refused in demo mode. */
const BLOCKED_WRITES: readonly (readonly ["POST" | "PATCH", string])[] = [
  ["POST", "/api/v1/approvals"],
  ["POST", "/api/v1/approvals/:id/approve"],
  ["POST", "/api/v1/approvals/:id/reject"],
  ["POST", "/api/v1/approvals/:id/cancel"],
  ["POST", "/api/v1/growth/activities"],
  ["POST", "/api/v1/growth/activities/:id/void"],
  ["POST", "/api/v1/growth/companies"],
  ["PATCH", "/api/v1/growth/companies/:id"],
  ["POST", "/api/v1/growth/companies/:id/archive"],
  ["POST", "/api/v1/growth/companies/:id/contacts"],
  ["PATCH", "/api/v1/growth/contacts/:id"],
  ["POST", "/api/v1/growth/contacts/:id/archive"],
  ["POST", "/api/v1/growth/leads"],
  ["PATCH", "/api/v1/growth/leads/:id"],
  ["POST", "/api/v1/growth/leads/:id/stage"],
  ["POST", "/api/v1/growth/leads/:id/reopen"],
  ["POST", "/api/v1/growth/leads/:id/reassign"],
  ["POST", "/api/v1/growth/leads/:id/archive"],
  ["POST", "/api/v1/growth/leads/:id/proposal/versions"],
  ["POST", "/api/v1/growth/proposals/:id/acceptance"],
  ["POST", "/api/v1/growth/leads/:id/won"],
  ["POST", "/api/v1/growth/proposals/:id/submit"],
  ["POST", "/api/v1/growth/proposals/:id/approve"],
  ["POST", "/api/v1/growth/proposals/:id/reject"],
  ["POST", "/api/v1/growth/proposals/:id/sent"],
  ["POST", "/api/v1/growth/proposals/:id/withdraw"],
  ["POST", "/api/v1/growth/proposals/:id/confirm"],
  ["POST", "/api/v1/growth/proposals/:id/refuse"],
  ["POST", "/api/v1/auth/password"],
  ["POST", "/api/v1/marketing/campaigns"],
  ["PATCH", "/api/v1/marketing/campaigns/:id"],
  ["POST", "/api/v1/marketing/campaigns/:id/status"],
  ["POST", "/api/v1/marketing/content"],
  ["PATCH", "/api/v1/marketing/content/:id"],
  ["POST", "/api/v1/marketing/content/:id/status"],
  ["POST", "/api/v1/marketing/content/:id/outcome"],
  ["POST", "/api/v1/marketing/content/:id/assets"],
  ["POST", "/api/v1/marketing/assets/:id/remove"],
  ["POST", "/api/v1/meetings"],
  ["PATCH", "/api/v1/meetings/:id"],
  ["POST", "/api/v1/meetings/:id/cancel"],
  ["POST", "/api/v1/meetings/:id/response"],
  ["POST", "/api/v1/notifications/read-all"],
  ["POST", "/api/v1/notifications/:id/read"],
  ["POST", "/api/v1/operations/incidents"],
  ["PATCH", "/api/v1/operations/incidents/:id"],
  ["POST", "/api/v1/operations/incidents/:id/status"],
  ["POST", "/api/v1/operations/incidents/:id/notes"],
  ["POST", "/api/v1/operations/incidents/:id/post-incident"],
  ["POST", "/api/v1/operations/releases"],
  ["PATCH", "/api/v1/operations/releases/:id"],
  ["POST", "/api/v1/operations/releases/:id/checklist"],
  ["POST", "/api/v1/operations/checklist-items/:id"],
  ["POST", "/api/v1/operations/releases/:id/decisions"],
  ["POST", "/api/v1/operations/automations"],
  ["PATCH", "/api/v1/operations/automations/:id"],
  ["POST", "/api/v1/operations/automations/:id/status"],
  ["POST", "/api/v1/operations/automations/:id/runs"],
  ["POST", "/api/v1/users"],
  ["POST", "/api/v1/users/:id/reset-access"],
  ["POST", "/api/v1/projects"],
  ["POST", "/api/v1/tasks/:id/qa-checks"],
  ["POST", "/api/v1/qa-checks/:id/results"],
  ["POST", "/api/v1/tasks/:id/defects"],
  ["PATCH", "/api/v1/defects/:id"],
  ["POST", "/api/v1/defects/:id/status"],
  ["POST", "/api/v1/defects/:id/updates"],
  ["POST", "/api/v1/projects/:id/readiness"],
  ["POST", "/api/v1/tasks"],
  ["PATCH", "/api/v1/tasks/:id"],
  ["POST", "/api/v1/tasks/:id/status"],
  ["POST", "/api/v1/tasks/:id/updates"],
  ["POST", "/api/v1/tasks/:id/proofs"],
  ["POST", "/api/v1/tasks/:id/submit"],
  ["POST", "/api/v1/tasks/:id/review"],
  ["POST", "/api/v1/tasks/:id/complete"],
];

const SOME_ID = "0196f3a0-0000-7000-8000-000000000001";
const EMPLOYEE = { email: "employee@example.test", name: "Demo Employee", password: "demo-employee-password" };
const DEMO_BODY = { code: "DEMO_READ_ONLY", message: DEMO_READ_ONLY_MESSAGE };

function buildDemoApp(db: Database): Promise<FastifyInstance> {
  return buildApp({
    db,
    env: { APP_ORIGIN: TEST_ORIGIN, NODE_ENV: "test", LOG_LEVEL: "silent", ORG_TIMEZONE: TEST_TIMEZONE, DEMO_MODE: true },
  });
}

describe("public demo mode", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let tables: string[];

  const counts = async () => {
    const result: Record<string, number> = {};
    for (const table of tables) {
      const [row] = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table}"`);
      result[table] = Number(row?.n);
    }
    return result;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await createSuperAdmin(db.migrator);
    await createUser(db.migrator, { ...EMPLOYEE, role: "employee" });
    // Every application table, including audit_events, sessions and attendance_events.
    const existing = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    tables = existing.map((row) => row.table_name).filter((name) => /^[a-z_]+$/.test(name));
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });
  beforeEach(async () => {
    app = await buildDemoApp(db.app);
  });
  afterEach(async () => {
    await (app as FastifyInstance | undefined)?.close();
  });

  it("lists only routes that really exist", () => {
    for (const [method, url] of BLOCKED_WRITES) expect(app.hasRoute({ method, url }), `${method} ${url}`).toBe(true);
    expect(BLOCKED_WRITES).toHaveLength(76);
  });

  it("refuses every business write with the same safe response and changes nothing", async () => {
    const token = await loginToken(app, SUPER_ADMIN.email, SUPER_ADMIN.password);
    const before = await counts();
    for (const [method, url] of BLOCKED_WRITES) {
      const response = await app.inject({
        method,
        url: url.replaceAll(":id", SOME_ID),
        headers: { origin: TEST_ORIGIN },
        cookies: { crm_session: token },
        payload: {},
      });
      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(response.json(), `${method} ${url}`).toEqual(DEMO_BODY);
    }
    expect(await counts()).toEqual(before);
  });

  it("refuses writes without a session, from another origin, with a bad body, and on unknown routes", async () => {
    const attempts = [
      app.inject({ method: "POST", url: "/api/v1/tasks", headers: { origin: TEST_ORIGIN }, payload: {} }),
      app.inject({ method: "POST", url: "/api/v1/tasks", headers: { origin: "https://evil.example.test" }, payload: {} }),
      app.inject({ method: "POST", url: "/api/v1/tasks", headers: { origin: TEST_ORIGIN, "content-type": "application/json" }, payload: "{not json" }),
      app.inject({ method: "DELETE", url: `/api/v1/tasks/${SOME_ID}`, headers: { origin: TEST_ORIGIN } }),
      app.inject({ method: "PUT", url: "/api/v1/unknown", headers: { origin: TEST_ORIGIN } }),
      app.inject({ method: "POST", url: "/api/v1/auth/login/extra", headers: { origin: TEST_ORIGIN }, payload: {} }),
      app.inject({ method: "POST", url: "/api/v1/tasks?x=/api/v1/auth/login", headers: { origin: TEST_ORIGIN }, payload: {} }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual(DEMO_BODY);
    }
  });

  it("blocks password changes", async () => {
    const token = await loginToken(app, EMPLOYEE.email, EMPLOYEE.password);
    const response = await call(app, {
      method: "POST",
      url: "/api/v1/auth/password",
      token,
      payload: { currentPassword: EMPLOYEE.password, newPassword: "another-long-password-1" },
    });
    expect(response.json()).toEqual(DEMO_BODY);
    expect((await postLogin(app, EMPLOYEE.email, EMPLOYEE.password)).statusCode).toBe(200);
  });

  it("allows sign-in, reads and sign-out", async () => {
    const token = await loginToken(app, SUPER_ADMIN.email, SUPER_ADMIN.password);
    expect((await getMe(app, token)).statusCode).toBe(200);
    expect((await call(app, { method: "GET", url: "/api/v1/tasks", token })).statusCode).toBe(200);
    expect((await call(app, { method: "GET", url: "/api/v1/users", token })).statusCode).toBe(200);
    expect((await postLogout(app, token)).statusCode).toBe(204);
    expect((await getMe(app, token)).statusCode).toBe(401);
  });

  it("keeps the Origin check on the allowed sign-in route", async () => {
    expect((await postLogin(app, SUPER_ADMIN.email, SUPER_ADMIN.password, "https://evil.example.test")).statusCode).toBe(403);
  });

  it("never locks a demo account after failed sign-ins and writes no lockout audit", async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      expect((await postLogin(app, EMPLOYEE.email, "wrong-password-attempt")).statusCode).toBe(401);
    }
    const [state] = await db.query<{ locked: boolean; failed_login_count: number }>(
      "SELECT coalesce(locked_until > now(), false) AS locked, failed_login_count FROM users WHERE email = $1",
      [EMPLOYEE.email],
    );
    expect(state).toEqual({ locked: false, failed_login_count: 0 });
    expect((await postLogin(app, EMPLOYEE.email, EMPLOYEE.password)).statusCode).toBe(200);
  });
});

describe("demo mode off", () => {
  it("does not register the guard: a write reaches its route", async () => {
    const db = await createTestDatabase();
    try {
      await createSuperAdmin(db.migrator);
      const app = await buildApp({
        db: db.app,
        env: { APP_ORIGIN: TEST_ORIGIN, NODE_ENV: "test", LOG_LEVEL: "silent", ORG_TIMEZONE: TEST_TIMEZONE, DEMO_MODE: false },
      });
      const token = await loginToken(app, SUPER_ADMIN.email, SUPER_ADMIN.password);
      const response = await call(app, { method: "POST", url: "/api/v1/projects", token, payload: { name: "Real write", description: "x" } });
      expect(response.statusCode).toBe(201);
      await app.close();
    } finally {
      await db.close();
    }
  });
});
