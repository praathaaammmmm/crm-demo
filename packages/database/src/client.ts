import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseOptions {
  /** Shown in pg_stat_activity, e.g. "crm-api" or "crm-worker". */
  applicationName: string;
  maxConnections?: number;
}

export function createDatabase(connectionString: string, options: DatabaseOptions): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString,
    application_name: options.applicationName,
    max: options.maxConnections ?? 10,
  });
  return { db: drizzle({ client: pool, schema }), pool };
}
