import type { Database } from "@crm/database/client";
import type { Role } from "@crm/permissions";
import { sql } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/modules/identity/index.js";
import { BOOTSTRAP_CONFIRMATION, bootstrapSuperAdmin } from "../src/modules/organization/index.js";

export const TEST_ORIGIN = "http://localhost:3000";

export const SUPER_ADMIN = {
  email: "ceo@example.test",
  name: "Test CEO",
  password: "test-super-admin-password",
} as const;

/** Fixed for tests so "today" and "overdue" are predictable. */
export const TEST_TIMEZONE = "Asia/Kolkata";

export function buildTestApp(db: Database): Promise<FastifyInstance> {
  return buildApp({
    db,
    env: { APP_ORIGIN: TEST_ORIGIN, NODE_ENV: "test", LOG_LEVEL: "silent", ORG_TIMEZONE: TEST_TIMEZONE },
  });
}

/** A date (YYYY-MM-DD) relative to today in TEST_TIMEZONE. */
export function dateFromToday(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: TEST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function createSuperAdmin(migrator: Database): Promise<{ userId: string }> {
  return bootstrapSuperAdmin(migrator, {
    ...SUPER_ADMIN,
    passwordConfirmation: SUPER_ADMIN.password,
    confirmation: BOOTSTRAP_CONFIRMATION,
  });
}

/** Inserts a regular user as crm_migrator. The database trigger sets the reporting line. */
export async function createUser(
  migrator: Database,
  input: {
    email: string;
    name: string;
    password: string;
    role: Exclude<Role, "ceo_cto">;
    mustChangePassword?: boolean;
  },
): Promise<string> {
  const passwordHash = await hashPassword(input.password);
  const result = await migrator.execute<{ id: string }>(sql`
    INSERT INTO users (email, name, role, password_hash, must_change_password)
    VALUES (${input.email}, ${input.name}, ${input.role}::user_role, ${passwordHash}, ${input.mustChangePassword ?? false})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("User insert returned no row");
  return row.id;
}

export function postLogin(app: FastifyInstance, email: string, password: string, origin: string | null = TEST_ORIGIN) {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: origin === null ? {} : { origin },
    payload: { email, password },
  });
}

export function getMe(app: FastifyInstance, token?: string) {
  return app.inject({
    method: "GET",
    url: "/api/v1/auth/me",
    cookies: token === undefined ? {} : { crm_session: token },
  });
}

export function postLogout(app: FastifyInstance, token?: string, origin: string | null = TEST_ORIGIN) {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/logout",
    headers: origin === null ? {} : { origin },
    cookies: token === undefined ? {} : { crm_session: token },
  });
}

export function sessionCookieOf(response: LightMyRequestResponse) {
  const cookie = response.cookies.find((c) => c.name === "crm_session");
  if (!cookie) throw new Error("No crm_session cookie in response");
  return cookie;
}

/** Logs in and returns the session token. Throws (without printing the token) on failure. */
export async function loginToken(app: FastifyInstance, email: string, password: string): Promise<string> {
  const response = await postLogin(app, email, password);
  if (response.statusCode !== 200) throw new Error(`Login failed with status ${String(response.statusCode)}`);
  return sessionCookieOf(response).value;
}

/** An authenticated API call from the app's own origin. */
export function call(
  app: FastifyInstance,
  options: { method: "GET" | "POST"; url: string; token?: string; payload?: object },
) {
  return app.inject({
    method: options.method,
    url: options.url,
    headers: options.method === "GET" ? {} : { origin: TEST_ORIGIN },
    cookies: options.token === undefined ? {} : { crm_session: options.token },
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
}

/** The PostgreSQL error code (e.g. 42501) of a rejected query, looking through Drizzle's wrapper. */
export async function pgErrorCode(query: Promise<unknown>): Promise<string | null> {
  try {
    await query;
  } catch (error) {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
      const code = (current as Error & { code?: unknown }).code;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
      current = current.cause;
    }
    return "unknown";
  }
  return null;
}
