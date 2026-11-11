import { DEFECT_SEVERITIES, DEFECT_STATUSES, QA_OUTCOMES, RELEASE_READINESS } from "@crm/contracts/quality";
import { defectSeverity, defectStatus, qaOutcome, releaseReadiness } from "@crm/database/schema";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./db.js";
import { createSuperAdmin, createUser, pgErrorCode } from "./helpers.js";

describe("database: quality constraints", () => {
  let db: TestDatabase;
  let ceoId = "";
  let projectId = "";
  let taskId = "";
  let otherTaskId = "";
  let checkId = "";
  let defectId = "";

  const insertTask = async (assigneeId: string): Promise<string> => {
    const [task] = await db.query<{ id: string }>(
      `INSERT INTO tasks (project_id, title, due_date, assignee_id, created_by)
       VALUES ($1, 'T', current_date + 1, $2, $3) RETURNING id`,
      [projectId, assigneeId, ceoId],
    );
    return task?.id ?? "";
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    ceoId = (await createSuperAdmin(db.migrator)).userId;
    const userId = await createUser(db.migrator, {
      email: "worker@example.test",
      name: "Worker",
      password: "test-worker-password",
      role: "employee",
    });
    const [project] = await db.query<{ id: string }>("INSERT INTO projects (name, created_by) VALUES ('P', $1) RETURNING id", [
      ceoId,
    ]);
    projectId = project?.id ?? "";
    taskId = await insertTask(userId);
    otherTaskId = await insertTask(userId);
    const [check] = await db.query<{ id: string }>(
      "INSERT INTO qa_checks (task_id, title, created_by) VALUES ($1, 'C', $2) RETURNING id",
      [taskId, ceoId],
    );
    checkId = check?.id ?? "";
    const [defect] = await db.query<{ id: string }>(
      `INSERT INTO defects (task_id, title, severity, reproduction_steps, reported_by)
       VALUES ($1, 'D', 'high', 'Steps', $2) RETURNING id`,
      [taskId, ceoId],
    );
    defectId = defect?.id ?? "";
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });

  const run = (statement: SQL) => pgErrorCode(db.migrator.execute(statement));

  it("contract enums match the database enums", () => {
    expect([...QA_OUTCOMES]).toEqual(qaOutcome.enumValues);
    expect([...DEFECT_SEVERITIES]).toEqual(defectSeverity.enumValues);
    expect([...DEFECT_STATUSES]).toEqual(defectStatus.enumValues);
    expect([...RELEASE_READINESS]).toEqual(releaseReadiness.enumValues);
  });

  it("QA checks: title length, and latest outcome and time set together", async () => {
    expect(await run(sql`INSERT INTO qa_checks (task_id, title, created_by) VALUES (${taskId}, '', ${ceoId})`)).toBe("23514");
    expect(await run(sql`UPDATE qa_checks SET latest_outcome = 'passed' WHERE id = ${checkId}`)).toBe("23514");
    expect(await run(sql`UPDATE qa_checks SET latest_outcome = 'passed', latest_result_at = now() WHERE id = ${checkId}`)).toBeNull();
  });

  it("QA results: failed and blocked need a note; evidence is https only", async () => {
    const insert = (outcome: string, note: string | null, url: string | null) =>
      run(sql`INSERT INTO qa_results (qa_check_id, outcome, note, evidence_url, recorded_by)
              VALUES (${checkId}, ${outcome}::qa_outcome, ${note}, ${url}, ${ceoId})`);
    expect(await insert("failed", null, null)).toBe("23514");
    expect(await insert("blocked", null, null)).toBe("23514");
    expect(await insert("passed", null, "http://example.test/x")).toBe("23514");
    expect(await insert("passed", null, "javascript:alert(1)")).toBe("23514");
    expect(await insert("failed", "Broken", "https://example.test/run")).toBeNull();
  });

  it("defects: a linked QA check must be on the same task; resolved_at matches final statuses", async () => {
    expect(
      await run(sql`INSERT INTO defects (task_id, qa_check_id, title, severity, reproduction_steps, reported_by)
                    VALUES (${otherTaskId}, ${checkId}, 'D', 'low', 'Steps', ${ceoId})`),
    ).toBe("23503");
    expect(
      await run(sql`INSERT INTO defects (task_id, title, severity, reproduction_steps, reported_by)
                    VALUES (${taskId}, 'D', 'low', '', ${ceoId})`),
    ).toBe("23514");
    expect(await run(sql`UPDATE defects SET status = 'verified' WHERE id = ${defectId}`)).toBe("23514");
    expect(await run(sql`UPDATE defects SET resolved_at = now() WHERE id = ${defectId}`)).toBe("23514");
    expect(await run(sql`UPDATE defects SET status = 'wont_fix', resolved_at = now() WHERE id = ${defectId}`)).toBeNull();
  });

  it("defect updates: content required, notes required for fixed, won't fix and reopening, https evidence", async () => {
    const insert = (note: string | null, url: string | null, from: string | null, to: string | null) =>
      run(sql`INSERT INTO defect_updates (defect_id, author_id, note, evidence_url, from_status, to_status)
              VALUES (${defectId}, ${ceoId}, ${note}, ${url}, ${from}::defect_status, ${to}::defect_status)`);
    expect(await insert(null, null, null, null)).toBe("23514");
    expect(await insert(null, null, "open", null)).toBe("23514");
    expect(await insert(null, null, "in_progress", "fixed")).toBe("23514");
    expect(await insert(null, null, "open", "wont_fix")).toBe("23514");
    expect(await insert(null, null, "fixed", "open")).toBe("23514");
    expect(await insert(null, "http://example.test/x", null, null)).toBe("23514");
    expect(await insert(null, null, "open", "in_progress")).toBeNull();
    expect(await insert(null, "https://example.test/x", null, null)).toBeNull();
  });

  it("release readiness: label length, and a note unless ready", async () => {
    const insert = (label: string, readiness: string, note: string | null) =>
      run(sql`INSERT INTO release_readiness (project_id, label, readiness, note, decided_by)
              VALUES (${projectId}, ${label}, ${readiness}::release_readiness_status,${note}, ${ceoId})`);
    expect(await insert("", "ready", null)).toBe("23514");
    expect(await insert("v1", "at_risk", null)).toBe("23514");
    expect(await insert("v1", "not_ready", null)).toBe("23514");
    expect(await insert("v1", "ready", null)).toBeNull();
  });
});
