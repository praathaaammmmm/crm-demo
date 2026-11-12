import { randomUUID } from "node:crypto";
import { connectTo, requireEnv, TEMPLATE_DATABASE } from "./db.js";

/** The only database names the local demo checks may create, seed or drop. Never crm, the template or postgres. */
export const DEMO_TEST_DATABASE_PATTERN = /^crm_demo_test_[0-9a-f]{32}$/;
const ADMIN_DATABASE = "postgres";

export function assertDemoTestDatabaseName(name: string): void {
  if (!DEMO_TEST_DATABASE_PATTERN.test(name)) {
    throw new Error("Refusing to act on a database that is not a disposable demo test database");
  }
}

/** True when every connection URL the demo checks use points at this machine. Prints nothing. */
export function connectionsAreLocal(names: readonly string[]): boolean {
  return names.every((name) => {
    const host = new URL(requireEnv(name)).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  });
}

/** Runs statements on the maintenance database after confirming it is exactly `postgres`. */
export async function asDemoAdmin<T>(run: (query: <R>(text: string, values?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
  const admin = await connectTo(requireEnv("TEST_DATABASE_ADMIN_URL"), ADMIN_DATABASE, "crm-demo-test-admin");
  try {
    return await run(async <R>(text: string, values: unknown[] = []) => (await admin.pool.query(text, values)).rows as R[]);
  } finally {
    await admin.pool.end();
  }
}

/** Creates crm_demo_test_<32 hex> from the migrated test template, with the same grants as test databases. */
export async function createDemoTestDatabase(): Promise<string> {
  const name = `crm_demo_test_${randomUUID().replaceAll("-", "")}`;
  assertDemoTestDatabaseName(name);
  await asDemoAdmin(async (query) => {
    await query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DATABASE} OWNER crm_migrator`);
    await query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
    await query(`GRANT CONNECT ON DATABASE ${name} TO crm_app, crm_worker`);
  });
  return name;
}

/** Drops one disposable demo database, ending its connections first. */
export async function dropDemoTestDatabase(name: string): Promise<void> {
  assertDemoTestDatabaseName(name);
  await asDemoAdmin(async (query) => {
    await query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  });
}

/** Pre/post isolation facts. Counts and booleans only. */
export async function isolationReport(): Promise<{
  demoDatabases: number;
  demoConnections: number;
  templateExists: boolean;
  crmExists: boolean;
}> {
  return asDemoAdmin(async (query) => {
    const [databases] = await query<{ n: string }>("SELECT count(*)::text AS n FROM pg_database WHERE datname LIKE 'crm\\_demo\\_test\\_%'");
    const [connections] = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname LIKE 'crm\\_demo\\_test\\_%' OR application_name LIKE 'crm-demo-seed%'",
    );
    const [template] = await query<{ ok: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS ok", [TEMPLATE_DATABASE]);
    const [crm] = await query<{ ok: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'crm') AS ok");
    return {
      demoDatabases: Number(databases?.n),
      demoConnections: Number(connections?.n),
      templateExists: template?.ok === true,
      crmExists: crm?.ok === true,
    };
  });
}

/** Row count of every base table in one database, read as crm_migrator after confirming the database. */
export async function tableCounts(database: string): Promise<Record<string, number>> {
  const connection = await connectTo(requireEnv("DATABASE_URL_MIGRATOR"), database, "crm-demo-test-counts");
  try {
    const { rows } = await connection.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
    );
    const counts: Record<string, number> = {};
    for (const { table_name: table } of rows) {
      if (!/^[a-z_]+$/.test(table)) continue;
      const result = await connection.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table}"`);
      counts[table] = Number(result.rows[0]?.n);
    }
    return counts;
  } finally {
    await connection.pool.end();
  }
}

/** Number of applied migrations in a database (drizzle's journal), read as crm_migrator. */
export async function appliedMigrations(database: string): Promise<number> {
  const connection = await connectTo(requireEnv("DATABASE_URL_MIGRATOR"), database, "crm-demo-test-journal");
  try {
    const { rows } = await connection.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations");
    return Number(rows[0]?.n);
  } finally {
    await connection.pool.end();
  }
}
