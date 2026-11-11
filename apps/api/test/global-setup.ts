import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectTo, dropLeftoverTestDatabases, requireEnv, TEMPLATE_DATABASE } from "./db.js";

/**
 * Applies the reviewed SQL migrations to the test template once per run, as crm_migrator.
 * Returns a teardown that drops any throwaway test databases left behind (H5).
 */
export default async function setup(): Promise<() => Promise<void>> {
  // H3: connectTo confirms current_database() is exactly the template before anything runs.
  const { db, pool } = await connectTo(requireEnv("DATABASE_URL_MIGRATOR"), TEMPLATE_DATABASE, "crm-test-setup");
  try {
    const { rows } = await pool.query<{ role: string }>("SELECT current_user AS role");
    if (rows[0]?.role !== "crm_migrator") throw new Error("The test template must be migrated as crm_migrator");
    const migrationsFolder = fileURLToPath(new URL("../../../packages/database/migrations", import.meta.url));
    await migrate(db, { migrationsFolder });
  } finally {
    // The template must have no open connections when test databases are copied from it.
    await pool.end();
  }

  return async () => {
    await dropLeftoverTestDatabases();
  };
}
