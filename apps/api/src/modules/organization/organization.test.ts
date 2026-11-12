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

  describe("reset access", () => {
    const TEMP = "new-temporary-password-1";
    const reset = (token: string, id: string, payload: object = { temporaryPassword: TEMP }) =>
      call(app, { method: "POST", url: `/api/v1/users/${id}/reset-access`, token, payload });

    it("resets an active user: new temporary password, must-change flag, sessions ended, audited without secrets", async () => {
      const person = { email: "reset-active@example.test", name: "Reset Active", password: "original-password-1" };
      const id = await createUser(db.migrator, { ...person, role: "employee" });
      const oldToken = await loginToken(app, person.email, person.password);
      const ceo = await loginToken(app, SUPER_ADMIN.email, SUPER_ADMIN.password);

      const response = await reset(ceo, id);
      expect(response.statusCode).toBe(200);
      expect(userResponseSchema.parse(response.json()).user).toMatchObject({ id, status: "active", mustChangePassword: true });

      // The old session no longer works; the old password fails; the new one signs in and must be changed.
      expect((await call(app, { method: "GET", url: "/api/v1/users", token: oldToken })).statusCode).toBe(401);
      await expect(loginToken(app, person.email, person.password)).rejects.toThrow();
      expect(await loginToken(app, person.email, TEMP)).toEqual(expect.any(String));

      const ended = await db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM attendance_events WHERE user_id = $1 AND kind = 'session_end'",
        [id],
      );
      expect(ended[0]?.count).toBeGreaterThanOrEqual(1);

      const audits = await db.query<{ actor_user_id: string; before: unknown; after: Record<string, unknown> }>(
        "SELECT actor_user_id, before, after FROM audit_events WHERE action = 'user.access_reset' AND entity_id = $1",
        [id],
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actor_user_id: ceoId,
        before: { role: "employee", status: "active" },
        after: { role: "employee", status: "active", mustChangePassword: true, sessionsRevoked: 1 },
      });
      const text = JSON.stringify(audits[0]);
      expect(text).not.toContain(TEMP);
      expect(text).not.toContain(person.email);
      expect(text).not.toContain("argon2");
    });

    it("restores a deactivated user without deleting history", async () => {
      const person = { email: "reset-deactivated@example.test", name: "Reset Deactivated", password: "original-password-2" };
      const id = await createUser(db.migrator, { ...person, role: "employee" });
      const ceo = await loginToken(app, SUPER_ADMIN.email, SUPER_ADMIN.password);
      const deactivated = await call(app, {
        method: "POST",
        url: "/api/v1/approvals",
        token: ceo,
        payload: { type: "user.deactivate", targetUserId: id, payload: {}, reason: "Left the team" },
      });
      expect(deactivated.statusCode).toBe(201);

      const response = await reset(ceo, id);
      expect(response.statusCode).toBe(200);
      expect(userResponseSchema.parse(response.json()).user.status).toBe("active");
      expect(await loginToken(app, person.email, TEMP)).toEqual(expect.any(String));

      const [row] = await db.query<{ deactivated_at: string | null }>("SELECT deactivated_at FROM users WHERE id = $1", [id]);
      expect(row?.deactivated_at).toBeNull();
      const actions = await db.query<{ action: string }>(
        "SELECT action FROM audit_events WHERE entity_id = $1 AND action LIKE 'user.%' ORDER BY occurred_at",
        [id],
      );
      expect(actions.map((a) => a.action)).toEqual(["user.deactivated", "user.access_reset"]);
      const approvals = await db.query<{ status: string }>("SELECT status FROM approval_requests WHERE target_user_id = $1", [id]);
      expect(approvals).toEqual([{ status: "approved" }]);
    });

    it("refuses the CEO/CTO account, the caller's own account and non-CEO callers", async () => {
      const ceo = await loginToken(app, SUPER_ADMIN.email, SUPER_ADMIN.password);
      expect((await reset(ceo, ceoId)).statusCode).toBe(403);

      const cfoId = (await db.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [CFO.email]))[0]?.id ?? "";
      const cfo = await loginToken(app, CFO.email, CFO.password);
      expect((await reset(cfo, cfoId)).statusCode).toBe(403);
      const employee = await loginToken(app, EMPLOYEE.email, EMPLOYEE.password);
      expect((await reset(employee, cfoId)).statusCode).toBe(403);
    });

    it("validates the password length and treats unknown or malformed ids as not found", async () => {
      const ceo = await loginToken(app, SUPER_ADMIN.email, SUPER_ADMIN.password);
      const cfoId = (await db.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [CFO.email]))[0]?.id ?? "";
      expect((await reset(ceo, cfoId, { temporaryPassword: "short" })).statusCode).toBe(400);
      expect((await reset(ceo, cfoId, { temporaryPassword: TEMP, extra: true })).statusCode).toBe(400);
      expect((await reset(ceo, "00000000-0000-7000-8000-000000000000")).statusCode).toBe(404);
      expect((await reset(ceo, "not-a-uuid")).statusCode).toBe(404);
    });
  });
});
