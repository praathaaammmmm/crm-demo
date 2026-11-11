import { sessionResponseSchema } from "@crm/contracts/identity";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import {
  buildTestApp,
  call,
  createSuperAdmin,
  createUser,
  getMe,
  loginToken,
  postLogin,
  postLogout,
  sessionCookieOf,
  SUPER_ADMIN,
} from "../../../test/helpers.js";
import { hashSessionToken } from "./identity.crypto.js";

const EMPLOYEE = { email: "employee@example.test", name: "Test Employee", password: "test-employee-password" };
const LOCKOUT_USER = { email: "lockout@example.test", name: "Lockout User", password: "test-lockout-password" };
const INACTIVE_USER = { email: "inactive@example.test", name: "Inactive User", password: "test-inactive-password" };
const NEW_USER = { email: "new@example.test", name: "New User", password: "temporary-password-1" };
const NEW_USER_2 = { email: "new2@example.test", name: "New User Two", password: "temporary-password-2" };

describe("identity: login, session, logout", () => {
  let db: TestDatabase;
  let app: FastifyInstance;

  const sessionRow = async (token: string) => {
    const [row] = await db.query<{
      id: string;
      user_id: string;
      duration_seconds: string;
      ended: boolean;
      end_reason: string | null;
    }>(
      `SELECT id, user_id, extract(epoch FROM expires_at - created_at)::text AS duration_seconds,
              ended_at IS NOT NULL AS ended, end_reason
       FROM sessions WHERE token_hash = $1`,
      [hashSessionToken(token)],
    );
    if (!row) throw new Error("session not found");
    return row;
  };

  const attendanceFor = (sessionId: string) =>
    db.query<{ kind: string; matches_session_time: boolean }>(
      `SELECT a.kind,
              CASE a.kind WHEN 'login' THEN a.occurred_at = s.created_at ELSE a.occurred_at = s.ended_at END
                AS matches_session_time
       FROM attendance_events a JOIN sessions s ON s.id = a.session_id
       WHERE a.session_id = $1 ORDER BY a.occurred_at, a.kind`,
      [sessionId],
    );

  const loginAs = async (user: { email: string; password: string }) => {
    const response = await postLogin(app, user.email, user.password);
    expect(response.statusCode).toBe(200);
    return sessionCookieOf(response).value;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await createSuperAdmin(db.migrator);
    await createUser(db.migrator, { ...EMPLOYEE, role: "employee" });
    await createUser(db.migrator, { ...LOCKOUT_USER, role: "employee" });
    await createUser(db.migrator, { ...INACTIVE_USER, role: "intern" });
    await createUser(db.migrator, { ...NEW_USER, role: "employee", mustChangePassword: true });
    await createUser(db.migrator, { ...NEW_USER_2, role: "employee", mustChangePassword: true });
  });
  afterAll(async () => {
    // H7: db is unset if beforeAll failed before the database was created.
    await (db as TestDatabase | undefined)?.close();
  });
  // A fresh app per test keeps the in-memory login rate limit independent between tests.
  beforeEach(async () => {
    app = await buildTestApp(db.app);
  });
  afterEach(async () => {
    await (app as FastifyInstance | undefined)?.close();
  });

  it("logs in: allowlisted body, secure cookie, 12-hour session, attendance login", async () => {
    const response = await postLogin(app, SUPER_ADMIN.email, SUPER_ADMIN.password);
    expect(response.statusCode).toBe(200);

    const body = sessionResponseSchema.parse(response.json());
    expect(body.user).toMatchObject({ email: SUPER_ADMIN.email, role: "ceo_cto", isSuperAdmin: true });
    expect(body.mustChangePassword).toBe(false);

    // Exact allowlist of response fields.
    const raw = response.json<{ user: object }>();
    expect(Object.keys(raw).sort()).toEqual(["mustChangePassword", "sessionExpiresAt", "user"]);
    expect(Object.keys(raw.user).sort()).toEqual(["email", "id", "isSuperAdmin", "name", "role"]);

    const cookie = sessionCookieOf(response);
    // Boolean comparison so a failure can never print the token.
    expect(response.body.includes(cookie.value)).toBe(false);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/", maxAge: 43200, secure: true });

    const session = await sessionRow(cookie.value);
    expect(Number(session.duration_seconds)).toBe(12 * 60 * 60);
    expect(await attendanceFor(session.id)).toEqual([{ kind: "login", matches_session_time: true }]);
  });

  it("returns the same 401 for a wrong password and an unknown email", async () => {
    const wrongPassword = await postLogin(app, EMPLOYEE.email, "not-the-right-password");
    const unknownEmail = await postLogin(app, "nobody@example.test", "not-the-right-password");
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
  });

  it("locks the account after five failures, audits it, and rejects the correct password while locked", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await postLogin(app, LOCKOUT_USER.email, "not-the-right-password")).statusCode).toBe(401);
    }
    const [state] = await db.query<{ locked: boolean; failed_login_count: number }>(
      "SELECT locked_until > now() AS locked, failed_login_count FROM users WHERE email = $1",
      [LOCKOUT_USER.email],
    );
    expect(state).toEqual({ locked: true, failed_login_count: 0 });

    const audits = await db.query<{ actor_type: string; actor_user_id: string | null }>(
      `SELECT a.actor_type, a.actor_user_id FROM audit_events a JOIN users u ON u.id = a.entity_id
       WHERE a.action = 'user.account_locked' AND u.email = $1`,
      [LOCKOUT_USER.email],
    );
    expect(audits).toEqual([{ actor_type: "anonymous", actor_user_id: null }]);

    expect((await postLogin(app, LOCKOUT_USER.email, LOCKOUT_USER.password)).statusCode).toBe(401);
  });

  it("rejects a deactivated user", async () => {
    await db.query("UPDATE users SET status = 'deactivated', deactivated_at = now() WHERE email = $1", [
      INACTIVE_USER.email,
    ]);
    expect((await postLogin(app, INACTIVE_USER.email, INACTIVE_USER.password)).statusCode).toBe(401);
  });

  it("GET /me accepts only a valid, unexpired session", async () => {
    const token = await loginAs(EMPLOYEE);
    const me = await getMe(app, token);
    expect(me.statusCode).toBe(200);
    expect(sessionResponseSchema.parse(me.json()).user.email).toBe(EMPLOYEE.email);

    expect((await getMe(app)).statusCode).toBe(401);
    expect((await getMe(app, "not-a-real-session-token")).statusCode).toBe(401);

    await db.query(
      `UPDATE sessions SET created_at = created_at - interval '13 hours', expires_at = expires_at - interval '13 hours'
       WHERE token_hash = $1`,
      [hashSessionToken(token)],
    );
    expect((await getMe(app, token)).statusCode).toBe(401);
  });

  it("GET /me writes nothing", async () => {
    const token = await loginAs(EMPLOYEE);
    const snapshot = () =>
      db.query("SELECT (SELECT count(*) FROM attendance_events) AS a, (SELECT count(*) FROM audit_events) AS b, " +
        "(SELECT json_agg(s ORDER BY s.id) FROM sessions s) AS c, (SELECT json_agg(u ORDER BY u.id) FROM users u) AS d");
    const before = await snapshot();
    expect((await getMe(app, token)).statusCode).toBe(200);
    expect(await snapshot()).toEqual(before);
  });

  it("logs out: ends the session, records session_end at ended_at, clears the cookie, is idempotent", async () => {
    const token = await loginAs(EMPLOYEE);

    const response = await postLogout(app, token);
    expect(response.statusCode).toBe(204);
    const cleared = sessionCookieOf(response);
    expect(cleared.value).toBe("");

    const session = await sessionRow(token);
    expect(session).toMatchObject({ ended: true, end_reason: "logout" });
    expect(await attendanceFor(session.id)).toEqual([
      { kind: "login", matches_session_time: true },
      { kind: "session_end", matches_session_time: true },
    ]);

    expect((await postLogout(app, token)).statusCode).toBe(204);
    expect(await attendanceFor(session.id)).toHaveLength(2);
    expect((await getMe(app, token)).statusCode).toBe(401);
  });

  it("while a password change is required, allows only /auth/me, /auth/password and /auth/logout", async () => {
    const token = await loginToken(app, NEW_USER.email, NEW_USER.password);
    const otherToken = await loginToken(app, NEW_USER.email, NEW_USER.password);

    const me = await getMe(app, token);
    expect(me.statusCode).toBe(200);
    expect(sessionResponseSchema.parse(me.json()).mustChangePassword).toBe(true);

    const blocked = await call(app, { method: "GET", url: "/api/v1/users", token });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json<{ code: string }>().code).toBe("PASSWORD_CHANGE_REQUIRED");

    const wrongCurrent = await call(app, {
      method: "POST",
      url: "/api/v1/auth/password",
      token,
      payload: { currentPassword: "not-the-current-password", newPassword: "a-brand-new-password" },
    });
    expect(wrongCurrent.statusCode).toBe(400);

    const sameAsOld = await call(app, {
      method: "POST",
      url: "/api/v1/auth/password",
      token,
      payload: { currentPassword: NEW_USER.password, newPassword: NEW_USER.password },
    });
    expect(sameAsOld.statusCode).toBe(400);

    const changed = await call(app, {
      method: "POST",
      url: "/api/v1/auth/password",
      token,
      payload: { currentPassword: NEW_USER.password, newPassword: "a-brand-new-password" },
    });
    expect(changed.statusCode).toBe(204);

    // The current session continues; every other session was revoked with attendance session_end.
    const after = await getMe(app, token);
    expect(sessionResponseSchema.parse(after.json()).mustChangePassword).toBe(false);
    expect((await getMe(app, otherToken)).statusCode).toBe(401);
    const other = await sessionRow(otherToken);
    expect(other).toMatchObject({ ended: true, end_reason: "revoked" });
    expect(await attendanceFor(other.id)).toEqual([
      { kind: "login", matches_session_time: true },
      { kind: "session_end", matches_session_time: true },
    ]);

    const audits = await db.query<{ actor_type: string; before: unknown; after: unknown }>(
      `SELECT a.actor_type, a.before, a.after FROM audit_events a JOIN users u ON u.id = a.entity_id
       WHERE a.action = 'user.password_changed' AND u.email = $1`,
      [NEW_USER.email],
    );
    expect(audits).toEqual([{ actor_type: "user", before: null, after: null }]);

    // The gate is lifted; normal role permissions apply (employees cannot read the directory).
    const directory = await call(app, { method: "GET", url: "/api/v1/users", token });
    expect(directory.statusCode).toBe(403);
    expect(directory.json<{ code: string }>().code).toBe("FORBIDDEN");
  });

  it("allows logout while a password change is required", async () => {
    const token = await loginToken(app, NEW_USER_2.email, NEW_USER_2.password);
    expect((await postLogout(app, token)).statusCode).toBe(204);
    expect((await getMe(app, token)).statusCode).toBe(401);
  });

  it("rejects state-changing requests without the app Origin", async () => {
    const noOrigin = await postLogin(app, EMPLOYEE.email, EMPLOYEE.password, null);
    expect(noOrigin.statusCode).toBe(403);
    expect(noOrigin.json()).toEqual({ code: "FORBIDDEN", message: "Forbidden" });

    const token = await loginAs(EMPLOYEE);
    expect((await postLogout(app, token, "https://evil.example")).statusCode).toBe(403);
    expect((await sessionRow(token)).ended).toBe(false);
  });
});
