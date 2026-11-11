import { directoryPageSchema, userResponseSchema } from "@crm/contracts/organization";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import {
  buildTestApp,
  call,
  createSuperAdmin,
  createUser,
  loginToken,
  SUPER_ADMIN,
} from "../../../test/helpers.js";

const CFO = { email: "cfo@example.test", name: "Test CFO", password: "test-cfo-password" };
const EMPLOYEE = { email: "employee@example.test", name: "Test Employee", password: "test-employee-password" };

const newUser = (email: string, role = "employee") => ({
  email,
  name: "Created User",
  role,
  initialPassword: "temporary-password-123",
});

describe("organization: users", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let ceoId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    ceoId = (await createSuperAdmin(db.migrator)).userId;
    await createUser(db.migrator, { ...CFO, role: "cfo" });
    await createUser(db.migrator, { ...EMPLOYEE, role: "employee" });
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });
  beforeEach(async () => {
    app = await buildTestApp(db.app);
  });
  afterEach(async () => {
    await (app as FastifyInstance | undefined)?.close();
  });

  it("lets the CEO create a user with a temporary password, reporting to the CEO, audited", async () => {
    const token = await loginToken(app, SUPER_ADMIN.email, SUPER_ADMIN.password);
    const response = await call(app, {
      method: "POST",
      url: "/api/v1/users",
      token,
      payload: newUser("Created.One@Example.test"),
    });
    expect(response.statusCode).toBe(201);
    const { user } = userResponseSchema.parse(response.json());
    expect(user).toMatchObject({
      email: "created.one@example.test",
      role: "employee",
      status: "active",
      mustChangePassword: true,
    });

    const [row] = await db.query<{ reports_to_user_id: string; created_by: string; argon2id: boolean }>(
      "SELECT reports_to_user_id, created_by, password_hash LIKE '$argon2id$%' AS argon2id FROM users WHERE id = $1",
      [user.id],
    );
    expect(row).toEqual({ reports_to_user_id: ceoId, created_by: ceoId, argon2id: true });

    const audits = await db.query<{ actor_type: string; actor_user_id: string; before: unknown; after: unknown }>(
      "SELECT actor_type, actor_user_id, before, after FROM audit_events WHERE action = 'user.created' AND entity_id = $1",
      [user.id],
    );
    expect(audits).toEqual([
      { actor_type: "user", actor_user_id: ceoId, before: null, after: { role: "employee", status: "active" } },
    ]);
  });

  it("refuses user creation by anyone but the CEO", async () => {
    for (const person of [CFO, EMPLOYEE]) {
      const token = await loginToken(app, person.email, person.password);
      const response = await call(app, {
        method: "POST",
        url: "/api/v1/users",
        token,
        payload: newUser(`by-${person.name.replaceAll(" ", "-").toLowerCase()}@example.test`),
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it("rejects a duplicate email (409) and the ceo_cto role (400)", async () => {
    const token = await loginToken(app, SUPER_ADMIN.email, SUPER_ADMIN.password);
    const first = await call(app, { method: "POST", url: "/api/v1/users", token, payload: newUser("dup@example.test") });
    expect(first.statusCode).toBe(201);
    const second = await call(app, { method: "POST", url: "/api/v1/users", token, payload: newUser("dup@example.test") });
    expect(second.statusCode).toBe(409);

    const ceoRole = await call(app, {
      method: "POST",
      url: "/api/v1/users",
      token,
      payload: newUser("second-ceo@example.test", "ceo_cto"),
    });
    expect(ceoRole.statusCode).toBe(400);
  });

  it("rejects any manager field: the request contract has none", async () => {
    const token = await loginToken(app, SUPER_ADMIN.email, SUPER_ADMIN.password);
    const response = await call(app, {
      method: "POST",
      url: "/api/v1/users",
      token,
      payload: { ...newUser("manager-field@example.test"), reportsToUserId: ceoId },
    });
    expect(response.statusCode).toBe(400);
  });

  it("shows the directory with emails to the CEO, without emails to the CFO, and not to employees", async () => {
    const ceo = await call(app, {
      method: "GET",
      url: "/api/v1/users",
      token: await loginToken(app, SUPER_ADMIN.email, SUPER_ADMIN.password),
    });
    expect(ceo.statusCode).toBe(200);
    expect(directoryPageSchema.parse(ceo.json()).items.every((item) => typeof item.email === "string")).toBe(true);

    const cfo = await call(app, {
      method: "GET",
      url: "/api/v1/users",
      token: await loginToken(app, CFO.email, CFO.password),
    });
    expect(cfo.statusCode).toBe(200);
    expect(directoryPageSchema.parse(cfo.json()).items.every((item) => item.email === undefined)).toBe(true);

    const employee = await call(app, {
      method: "GET",
      url: "/api/v1/users",
      token: await loginToken(app, EMPLOYEE.email, EMPLOYEE.password),
    });
    expect(employee.statusCode).toBe(403);
  });

  it("paginates the directory with an opaque cursor", async () => {
    const token = await loginToken(app, SUPER_ADMIN.email, SUPER_ADMIN.password);
    const first = directoryPageSchema.parse(
      (await call(app, { method: "GET", url: "/api/v1/users?limit=2", token })).json(),
    );
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = directoryPageSchema.parse(
      (await call(app, { method: "GET", url: `/api/v1/users?limit=2&cursor=${String(first.nextCursor)}`, token })).json(),
    );
    const firstIds = new Set(first.items.map((item) => item.id));
    expect(second.items.some((item) => firstIds.has(item.id))).toBe(false);
  });
});
