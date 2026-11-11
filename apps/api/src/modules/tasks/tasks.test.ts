import { projectResponseSchema } from "@crm/contracts/projects";
import {
  taskDetailResponseSchema,
  taskPageSchema,
  taskResponseSchema,
  taskSummarySchema,
  type Task,
} from "@crm/contracts/tasks";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import {
  buildTestApp,
  call,
  createSuperAdmin,
  createUser,
  dateFromToday,
  loginToken,
  SUPER_ADMIN,
  TEST_ORIGIN,
} from "../../../test/helpers.js";

const person = (key: string) => ({ email: `${key}@example.test`, name: `Test ${key}`, password: `test-${key}-password` });
const CFO = person("cfo");
const ALICE = person("alice");
const BOB = person("bob");
const DORA = person("dora");

/** Distinctive free text that must never appear in audit events. */
const SECRET_TEXT = "private-note-text-7f3a";

describe("tasks", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let projectId = "";
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const id = (key: string): string => {
    const value = ids[key];
    if (value === undefined) throw new Error(`unknown user ${key}`);
    return value;
  };
  const as = (key: string): string => {
    const value = tokens[key];
    if (value === undefined) throw new Error(`no token for ${key}`);
    return value;
  };
  const post = (who: string, url: string, payload?: object) =>
    call(app, { method: "POST", url, token: as(who), ...(payload === undefined ? {} : { payload }) });
  const get = (who: string, url: string) => call(app, { method: "GET", url, token: as(who) });
  const patch = (who: string, url: string, payload: object) =>
    app.inject({ method: "PATCH", url, headers: { origin: TEST_ORIGIN }, cookies: { crm_session: as(who) }, payload });
  const taskOf = (response: { json: () => unknown }): Task => taskResponseSchema.parse(response.json()).task;

  const newTask = async (assignee: string, overrides: object = {}): Promise<Task> => {
    const response = await post("ceo", "/api/v1/tasks", {
      projectId,
      title: "Prepare the quarterly report",
      description: SECRET_TEXT,
      priority: "high",
      dueDate: dateFromToday(5),
      assigneeId: id(assignee),
      ...overrides,
    });
    expect(response.statusCode).toBe(201);
    return taskOf(response);
  };
  const auditFor = (taskId: string) =>
    db.query<{ action: string; before: unknown; after: unknown }>(
      "SELECT action, before, after FROM audit_events WHERE entity_type = 'task' AND entity_id = $1 ORDER BY occurred_at, id",
      [taskId],
    );

  beforeAll(async () => {
    db = await createTestDatabase();
    ids["ceo"] = (await createSuperAdmin(db.migrator)).userId;
    ids["cfo"] = await createUser(db.migrator, { ...CFO, role: "cfo" });
    ids["alice"] = await createUser(db.migrator, { ...ALICE, role: "employee" });
    ids["bob"] = await createUser(db.migrator, { ...BOB, role: "intern" });
    ids["dora"] = await createUser(db.migrator, { ...DORA, role: "employee" });
    await db.query("UPDATE users SET status = 'deactivated', deactivated_at = now() WHERE id = $1", [id("dora")]);

    // Logins happen once, outside the per-test app, so the per-app login rate limit is never reached.
    const setupApp = await buildTestApp(db.app);
    for (const [key, who] of [["ceo", SUPER_ADMIN], ["cfo", CFO], ["alice", ALICE], ["bob", BOB]] as const) {
      tokens[key] = await loginToken(setupApp, who.email, who.password);
    }
    const project = await call(setupApp, {
      method: "POST",
      url: "/api/v1/projects",
      token: as("ceo"),
      payload: { name: "Operations" },
    });
    projectId = projectResponseSchema.parse(project.json()).project.id;
    await setupApp.close();
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });
  beforeEach(async () => {
    app = await buildTestApp(db.app);
  });
  afterEach(async () => {
    await (app as FastifyInstance | undefined)?.close();
  });

  it("summary: exact counts for overdue, blocked, pending review and completed (CEO only)", async () => {
    const overdue = await newTask("alice");
    const blocked = await newTask("alice");
    const inReview = await newTask("alice");
    const done = await newTask("alice");
    await newTask("alice"); // open and not overdue: counted nowhere
    await db.query("UPDATE tasks SET due_date = $2::date WHERE id = $1", [overdue.id, dateFromToday(-1)]);
    await db.query("UPDATE tasks SET status = 'blocked' WHERE id = $1", [blocked.id]);
    await db.query("UPDATE tasks SET status = 'in_review' WHERE id = $1", [inReview.id]);
    await db.query("UPDATE tasks SET status = 'completed', completed_at = now(), due_date = $2::date WHERE id = $1", [
      done.id,
      dateFromToday(-2),
    ]);

    const response = await get("ceo", "/api/v1/tasks/summary");
    expect(response.statusCode).toBe(200);
    expect(taskSummarySchema.parse(response.json())).toEqual({ overdue: 1, blocked: 1, pendingReview: 1, completed: 1 });

    const listed = taskPageSchema.parse((await get("ceo", "/api/v1/tasks?overdue=true")).json());
    expect(listed.items.map((t) => t.id)).toEqual([overdue.id]);

    expect((await get("alice", "/api/v1/tasks/summary")).statusCode).toBe(403);
    expect((await get("cfo", "/api/v1/tasks/summary")).statusCode).toBe(403);
  });

  it("creation: CEO only, active non-CEO assignee, existing project, no past due date; audited without text", async () => {
    const task = await newTask("alice");
    expect(task).toMatchObject({ status: "todo", priority: "high", assigneeId: id("alice"), overdue: false, completedAt: null });

    expect((await post("cfo", "/api/v1/tasks", { projectId, title: "x", priority: "low", dueDate: dateFromToday(1), assigneeId: id("alice") })).statusCode).toBe(403);
    const base = { projectId, title: "x", priority: "low", dueDate: dateFromToday(1) };
    expect((await post("ceo", "/api/v1/tasks", { ...base, assigneeId: id("ceo") })).statusCode).toBe(400);
    expect((await post("ceo", "/api/v1/tasks", { ...base, assigneeId: id("dora") })).statusCode).toBe(400);
    expect((await post("ceo", "/api/v1/tasks", { ...base, assigneeId: "0196f3a0-0000-7000-8000-000000000000" })).statusCode).toBe(400);
    expect((await post("ceo", "/api/v1/tasks", { ...base, assigneeId: id("alice"), dueDate: dateFromToday(-1) })).statusCode).toBe(400);
    expect(
      (await post("ceo", "/api/v1/tasks", { ...base, assigneeId: id("alice"), projectId: "0196f3a0-0000-7000-8000-000000000000" })).statusCode,
    ).toBe(404);

    expect(await auditFor(task.id)).toEqual([
      {
        action: "task.created",
        before: null,
        after: { assigneeId: id("alice"), priority: "high", dueDate: task.dueDate, status: "todo", projectId },
      },
    ]);
  });

  it("visibility: assignees see only their own tasks; others get 404; the CEO gets 403 on assignee actions", async () => {
    const task = await newTask("alice");
    const aliceList = taskPageSchema.parse((await get("alice", "/api/v1/tasks")).json());
    expect(aliceList.items.every((t) => t.assigneeId === id("alice"))).toBe(true);
    const bobList = taskPageSchema.parse((await get("bob", "/api/v1/tasks")).json());
    expect(bobList.items.some((t) => t.id === task.id)).toBe(false);

    expect((await get("bob", `/api/v1/tasks/${task.id}`)).statusCode).toBe(404);
    expect((await post("bob", `/api/v1/tasks/${task.id}/status`, { status: "in_progress" })).statusCode).toBe(404);
    expect((await post("bob", `/api/v1/tasks/${task.id}/updates`, { note: "hi" })).statusCode).toBe(404);
    expect((await post("ceo", `/api/v1/tasks/${task.id}/status`, { status: "in_progress" })).statusCode).toBe(403);
    expect((await get("ceo", `/api/v1/tasks/${task.id}`)).statusCode).toBe(200);
  });

  it("status rules, proof rules and submission", async () => {
    const task = await newTask("alice");
    const url = `/api/v1/tasks/${task.id}`;

    expect((await post("alice", `${url}/status`, { status: "blocked", note: "x" })).statusCode).toBe(409);
    expect(taskOf(await post("alice", `${url}/status`, { status: "in_progress" })).status).toBe("in_progress");
    expect((await post("alice", `${url}/status`, { status: "blocked" })).statusCode).toBe(400);
    expect(taskOf(await post("alice", `${url}/status`, { status: "blocked", note: SECRET_TEXT })).status).toBe("blocked");
    expect(taskOf(await post("alice", `${url}/status`, { status: "in_progress" })).status).toBe("in_progress");
    expect((await post("alice", `${url}/updates`, { note: SECRET_TEXT })).statusCode).toBe(201);

    expect((await post("alice", `${url}/submit`)).statusCode).toBe(409);
    expect((await post("alice", `${url}/proofs`, { url: "http://example.test/report" })).statusCode).toBe(400);
    expect((await post("alice", `${url}/proofs`, { url: "not a url" })).statusCode).toBe(400);
    expect((await post("alice", `${url}/proofs`, {})).statusCode).toBe(400);
    expect((await post("alice", `${url}/proofs`, { url: "https://example.test/report", note: SECRET_TEXT })).statusCode).toBe(201);

    expect(taskOf(await post("alice", `${url}/submit`, { note: "Ready" })).status).toBe("in_review");
    expect((await post("alice", `${url}/status`, { status: "in_progress" })).statusCode).toBe(409);
  });

  it("CEO review: changes need a note; resubmission; approval completes; completed tasks are final", async () => {
    const task = await newTask("alice");
    const url = `/api/v1/tasks/${task.id}`;
    await post("alice", `${url}/status`, { status: "in_progress" });
    await post("alice", `${url}/proofs`, { note: "Draft attached in the shared drive" });
    await post("alice", `${url}/submit`);

    expect((await post("alice", `${url}/review`, { decision: "approved" })).statusCode).toBe(403);
    expect((await post("ceo", `${url}/review`, { decision: "changes_requested" })).statusCode).toBe(400);
    expect(taskOf(await post("ceo", `${url}/review`, { decision: "changes_requested", note: SECRET_TEXT })).status).toBe(
      "changes_requested",
    );
    expect(taskOf(await post("alice", `${url}/submit`)).status).toBe("in_review");

    const approved = taskOf(await post("ceo", `${url}/review`, { decision: "approved" }));
    expect(approved.status).toBe("completed");
    expect(approved.completedAt).not.toBeNull();

    expect((await post("ceo", `${url}/review`, { decision: "approved" })).statusCode).toBe(409);
    expect((await post("ceo", `${url}/complete`)).statusCode).toBe(409);
    expect((await patch("ceo", url, { priority: "low" })).statusCode).toBe(409);
    expect((await post("alice", `${url}/proofs`, { note: "late" })).statusCode).toBe(409);
    expect((await post("alice", `${url}/updates`, { note: "late" })).statusCode).toBe(409);

    const detail = taskDetailResponseSchema.parse((await get("alice", url)).json());
    expect(detail.reviews.map((r) => r.decision)).toEqual(["changes_requested", "approved"]);
    expect(detail.updates.map((u) => u.toStatus)).toEqual(["in_progress", "in_review", "in_review"]);
    expect(detail.updates.every((u) => u.authorId === id("alice"))).toBe(true);
    expect(detail.proofs).toHaveLength(1);
  });

  it("CEO can mark any open task complete, recorded as a marked_complete review", async () => {
    const task = await newTask("alice");
    await post("alice", `/api/v1/tasks/${task.id}/status`, { status: "in_progress" });
    const completed = taskOf(await post("ceo", `/api/v1/tasks/${task.id}/complete`, { note: "Done offline" }));
    expect(completed.status).toBe("completed");
    const detail = taskDetailResponseSchema.parse((await get("ceo", `/api/v1/tasks/${task.id}`)).json());
    expect(detail.reviews.map((r) => r.decision)).toEqual(["marked_complete"]);
  });

  it("reassignment moves access to the new assignee and is audited", async () => {
    const task = await newTask("alice");
    const url = `/api/v1/tasks/${task.id}`;
    expect((await patch("alice", url, { assigneeId: id("bob") })).statusCode).toBe(403);
    expect((await patch("ceo", url, { assigneeId: id("ceo") })).statusCode).toBe(400);

    const moved = taskOf(await patch("ceo", url, { assigneeId: id("bob"), title: "Renamed" }));
    expect(moved.assigneeId).toBe(id("bob"));
    expect((await get("alice", url)).statusCode).toBe(404);
    expect((await get("bob", url)).statusCode).toBe(200);

    const audits = await auditFor(task.id);
    expect(audits.at(-1)).toEqual({
      action: "task.updated",
      before: { assigneeId: id("alice"), priority: "high", dueDate: task.dueDate, status: "todo" },
      after: {
        assigneeId: id("bob"),
        priority: "high",
        dueDate: task.dueDate,
        status: "todo",
        titleChanged: true,
        descriptionChanged: false,
      },
    });
  });

  it("never records titles, descriptions, notes or proof URLs in audit events", async () => {
    const [row] = await db.query<{ leaks: string }>(
      `SELECT count(*)::text AS leaks FROM audit_events
       WHERE coalesce(before::text, '') || coalesce(after::text, '') ~* $1`,
      [`${SECRET_TEXT}|example\\.test/report|quarterly report`],
    );
    expect(row?.leaks).toBe("0");
  });
});
