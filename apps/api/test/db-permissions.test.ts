import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./db.js";
import { createSuperAdmin, pgErrorCode } from "./helpers.js";

/** Each statement must be refused by grants (42501) when run as crm_app. */
const REFUSED_FOR_APP: [string, SQL][] = [
  ["update users.email", sql`UPDATE users SET email = 'changed@example.test'`],
  ["update users.reports_to_user_id", sql`UPDATE users SET reports_to_user_id = NULL`],
  ["update users.is_super_admin", sql`UPDATE users SET is_super_admin = false`],
  ["update approval type", sql`UPDATE approval_requests SET type = 'user.deactivate'`],
  ["update approval target", sql`UPDATE approval_requests SET target_user_id = NULL`],
  ["update approval payload", sql`UPDATE approval_requests SET payload = '{}'::jsonb`],
  ["update approval reason", sql`UPDATE approval_requests SET reason = 'changed'`],
  ["update approval requester", sql`UPDATE approval_requests SET requested_by = NULL`],
  ["update approval requested_at", sql`UPDATE approval_requests SET requested_at = now()`],
  ["delete users", sql`DELETE FROM users`],
  ["delete approval_requests", sql`DELETE FROM approval_requests`],
  ["delete sessions", sql`DELETE FROM sessions`],
  ["update audit_events", sql`UPDATE audit_events SET action = 'x.y'`],
  ["delete audit_events", sql`DELETE FROM audit_events`],
  ["truncate audit_events", sql`TRUNCATE audit_events`],
  ["update attendance_events", sql`UPDATE attendance_events SET kind = 'login'`],
  ["delete attendance_events", sql`DELETE FROM attendance_events`],
  ["truncate attendance_events", sql`TRUNCATE attendance_events`],
  ["read outbox_events", sql`SELECT count(*) FROM outbox_events`],
  // Slice 3: projects and tasks.
  ["update projects", sql`UPDATE projects SET name = 'changed'`],
  ["delete projects", sql`DELETE FROM projects`],
  ["update tasks.project_id", sql`UPDATE tasks SET project_id = NULL`],
  ["update tasks.created_by", sql`UPDATE tasks SET created_by = NULL`],
  ["update tasks.assignee_is_super_admin", sql`UPDATE tasks SET assignee_is_super_admin = true`],
  ["update tasks.created_at", sql`UPDATE tasks SET created_at = now()`],
  ["delete tasks", sql`DELETE FROM tasks`],
  ["truncate tasks", sql`TRUNCATE tasks`],
  ["update task_updates", sql`UPDATE task_updates SET note = 'changed'`],
  ["delete task_updates", sql`DELETE FROM task_updates`],
  ["update task_proofs", sql`UPDATE task_proofs SET url = NULL`],
  ["delete task_proofs", sql`DELETE FROM task_proofs`],
  ["update task_reviews", sql`UPDATE task_reviews SET note = 'changed'`],
  ["delete task_reviews", sql`DELETE FROM task_reviews`],
  // Slice 4: quality.
  ["update qa_checks.task_id", sql`UPDATE qa_checks SET task_id = NULL`],
  ["update qa_checks.title", sql`UPDATE qa_checks SET title = 'changed'`],
  ["delete qa_checks", sql`DELETE FROM qa_checks`],
  ["truncate qa_checks", sql`TRUNCATE qa_checks`],
  ["update qa_results", sql`UPDATE qa_results SET note = 'changed'`],
  ["delete qa_results", sql`DELETE FROM qa_results`],
  ["update defects.task_id", sql`UPDATE defects SET task_id = NULL`],
  ["update defects.reported_by", sql`UPDATE defects SET reported_by = NULL`],
  ["update defects.qa_check_id", sql`UPDATE defects SET qa_check_id = NULL`],
  ["delete defects", sql`DELETE FROM defects`],
  ["truncate defects", sql`TRUNCATE defects`],
  ["update defect_updates", sql`UPDATE defect_updates SET note = 'changed'`],
  ["delete defect_updates", sql`DELETE FROM defect_updates`],
  ["update release_readiness", sql`UPDATE release_readiness SET readiness = 'ready'`],
  ["delete release_readiness", sql`DELETE FROM release_readiness`],
  ["truncate release_readiness", sql`TRUNCATE release_readiness`],
];

describe("database: crm_app least privilege", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await createSuperAdmin(db.migrator);
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });

  it.each(REFUSED_FOR_APP)("refuses: %s", async (_label, statement) => {
    expect(await pgErrorCode(db.app.execute(statement))).toBe("42501");
  });
});
