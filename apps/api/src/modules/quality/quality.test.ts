import { errorResponseSchema } from "@crm/contracts/common";
import { projectResponseSchema } from "@crm/contracts/projects";
import {
  defectDetailResponseSchema,
  defectPageSchema,
  defectResponseSchema,
  qaCheckDetailResponseSchema,
  qaCheckPageSchema,
  qaCheckResponseSchema,
  qaResultResponseSchema,
  qualitySummaryResponseSchema,
  readinessPageSchema,
  type Defect,
  type QaCheck,
} from "@crm/contracts/quality";
import { taskResponseSchema, type Task } from "@crm/contracts/tasks";
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
const VP = person("vp");
const CFO = person("cfo");
const ALICE = person("alice");
const BOB = person("bob");

/** Distinctive free text that must never appear in audit events. */
const SECRET_TEXT = "private-quality-text-9c1e";
const SECRET_URL = "https://example.test/private-evidence-9c1e";

describe("quality", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
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
  const post = (who: string, url: string, payload: object = {}) => call(app, { method: "POST", url, token: as(who), payload });
  const get = (who: string, url: string) => call(app, { method: "GET", url, token: as(who) });
  const patch = (who: string, url: string, payload: object) =>
    app.inject({ method: "PATCH", url, headers: { origin: TEST_ORIGIN }, cookies: { crm_session: as(who) }, payload });

  const newProject = async (name: string): Promise<string> => {
    const response = await post("ceo", "/api/v1/projects", { name });
    expect(response.statusCode).toBe(201);
    return projectResponseSchema.parse(response.json()).project.id;
  };
  const newTask = async (projectId: string, assignee: string): Promise<Task> => {
    const response = await post("ceo", "/api/v1/tasks", {
      projectId,
      title: "Build the export",
      priority: "medium",
      dueDate: dateFromToday(5),
      assigneeId: id(assignee),
    });
    expect(response.statusCode).toBe(201);
    return taskResponseSchema.parse(response.json()).task;
  };
  const newCheck = async (taskId: string, who = "vp"): Promise<QaCheck> => {
    const response = await post(who, `/api/v1/tasks/${taskId}/qa-checks`, { title: "Export opens in a spreadsheet" });
    expect(response.statusCode).toBe(201);
    return qaCheckResponseSchema.parse(response.json()).qaCheck;
  };
  const newDefect = async (taskId: string, severity = "high", extra: object = {}): Promise<Defect> => {
    const response = await post("vp", `/api/v1/tasks/${taskId}/defects`, {
      title: "Export drops the last row",
      severity,
      reproductionSteps: SECRET_TEXT,
      ...extra,
    });
    expect(response.statusCode).toBe(201);
    return defectResponseSchema.parse(response.json()).defect;
  };
  const move = (who: string, defectId: string, status: string, note?: string) =>
    post(who, `/api/v1/defects/${defectId}/status`, { status, ...(note === undefined ? {} : { note }) });
  const summary = async () => {
    const response = await get("ceo", "/api/v1/quality/summary");
    expect(response.statusCode).toBe(200);
    return qualitySummaryResponseSchema.parse(response.json());
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    ids["ceo"] = (await createSuperAdmin(db.migrator)).userId;
    ids["vp"] = await createUser(db.migrator, { ...VP, role: "vp_engineering_quality" });
    ids["cfo"] = await createUser(db.migrator, { ...CFO, role: "cfo" });
    ids["alice"] = await createUser(db.migrator, { ...ALICE, role: "employee" });
    ids["bob"] = await createUser(db.migrator, { ...BOB, role: "contractor" });

    // Logins happen once, outside the per-test app, so the per-app login rate limit is never reached.
    const setupApp = await buildTestApp(db.app);
    for (const [key, who] of [["ceo", SUPER_ADMIN], ["vp", VP], ["cfo", CFO], ["alice", ALICE], ["bob", BOB]] as const) {
      tokens[key] = await loginToken(setupApp, who.email, who.password);
    }
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

  it("VP has read-only access to all tasks and projects; task creation, editing and review stay CEO-only", async () => {
    const projectId = await newProject("Read-only check");
    const task = await newTask(projectId, "alice");

    expect((await get("vp", "/api/v1/tasks")).statusCode).toBe(200);
    expect((await get("vp", `/api/v1/tasks/${task.id}`)).statusCode).toBe(200);
    expect((await get("vp", "/api/v1/projects")).statusCode).toBe(200);
    expect((await get("vp", `/api/v1/projects/${projectId}`)).statusCode).toBe(200);

    const createTask = { projectId, title: "x", priority: "low", dueDate: dateFromToday(1), assigneeId: id("alice") };
    expect((await post("vp", "/api/v1/tasks", createTask)).statusCode).toBe(403);
    expect((await patch("vp", `/api/v1/tasks/${task.id}`, { title: "changed" })).statusCode).toBe(403);
    expect((await post("vp", `/api/v1/tasks/${task.id}/review`, { decision: "approved" })).statusCode).toBe(403);
    expect((await post("vp", `/api/v1/tasks/${task.id}/complete`)).statusCode).toBe(403);
    expect((await post("vp", "/api/v1/projects", { name: "Not allowed" })).statusCode).toBe(403);
    // VP cannot act as the assignee of someone else's task.
    expect((await post("vp", `/api/v1/tasks/${task.id}/status`, { status: "in_progress" })).statusCode).toBe(403);
  });

  it("creating QA checks and defects needs quality:manage; the task must exist; a linked check must be on the same task", async () => {
    const projectId = await newProject("Creation");
    const task = await newTask(projectId, "alice");
    const other = await newTask(projectId, "alice");

    for (const who of ["cfo", "alice"]) {
      expect((await post(who, `/api/v1/tasks/${task.id}/qa-checks`, { title: "x" })).statusCode).toBe(403);
      expect(
        (await post(who, `/api/v1/tasks/${task.id}/defects`, { title: "x", severity: "low", reproductionSteps: "x" })).statusCode,
      ).toBe(403);
    }
    const missing = "00000000-0000-7000-8000-000000000000";
    expect((await post("vp", `/api/v1/tasks/${missing}/qa-checks`, { title: "x" })).statusCode).toBe(404);

    const ceoCheck = await newCheck(task.id, "ceo");
    expect(ceoCheck).toMatchObject({ taskId: task.id, projectId, latestOutcome: null, latestResultAt: null });
    expect(ceoCheck).not.toHaveProperty("assigneeId");

    const otherCheck = await newCheck(other.id);
    const mismatched = await post("vp", `/api/v1/tasks/${task.id}/defects`, {
      title: "x",
      severity: "low",
      reproductionSteps: "x",
      qaCheckId: otherCheck.id,
    });
    expect(mismatched.statusCode).toBe(400);
    const linked = await newDefect(task.id, "medium", { qaCheckId: ceoCheck.id });
    expect(linked).toMatchObject({ status: "open", severity: "medium", qaCheckId: ceoCheck.id, resolvedAt: null });
  });

  it("records append-only QA results: failed or blocked need a note, evidence must be https", async () => {
    const projectId = await newProject("QA results");
    const task = await newTask(projectId, "alice");
    const check = await newCheck(task.id);
    const results = `/api/v1/qa-checks/${check.id}/results`;

    expect((await post("vp", results, { outcome: "failed" })).statusCode).toBe(400);
    expect((await post("vp", results, { outcome: "passed", evidenceUrl: "http://example.test/run" })).statusCode).toBe(400);
    expect((await post("alice", results, { outcome: "passed" })).statusCode).toBe(403);

    const failed = await post("vp", results, { outcome: "failed", note: SECRET_TEXT, evidenceUrl: SECRET_URL });
    expect(failed.statusCode).toBe(201);
    expect(qaResultResponseSchema.parse(failed.json()).qaCheck.latestOutcome).toBe("failed");
    const passed = qaResultResponseSchema.parse((await post("vp", results, { outcome: "passed" })).json());
    expect(passed.qaCheck.latestOutcome).toBe("passed");

    const detail = await get("alice", `/api/v1/qa-checks/${check.id}`);
    expect(detail.statusCode).toBe(200);
    expect(qaCheckDetailResponseSchema.parse(detail.json()).results.map((r) => r.outcome)).toEqual(["failed", "passed"]);
  });

  it("assignees see only quality items on their current tasks; reassignment moves access", async () => {
    const projectId = await newProject("Visibility");
    const task = await newTask(projectId, "alice");
    const check = await newCheck(task.id);
    const defect = await newDefect(task.id);

    const listFor = async (who: string) => defectPageSchema.parse((await get(who, `/api/v1/defects?projectId=${projectId}`)).json()).items;
    expect((await listFor("alice")).map((d) => d.id)).toEqual([defect.id]);
    expect(await listFor("bob")).toEqual([]);
    expect(await listFor("cfo")).toEqual([]);
    expect((await listFor("vp")).map((d) => d.id)).toEqual([defect.id]);
    for (const who of ["bob", "cfo"]) {
      expect((await get(who, `/api/v1/defects/${defect.id}`)).statusCode).toBe(404);
      expect((await get(who, `/api/v1/qa-checks/${check.id}`)).statusCode).toBe(404);
      expect((await post(who, `/api/v1/defects/${defect.id}/updates`, { note: "x" })).statusCode).toBe(404);
    }
    const checks = qaCheckPageSchema.parse((await get("alice", `/api/v1/qa-checks?taskId=${task.id}`)).json()).items;
    expect(checks.map((c) => c.id)).toEqual([check.id]);

    expect((await patch("ceo", `/api/v1/tasks/${task.id}`, { assigneeId: id("bob") })).statusCode).toBe(200);
    expect((await get("bob", `/api/v1/defects/${defect.id}`)).statusCode).toBe(200);
    expect((await get("alice", `/api/v1/defects/${defect.id}`)).statusCode).toBe(404);
    expect(await listFor("alice")).toEqual([]);
  });

  it("enforces the defect workflow, its notes and final statuses", async () => {
    const projectId = await newProject("Workflow");
    const task = await newTask(projectId, "alice");
    const defect = await newDefect(task.id);

    expect((await move("alice", defect.id, "fixed", "done")).statusCode).toBe(409);
    expect((await move("vp", defect.id, "in_progress")).statusCode).toBe(403);
    expect((await move("alice", defect.id, "in_progress")).statusCode).toBe(200);
    expect((await move("alice", defect.id, "fixed")).statusCode).toBe(400);
    expect((await move("alice", defect.id, "fixed", "Rounded the last page correctly")).statusCode).toBe(200);
    expect((await move("alice", defect.id, "verified")).statusCode).toBe(403);
    expect((await move("vp", defect.id, "open")).statusCode).toBe(400);
    expect((await move("vp", defect.id, "open", "Still drops a row on Safari")).statusCode).toBe(200);
    await move("alice", defect.id, "in_progress");
    await move("alice", defect.id, "fixed", "Fixed for Safari too");
    const verified = await move("vp", defect.id, "verified");
    expect(verified.statusCode).toBe(200);
    expect(defectResponseSchema.parse(verified.json()).defect).toMatchObject({ status: "verified" });
    expect(defectResponseSchema.parse(verified.json()).defect.resolvedAt).not.toBeNull();

    // Final: no moves, responses or edits.
    expect((await move("vp", defect.id, "open", "again")).statusCode).toBe(409);
    expect((await post("alice", `/api/v1/defects/${defect.id}/updates`, { note: "late" })).statusCode).toBe(409);
    expect((await patch("vp", `/api/v1/defects/${defect.id}`, { severity: "low" })).statusCode).toBe(409);

    const history = defectDetailResponseSchema.parse((await get("vp", `/api/v1/defects/${defect.id}`)).json()).updates;
    expect(history.map((u) => u.toStatus)).toEqual(["in_progress", "fixed", "open", "in_progress", "fixed", "verified"]);

    const unfixed = await newDefect(task.id, "low");
    expect((await move("vp", unfixed.id, "wont_fix")).statusCode).toBe(400);
    expect((await move("ceo", unfixed.id, "wont_fix", "Accepted limitation")).statusCode).toBe(200);
  });

  it("responses accept a note and/or https evidence from the assignee or a manager; edits are manager-only", async () => {
    const projectId = await newProject("Responses");
    const task = await newTask(projectId, "alice");
    const defect = await newDefect(task.id);
    const updates = `/api/v1/defects/${defect.id}/updates`;

    expect((await post("alice", updates, {})).statusCode).toBe(400);
    expect((await post("alice", updates, { evidenceUrl: "http://example.test/x" })).statusCode).toBe(400);
    expect((await post("alice", updates, { note: "Looking into it", evidenceUrl: SECRET_URL })).statusCode).toBe(201);
    expect((await post("vp", updates, { note: "Thanks" })).statusCode).toBe(201);

    expect((await patch("alice", `/api/v1/defects/${defect.id}`, { severity: "low" })).statusCode).toBe(403);
    const edited = await patch("vp", `/api/v1/defects/${defect.id}`, { severity: "critical" });
    expect(edited.statusCode).toBe(200);
    expect(defectResponseSchema.parse(edited.json()).defect.severity).toBe("critical");
  });

  it("self-QA conflict: on their own task VP acts only as the assignee; the CEO keeps every quality action", async () => {
    const projectId = await newProject("Own work");
    const task = await newTask(projectId, "vp");
    const base = { title: "x", severity: "high", reproductionSteps: "Steps" };

    // VP cannot create checks or defects on their own task.
    expect((await post("vp", `/api/v1/tasks/${task.id}/qa-checks`, { title: "x" })).statusCode).toBe(403);
    expect((await post("vp", `/api/v1/tasks/${task.id}/defects`, base)).statusCode).toBe(403);

    // The CEO can, and VP can still read them (scoped as the assignee).
    const check = await newCheck(task.id, "ceo");
    const created = await post("ceo", `/api/v1/tasks/${task.id}/defects`, base);
    expect(created.statusCode).toBe(201);
    const defect = defectResponseSchema.parse(created.json()).defect;
    expect((await get("vp", `/api/v1/qa-checks/${check.id}`)).statusCode).toBe(200);
    expect((await get("vp", `/api/v1/defects/${defect.id}`)).statusCode).toBe(200);

    // No results, edits, severity changes or manager moves by VP.
    expect((await post("vp", `/api/v1/qa-checks/${check.id}/results`, { outcome: "passed" })).statusCode).toBe(403);
    expect((await patch("vp", `/api/v1/defects/${defect.id}`, { severity: "low" })).statusCode).toBe(403);
    expect((await patch("vp", `/api/v1/defects/${defect.id}`, { title: "changed" })).statusCode).toBe(403);
    expect((await move("vp", defect.id, "wont_fix", "skip")).statusCode).toBe(403);

    // Assignee actions are allowed: notes, evidence, start and fix.
    expect((await post("vp", `/api/v1/defects/${defect.id}/updates`, { note: "On it", evidenceUrl: SECRET_URL })).statusCode).toBe(201);
    expect((await move("vp", defect.id, "in_progress")).statusCode).toBe(200);
    expect((await move("vp", defect.id, "fixed", "Patched")).statusCode).toBe(200);
    expect((await move("vp", defect.id, "verified")).statusCode).toBe(403);
    expect((await move("vp", defect.id, "open", "reopen")).statusCode).toBe(403);

    // VP cannot set readiness for a project containing their own task.
    const readiness = `/api/v1/projects/${projectId}/readiness`;
    expect((await post("vp", readiness, { label: "v1", readiness: "at_risk", note: "x" })).statusCode).toBe(403);

    // The CEO can do all of it.
    expect((await post("ceo", `/api/v1/qa-checks/${check.id}/results`, { outcome: "passed" })).statusCode).toBe(201);
    expect((await patch("ceo", `/api/v1/defects/${defect.id}`, { severity: "medium" })).statusCode).toBe(200);
    expect((await move("ceo", defect.id, "open", "Still failing")).statusCode).toBe(200);
    expect((await move("ceo", defect.id, "wont_fix", "Accepted")).statusCode).toBe(200);
    expect((await post("ceo", readiness, { label: "v1", readiness: "ready" })).statusCode).toBe(201);

    // Reassigning the task away from VP restores VP's manager actions.
    expect((await patch("ceo", `/api/v1/tasks/${task.id}`, { assigneeId: id("alice") })).statusCode).toBe(200);
    expect((await post("vp", `/api/v1/tasks/${task.id}/qa-checks`, { title: "After reassignment" })).statusCode).toBe(201);
    expect((await post("vp", readiness, { label: "v2", readiness: "at_risk", note: "Retest" })).statusCode).toBe(201);
  });

  it("readiness: ready is refused while blockers exist; latest decision wins; history is newest first", async () => {
    const projectId = await newProject("Release");
    const task = await newTask(projectId, "alice");
    const readiness = `/api/v1/projects/${projectId}/readiness`;

    // No record yet: counted as not_ready, shown without a label.
    let row = (await summary()).projects.find((p) => p.projectId === projectId);
    expect(row).toMatchObject({ readiness: "not_ready", label: null, decidedAt: null });

    expect((await post("alice", readiness, { label: "v1", readiness: "ready" })).statusCode).toBe(403);
    expect((await post("cfo", readiness, { label: "v1", readiness: "ready" })).statusCode).toBe(403);
    expect((await post("vp", readiness, { label: "v1", readiness: "at_risk" })).statusCode).toBe(400);

    const defect = await newDefect(task.id, "critical");
    const check = await newCheck(task.id);
    await post("vp", `/api/v1/qa-checks/${check.id}/results`, { outcome: "blocked", note: "Staging is down" });
    const refused = await post("vp", readiness, { label: "v1", readiness: "ready" });
    expect(refused.statusCode).toBe(409);
    expect(errorResponseSchema.parse(refused.json()).message).toContain("1 open critical or high defect(s) and 1 failed or blocked");

    await move("alice", defect.id, "in_progress");
    await move("alice", defect.id, "fixed", "Done");
    await move("vp", defect.id, "verified");
    await post("vp", `/api/v1/qa-checks/${check.id}/results`, { outcome: "passed" });

    expect((await post("vp", readiness, { label: "v1", readiness: "at_risk", note: SECRET_TEXT })).statusCode).toBe(201);
    expect((await post("vp", readiness, { label: "v1", readiness: "ready" })).statusCode).toBe(201);
    expect((await summary()).projects.some((p) => p.projectId === projectId)).toBe(false);
    expect((await post("ceo", readiness, { label: "v1.1", readiness: "not_ready", note: "Scope changed" })).statusCode).toBe(201);
    row = (await summary()).projects.find((p) => p.projectId === projectId);
    expect(row).toMatchObject({ readiness: "not_ready", label: "v1.1" });

    const history = readinessPageSchema.parse((await get("vp", readiness)).json()).items;
    expect(history.map((d) => d.readiness)).toEqual(["not_ready", "ready", "at_risk"]);
    expect((await get("alice", readiness)).statusCode).toBe(403);
  });

  it("summary: VP and CEO only, with exact counts", async () => {
    expect((await get("alice", "/api/v1/quality/summary")).statusCode).toBe(403);
    expect((await get("cfo", "/api/v1/quality/summary")).statusCode).toBe(403);
    expect((await get("vp", "/api/v1/quality/summary")).statusCode).toBe(200);

    const before = await summary();
    const projectId = await newProject("Counts");
    const task = await newTask(projectId, "alice");
    await newDefect(task.id, "critical");
    await newDefect(task.id, "high");
    await newDefect(task.id, "medium");
    const failing = await newCheck(task.id);
    await post("vp", `/api/v1/qa-checks/${failing.id}/results`, { outcome: "failed", note: "Broken" });

    const after = await summary();
    expect(after.counts.openCriticalDefects - before.counts.openCriticalDefects).toBe(1);
    expect(after.counts.openHighDefects - before.counts.openHighDefects).toBe(1);
    expect(after.counts.failedQaChecks - before.counts.failedQaChecks).toBe(1);
    expect(after.counts.projectsNotReady - before.counts.projectsNotReady).toBe(1);
    expect(after.projects.find((p) => p.projectId === projectId)).toMatchObject({
      readiness: "not_ready",
      openCriticalDefects: 1,
      openHighDefects: 1,
      failedQaChecks: 1,
      blockedQaChecks: 0,
    });
  });

  it("never records titles, notes, reproduction steps, evidence URLs or labels in audit events", async () => {
    const projectId = await newProject("Audit");
    const task = await newTask(projectId, "alice");
    const check = await newCheck(task.id);
    await post("vp", `/api/v1/qa-checks/${check.id}/results`, { outcome: "failed", note: SECRET_TEXT, evidenceUrl: SECRET_URL });
    const defect = await newDefect(task.id);
    await post("alice", `/api/v1/defects/${defect.id}/updates`, { note: SECRET_TEXT, evidenceUrl: SECRET_URL });
    await patch("vp", `/api/v1/defects/${defect.id}`, { reproductionSteps: `${SECRET_TEXT} 2` });
    await post("vp", `/api/v1/projects/${projectId}/readiness`, { label: SECRET_TEXT, readiness: "at_risk", note: SECRET_TEXT });

    const events = await db.query<{ action: string; before: unknown; after: unknown }>(
      "SELECT action, before, after FROM audit_events WHERE entity_type IN ('qa_check', 'defect') OR action = 'release.readiness_set'",
    );
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        "qa_check.created",
        "qa_check.result_recorded",
        "defect.created",
        "defect.responded",
        "defect.updated",
        "release.readiness_set",
      ]),
    );
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(SECRET_TEXT);
    expect(serialized).not.toContain(SECRET_URL);
    expect(serialized).not.toContain("Export drops the last row");
  });
});

