import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const MIGRATOR_ROLE = "crm_migrator";

/** Errors raised by this script itself; their messages contain no secrets. */
class MigrationSetupError extends Error {}

const MAX_MESSAGE_LENGTH = 300;

/** Removes anything that could carry credentials from a database error message. */
function sanitize(message: string): string {
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b(password|passwd|pwd|token|secret)\b\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * Returns "[code] message" from the underlying database or network error.
 * Never returns the failing SQL statement: Drizzle's wrapper message ("Failed query: ...") is skipped.
 */
function describeFailure(error: unknown): string {
  if (error instanceof MigrationSetupError) return error.message;

  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if ("code" in current && typeof current.code === "string") {
      return `[${current.code}] ${sanitize(current.message)}`;
    }
    current = current.cause;
  }
  return "no database error details available";
}

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL_MIGRATOR"];
  if (!url) throw new MigrationSetupError("DATABASE_URL_MIGRATOR is not set");

  const pool = new pg.Pool({ connectionString: url, max: 1, application_name: "crm-migrate" });
  try {
    const { rows } = await pool.query<{ current_user: string }>("SELECT current_user");
    if (rows[0]?.current_user !== MIGRATOR_ROLE) {
      throw new MigrationSetupError(`Migrations must run as ${MIGRATOR_ROLE}`);
    }
    const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
    await migrate(drizzle({ client: pool }), { migrationsFolder });
    console.log("Migrations applied");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`Migration failed: ${describeFailure(error)}`);
  process.exitCode = 1;
});
