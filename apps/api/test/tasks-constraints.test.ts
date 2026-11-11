import { TASK_PRIORITIES, TASK_REVIEW_DECISIONS, TASK_STATUSES } from "@crm/contracts/tasks";
import { taskPriority, taskReviewDecision, taskStatus } from "@crm/database/schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./db.js";
import { createSuperAdmin, createUser, pgErrorCode } from "./helpers.js";

describe("database: project and task constraints", () => {
  let db: TestDatabase;
  let ceoId = "";
  let userId = "";
  let projectId = "";
  let taskId = "";

  beforeAll(async () => {
    db = await createTestDatabase();
    ceoId = (await createSuperAdmin(db.migrator)).userId;
    userId = await createUser(db.migrator, {
      email: "worker@example.test",
      name: "Worker",
      password: "test-worker-password",
      role: "employee",
    });
    const [project] = await db.query<{ id: string }>(
      "INSERT INTO projects (name, created_by) VALUES ('P', $1) RETURNING id",
      [ceoId],
    );
    projectId = project?.id ?? "";
    const [task] = await db.query<{ id: string }>(
      `INSERT INTO tasks (project_id, title, due_date, assignee_id, created_by)
       VALUES ($1, 'T', current_date + 1, $2, $3) RETURNING id`,
      [projectId, userId, ceoId],
    );
    taskId = task?.id ?? "";
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });

  it("contract enums match the database enums", () => {
    expect([...TASK_STATUSES]).toEqual(taskStatus.enumValues);
    expect([...TASK_PRIORITIES]).toEqual(taskPriority.enumValues);
    expect([...TASK_REVIEW_DECISIONS]).toEqual(taskReviewDecision.enumValues);
  });

  it("never allows the CEO/CTO as an assignee", async () => {
    expect(
      await pgErrorCode(
        db.migrator.execute(sql`
          INSERT INTO tasks (project_id, title, due_date, assignee_id, created_by)
          VALUES (${projectId}, 'T', current_date + 1, ${ceoId}, ${ceoId})
        `),
      ),
    ).toBe("23503");
    expect(await pgErrorCode(db.migrator.execute(sql`UPDATE tasks SET assignee_id = ${ceoId} WHERE id = ${taskId}`))).toBe(
      "23503",
    );
    expect(
      await pgErrorCode(db.migrator.execute(sql`UPDATE tasks SET assignee_is_super_admin = true WHERE id = ${taskId}`)),
    ).toBe("23514");
  });

  it("rejects an empty task title", async () => {
    expect(await pgErrorCode(db.migrator.execute(sql`UPDATE tasks SET title = '' WHERE id = ${taskId}`))).toBe("23514");
  });

  it("keeps completed_at consistent with the completed status", async () => {
    expect(await pgErrorCode(db.migrator.execute(sql`UPDATE tasks SET status = 'completed' WHERE id = ${taskId}`))).toBe(
      "23514",
    );
    expect(await pgErrorCode(db.migrator.execute(sql`UPDATE tasks SET completed_at = now() WHERE id = ${taskId}`))).toBe(
      "23514",
    );
  });

  it("requires an existing project", async () => {
    expect(
      await pgErrorCode(
        db.migrator.execute(sql`
          INSERT INTO tasks (project_id, title, due_date, assignee_id, created_by)
          VALUES ('0196f3a0-0000-7000-8000-000000000000', 'T', current_date + 1, ${userId}, ${ceoId})
        `),
      ),
    ).toBe("23503");
  });

  it("requires proofs to have content and https URLs only", async () => {
    const insertProof = (url: string | null, note: string | null) =>
      db.migrator.execute(sql`INSERT INTO task_proofs (task_id, author_id, url, note) VALUES (${taskId}, ${userId}, ${url}, ${note})`);
    expect(await pgErrorCode(insertProof(null, null))).toBe("23514");
    expect(await pgErrorCode(insertProof("http://example.test/a", null))).toBe("23514");
    expect(await pgErrorCode(insertProof("https://", null))).toBe("23514");
    expect(await pgErrorCode(insertProof("https://example.test/a", null))).toBeNull();
  });

  it("requires a note for change requests, and content for updates", async () => {
    expect(
      await pgErrorCode(
        db.migrator.execute(sql`
          INSERT INTO task_reviews (task_id, reviewer_id, decision) VALUES (${taskId}, ${ceoId}, 'changes_requested')
        `),
      ),
    ).toBe("23514");
    expect(
      await pgErrorCode(db.migrator.execute(sql`INSERT INTO task_updates (task_id, author_id) VALUES (${taskId}, ${userId})`)),
    ).toBe("23514");
    expect(
      await pgErrorCode(
        db.migrator.execute(sql`
          INSERT INTO task_updates (task_id, author_id, from_status) VALUES (${taskId}, ${userId}, 'todo')
        `),
      ),
    ).toBe("23514");
  });
});