describe("quality summary: exact counts past the row cap", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let ceoToken = "";

  beforeAll(async () => {
    db = await createTestDatabase();
    await createSuperAdmin(db.migrator);
    const setupApp = await buildTestApp(db.app);
    ceoToken = await loginToken(setupApp, SUPER_ADMIN.email, SUPER_ADMIN.password);
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

  const summary = async () => {
    const response = await call(app, { method: "GET", url: "/api/v1/quality/summary", token: ceoToken });
    expect(response.statusCode).toBe(200);
    return qualitySummaryResponseSchema.parse(response.json());
  };

  it("is not capped below the limit", async () => {
    await db.query(
      "INSERT INTO projects (name, created_by) SELECT 'Small ' || n, (SELECT id FROM users WHERE is_super_admin) FROM generate_series(1, 3) AS n",
    );
    const result = await summary();
    expect(result.capped).toBe(false);
    expect(result.projects).toHaveLength(3);
    expect(result.counts.projectsNotReady).toBe(3);
  });

  it("returns exact counts for 260 projects and 260 open critical defects, with 250 capped rows", async () => {
    // Test-only bulk seeding in this throwaway database, as crm_migrator.
    const assignee = await createUser(db.migrator, {
      email: "bulk@example.test",
      name: "Bulk",
      password: "test-bulk-password",
      role: "employee",
    });
    await db.query(
      "INSERT INTO projects (name, created_by) SELECT 'Bulk ' || lpad(n::text, 3, '0'), (SELECT id FROM users WHERE is_super_admin) FROM generate_series(1, 257) AS n",
    );
    const [task] = await db.query<{ id: string }>(
      `INSERT INTO tasks (project_id, title, due_date, assignee_id, created_by)
       SELECT (SELECT id FROM projects ORDER BY name LIMIT 1), 'Bulk task', current_date + 1, $1, id FROM users WHERE is_super_admin
       RETURNING id`,
      [assignee],
    );
    await db.query(
      `INSERT INTO defects (task_id, title, severity, reproduction_steps, reported_by)
       SELECT $1, 'Bulk defect ' || n, 'critical', 'Steps', (SELECT id FROM users WHERE is_super_admin)
       FROM generate_series(1, 260) AS n`,
      [task?.id],
    );

    const result = await summary();
    expect(result.counts.projectsNotReady).toBe(260);
    expect(result.counts.openCriticalDefects).toBe(260);
    expect(result.projects).toHaveLength(250);
    expect(result.capped).toBe(true);
    // The project with blockers sorts first among not_ready projects.
    expect(result.projects[0]).toMatchObject({ readiness: "not_ready", openCriticalDefects: 260 });
  });
});
