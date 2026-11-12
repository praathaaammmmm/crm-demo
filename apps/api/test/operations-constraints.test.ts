import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./db.js";
import { createSuperAdmin, createUser, pgErrorCode } from "./helpers.js";

describe("database: engineering operations", () => {
  let db: TestDatabase;
  let vpId = "";

  const asMigrator = (statement: SQL) => pgErrorCode(db.migrator.execute(statement));
  const asApp = (statement: SQL) => pgErrorCode(db.app.execute(statement));
  const asWorker = (statement: SQL) => pgErrorCode(db.worker.execute(statement));
  const one = async (text: string, values: unknown[]): Promise<string> => {
    const [row] = await db.query<{ id: string }>(text, values);
    return row?.id ?? "";
  };
  const incident = () => one("INSERT INTO ops_incidents (title, severity, owner_id, created_by) VALUES ('Down', 'sev2', $1, $1) RETURNING id", [vpId]);
  const release = (environment: "staging" | "production") =>
    one("INSERT INTO ops_releases (name, version_label, environment, created_by) VALUES ('R', 'v1', $1, $2) RETURNING id", [environment, vpId]);
  const item = (releaseId: string) => one("INSERT INTO ops_release_checklist_items (release_id, label, created_by) VALUES ($1, 'Check', $2) RETURNING id", [releaseId, vpId]);
  const automation = () => one("INSERT INTO ops_automations (name, purpose, trigger_description, created_by) VALUES ('A', 'P', 'T', $1) RETURNING id", [vpId]);
  const setStatus = (table: string, id: string, status: string) =>
    asMigrator(sql`UPDATE ${sql.identifier(table)} SET status = ${status} WHERE id = ${id}`);

  beforeAll(async () => {
    db = await createTestDatabase();
    // The hierarchy trigger requires the Super Admin before any other user.
    await createSuperAdmin(db.migrator);
    vpId = await createUser(db.migrator, { email: "vp@example.test", name: "VP", password: "test-vp-password", role: "vp_engineering_quality" });
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });

  it("grants: histories are insert-only for crm_app, nothing is deletable, and crm_worker has no access", async () => {
    const id = await incident();
    await db.query("INSERT INTO ops_incident_updates (incident_id, kind, note, actor_id) VALUES ($1, 'note', 'n', $2)", [id, vpId]);
    expect(await asApp(sql`UPDATE ops_incident_updates SET note = 'x'`)).toBe("42501");
    expect(await asApp(sql`DELETE FROM ops_incidents WHERE id = ${id}`)).toBe("42501");
    expect(await asApp(sql`UPDATE ops_incidents SET created_by = ${vpId} WHERE id = ${id}`)).toBe("42501");
    expect(await asApp(sql`UPDATE ops_releases SET environment = 'staging'`)).toBe("42501");
    expect(await asApp(sql`UPDATE ops_automation_runs SET outcome = 'succeeded'`)).toBe("42501");
    expect(await asApp(sql`UPDATE ops_release_decisions SET note = 'x'`)).toBe("42501");
    for (const table of ["ops_incidents", "ops_incident_updates", "ops_releases", "ops_release_checklist_items", "ops_release_decisions", "ops_automations", "ops_automation_changes", "ops_automation_runs"]) {
      expect(await asWorker(sql`SELECT 1 FROM ${sql.identifier(table)} LIMIT 1`)).toBe("42501");
      // Statement-level guard: refused even for the owner, whether or not the table has rows.
      expect(await asMigrator(sql`TRUNCATE ${sql.identifier(table)} CASCADE`)).toBe("23514");
    }
    expect(await asMigrator(sql`DELETE FROM ops_incidents WHERE id = ${id}`)).toBe("23514");
    expect(await asMigrator(sql`DELETE FROM ops_incident_updates WHERE incident_id = ${id}`)).toBe("23514");
  });

  it("incidents: status pairs, resolution fields together, and a resolved incident only gains its post-incident note once", async () => {
    const id = await incident();
    expect(await setStatus("ops_incidents", id, "resolved")).toBe("23514");
    expect(await asMigrator(sql`UPDATE ops_incidents SET post_incident_note = 'early' WHERE id = ${id}`)).toBe("23514");
    expect(await setStatus("ops_incidents", id, "investigating")).toBeNull();
    expect(await setStatus("ops_incidents", id, "open")).toBe("23514");
    expect(await asMigrator(sql`UPDATE ops_incidents SET status = 'resolved', resolution = 'Fixed', resolved_at = now() WHERE id = ${id}`)).toBeNull();
    expect(await asMigrator(sql`UPDATE ops_incidents SET severity = 'sev1' WHERE id = ${id}`)).toBe("23514");
    expect(await asMigrator(sql`UPDATE ops_incidents SET post_incident_note = 'Lessons' WHERE id = ${id}`)).toBeNull();
    expect(await asMigrator(sql`UPDATE ops_incidents SET post_incident_note = 'Rewritten' WHERE id = ${id}`)).toBe("23514");
    expect(await asMigrator(sql`INSERT INTO ops_incident_updates (incident_id, kind, actor_id) VALUES (${id}, 'note', ${vpId})`)).toBe("23514");
    expect(await asMigrator(sql`INSERT INTO ops_incident_updates (incident_id, kind, from_status, to_status, actor_id) VALUES (${id}, 'status', 'open', 'open', ${vpId})`)).toBe("23514");
    expect(await asMigrator(sql`UPDATE ops_incident_updates SET note = 'x'`)).toBe("23514");
  });

  it("releases: production needs approval before an outcome, a complete checklist to leave draft, and drafts alone are editable", async () => {
    const prod = await release("production");
    expect(await setStatus("ops_releases", prod, "awaiting_approval")).toBe("23514");
    const check = await item(prod);
    expect(await setStatus("ops_releases", prod, "awaiting_approval")).toBe("23514");
    expect(await asMigrator(sql`UPDATE ops_release_checklist_items SET done = true WHERE id = ${check}`)).toBe("23514");
    expect(await asMigrator(sql`UPDATE ops_release_checklist_items SET done = true, done_by = ${vpId}, done_at = now() WHERE id = ${check}`)).toBeNull();
    expect(await setStatus("ops_releases", prod, "deployed")).toBe("23514");
    expect(await setStatus("ops_releases", prod, "awaiting_approval")).toBeNull();
    expect(await asMigrator(sql`UPDATE ops_releases SET name = 'Renamed' WHERE id = ${prod}`)).toBe("23514");
    expect(await asMigrator(sql`INSERT INTO ops_release_checklist_items (release_id, label, created_by) VALUES (${prod}, 'Late', ${vpId})`)).toBe("23514");
    expect(await setStatus("ops_releases", prod, "deployed")).toBe("23514");
    expect(await setStatus("ops_releases", prod, "approved")).toBeNull();
    expect(await setStatus("ops_releases", prod, "deployed")).toBeNull();
    expect(await setStatus("ops_releases", prod, "rolled_back")).toBeNull();
    expect(await setStatus("ops_releases", prod, "deployed")).toBe("23514");
    expect(await asMigrator(sql`UPDATE ops_releases SET environment = 'staging' WHERE id = ${prod}`)).toBe("23514");

    const staging = await release("staging");
    await db.query("UPDATE ops_release_checklist_items SET done = true, done_by = $2, done_at = now() WHERE id = $1", [await item(staging), vpId]);
    expect(await setStatus("ops_releases", staging, "awaiting_approval")).toBe("23514");
    expect(await setStatus("ops_releases", staging, "deployed")).toBeNull();

    expect(await asMigrator(sql`INSERT INTO ops_release_decisions (release_id, from_status, to_status, actor_id) VALUES (${prod}, 'deployed', 'rolled_back', ${vpId})`)).toBe("23514");
    expect(await asMigrator(sql`INSERT INTO ops_release_decisions (release_id, from_status, to_status, note, actor_id) VALUES (${prod}, 'deployed', 'rolled_back', 'Errors', ${vpId})`)).toBeNull();
    expect(await asMigrator(sql`UPDATE ops_release_decisions SET note = 'Rewritten'`)).toBe("23514");
  });

  it("automations: lifecycle pairs, retired is final, runs need an eligible automation and a safe single-line summary", async () => {
    const id = await automation();
    const insertRun = (outcome: string, summary: string | null) =>
      asMigrator(sql`INSERT INTO ops_automation_runs (automation_id, started_at, finished_at, outcome, error_summary, recorded_by)
                     VALUES (${id}, now() - interval '1 minute', now(), ${outcome}::ops_run_outcome, ${summary}, ${vpId})`);
    expect(await insertRun("succeeded", null)).toBe("23514");
    expect(await setStatus("ops_automations", id, "live")).toBe("23514");
    expect(await setStatus("ops_automations", id, "testing")).toBeNull();
    expect(await insertRun("succeeded", null)).toBeNull();
    expect(await insertRun("failed", null)).toBe("23514");
    expect(await insertRun("succeeded", "x")).toBe("23514");
    expect(await insertRun("failed", "see https://logs.example")).toBe("23514");
    expect(await insertRun("failed", "line one\nline two")).toBe("23514");
    expect(await insertRun("failed", "Queue timeout")).toBeNull();
    expect(await setStatus("ops_automations", id, "awaiting_approval")).toBeNull();
    expect(await setStatus("ops_automations", id, "live")).toBeNull();
    expect(await asMigrator(sql`UPDATE ops_automations SET purpose = 'Changed' WHERE id = ${id}`)).toBe("23514");
    expect(await setStatus("ops_automations", id, "retired")).toBeNull();
    expect(await setStatus("ops_automations", id, "live")).toBe("23514");
    expect(await insertRun("succeeded", null)).toBe("23514");
    expect(await asMigrator(sql`INSERT INTO ops_automation_changes (automation_id, from_status, to_status, actor_id) VALUES (${id}, 'awaiting_approval', 'testing', ${vpId})`)).toBe("23514");
    expect(await asMigrator(sql`UPDATE ops_automation_runs SET error_summary = 'x'`)).toBe("23514");
    expect(await asMigrator(sql`TRUNCATE ops_automation_runs`)).toBe("23514");
  });
});
