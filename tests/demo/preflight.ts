/**
 * Read-only preflight for the local demo checks. Run with: node tests/demo/preflight.ts
 * Loads .env into this process only and prints booleans and counts, never values.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { appliedMigrations, connectionsAreLocal, isolationReport, tableCounts } from "../../apps/api/dist/test/demo-db.js";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
export const DB_URLS = ["DATABASE_URL_MIGRATOR", "DATABASE_URL_APP", "TEST_DATABASE_ADMIN_URL"] as const;
export const EXPECTED_MIGRATIONS = 22;

export function portsFree(ports: readonly number[]): boolean {
  const filter = ports.map((port) => `sport = :${String(port)}`).join(" or ");
  const out = execFileSync("ss", ["-H", "-ltn", `( ${filter} )`], { encoding: "utf8" });
  return out.trim() === "";
}

export async function preflight(): Promise<{ ok: boolean; crmCounts: Record<string, number> }> {
  process.loadEnvFile(path.join(REPO_ROOT, ".env"));
  const localOnly = connectionsAreLocal(DB_URLS);
  console.log(`localOnly=${String(localOnly)}`);
  if (!localOnly) return { ok: false, crmCounts: {} };

  const report = await isolationReport();
  console.log(`pre: demoDatabases=${String(report.demoDatabases)} demoConnections=${String(report.demoConnections)} template=${String(report.templateExists)} crm=${String(report.crmExists)}`);
  const migrations = report.templateExists ? await appliedMigrations("crm_test_template") : 0;
  console.log(`templateMigrations=${String(migrations)} expected=${String(EXPECTED_MIGRATIONS)}`);
  const ports = portsFree([3100, 4100]);
  console.log(`ports3100and4100Free=${String(ports)}`);
  const crmCounts = report.crmExists ? await tableCounts("crm") : {};
  console.log(`crmBaselineTables=${String(Object.keys(crmCounts).length)}`);

  const ok = report.demoDatabases === 0 && report.demoConnections === 0 && report.templateExists && migrations === EXPECTED_MIGRATIONS && ports;
  console.log(`preflight=${ok ? "PASS" : "FAIL"}`);
  return { ok, crmCounts };
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  preflight()
    .then(({ ok }) => {
      process.exitCode = ok ? 0 : 1;
    })
    .catch((error: unknown) => {
      console.error(`preflight error: ${error instanceof Error ? error.name : "unknown"}`);
      process.exitCode = 1;
    });
}
