import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@crm/database/client";

export const TEMPLATE_DATABASE = "crm_test_template";
/** The only database names test code may ever create, grant on, or drop. `crm` and the template never match. */
export const TEST_DATABASE_PATTERN = /^crm_test_[0-9a-f]{32}$/;
/** The admin connection must use the maintenance database, never `crm` or a test database. */
const ADMIN_DATABASE = "postgres";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Same credentials, different database name. The real target is still confirmed after connecting. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** H1: refuses any name that is not a throwaway test database. */
export function assertTestDatabaseName(name: string): void {
  if (!TEST_DATABASE_PATTERN.test(name)) {
    throw new Error("Refusing to act on a database that is not a throwaway test database");
  }
}

/**
 * H2/H3: opens a pool and confirms it is connected to exactly `expected`, whatever the connection string says
 * (query parameters can override the path). Closes the pool and throws on any mismatch.
 */
export async function connectTo(
  url: string,
  expected: string,
  applicationName: string,
): Promise<ReturnType<typeof createDatabase>> {
  const connection = createDatabase(withDatabase(url, expected), { applicationName, maxConnections: 2 });
  try {
    const { rows } = await connection.pool.query<{ database: string }>("SELECT current_database() AS database");
    if (rows[0]?.database !== expected) throw new Error("Connected to an unexpected database; refusing to continue");
    return connection;
  } catch (error) {
    await connection.pool.end();
    throw error;
  }
}

/** Runs statements on the admin connection after confirming it is the maintenance database. */
async function asAdmin<T>(run: (query: (text: string) => Promise<unknown[]>) => Promise<T>): Promise<T> {
  const admin = await connectTo(requireEnv("TEST_DATABASE_ADMIN_URL"), ADMIN_DATABASE, "crm-test-admin");
  try {
    return await run(async (text) => (await admin.pool.query<Record<string, unknown>>(text)).rows);
  } finally {
    await admin.pool.end();
  }
}

/** Builds a statement only after the name has been validated. */
function onTestDatabase(name: string, build: (validName: string) => string): string {
  assertTestDatabaseName(name);
  return build(name);
}

export async function dropTestDatabase(name: string): Promise<void> {
  const statement = onTestDatabase(name, (n) => `DROP DATABASE IF EXISTS ${n} WITH (FORCE)`);
  await asAdmin(async (query) => {
    await query(statement);
  });
}

/** H5: drops every leftover throwaway database. Only names matching TEST_DATABASE_PATTERN are touched. */
export async function dropLeftoverTestDatabases(): Promise<number> {
  return asAdmin(async (query) => {
    const rows = (await query("SELECT datname FROM pg_database WHERE datname LIKE 'crm\\_test\\_%'")) as {
      datname: string;
    }[];
    const leftovers = rows.map((row) => row.datname).filter((name) => TEST_DATABASE_PATTERN.test(name));
    for (const name of leftovers) {
      await query(onTestDatabase(name, (n) => `DROP DATABASE IF EXISTS ${n} WITH (FORCE)`));
    }
    return leftovers.length;
  });
}

export interface TestDatabase {
  /** Connected as crm_app, exactly like the API. */
  app: Database;
  /** Connected as crm_migrator, for test setup and assertions. */
  migrator: Database;
  query<T extends object>(text: string, values?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/** A throwaway database copied from the migrated template, dropped by close(). */
export async function createTestDatabase(): Promise<TestDatabase> {
  // Generated from hex only, and validated before every statement.
  const name = `crm_test_${randomUUID().replaceAll("-", "")}`;
  const create = onTestDatabase(name, (n) => `CREATE DATABASE ${n} TEMPLATE ${TEMPLATE_DATABASE} OWNER crm_migrator`);
  await asAdmin(async (query) => {
    await query(create);
  });

  const opened: ReturnType<typeof createDatabase>[] = [];
  try {
    const revoke = onTestDatabase(name, (n) => `REVOKE ALL ON DATABASE ${n} FROM PUBLIC`);
    const grant = onTestDatabase(name, (n) => `GRANT CONNECT ON DATABASE ${n} TO crm_app, crm_worker`);
    await asAdmin(async (query) => {
      await query(revoke);
      await query(grant);
    });

    const app = await connectTo(requireEnv("DATABASE_URL_APP"), name, "crm-test-app");
    opened.push(app);
    const migrator = await connectTo(requireEnv("DATABASE_URL_MIGRATOR"), name, "crm-test-migrator");
    opened.push(migrator);

    return {
      app: app.db,
      migrator: migrator.db,
      async query<T extends object>(text: string, values: unknown[] = []) {
        const result = await migrator.pool.query<T>(text, values);
        return result.rows;
      },
      async close() {
        await app.pool.end();
        await migrator.pool.end();
        await dropTestDatabase(name);
      },
    };
  } catch (error) {
    // H4: never leave a half-created database behind.
    for (const connection of opened) await connection.pool.end();
    await dropTestDatabase(name);
    throw error;
  }
}
