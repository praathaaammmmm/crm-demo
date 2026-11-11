import { projectPageSchema, projectResponseSchema } from "@crm/contracts/projects";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import { buildTestApp, call, createSuperAdmin, createUser, dateFromToday, loginToken, SUPER_ADMIN } from "../../../test/helpers.js";

const person = (key: string) => ({ email: `${key}@example.test`, name: `Test ${key}`, password: `test-${key}-password` });
const CFO = person("cfo");
const ALICE = person("alice");
const BOB = person("bob");

describe("projects", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let ceoId = "";
  let aliceId = "";

  const token = (who: { email: string; password: string }) => loginToken(app, who.email, who.password);
  const createProject = async (name: string) => {
    const response = await call(app, {
      method: "POST",
      url: "/api/v1/projects",
      token: await token(SUPER_ADMIN),
      payload: { name, description: "Project description" },
    });
    expect(response.statusCode).toBe(201);
    return projectResponseSchema.parse(response.json()).project;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    ceoId = (await createSuperAdmin(db.migrator)).userId;
    await createUser(db.migrator, { ...CFO, role: "cfo" });
    aliceId = await createUser(db.migrator, { ...ALICE, role: "employee" });
    await createUser(db.migrator, { ...BOB, role: "employee" });
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

  it("lets only the CEO create projects, and audits without the name", async () => {
    const project = await createProject("Website rebuild");
    const audits = await db.query<{ actor_user_id: string; before: unknown; after: unknown }>(
      "SELECT actor_user_id, before, after FROM audit_events WHERE action = 'project.created' AND entity_id = $1",
      [project.id],
    );
    expect(audits).toEqual([{ actor_user_id: ceoId, before: null, after: null }]);

    for (const who of [CFO, ALICE]) {
      const response = await call(app, {
        method: "POST",
        url: "/api/v1/projects",
        token: await token(who),
        payload: { name: "Not allowed" },
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it("shows assignees only projects that contain their tasks; others are 404", async () => {
    const withTask = await createProject("Has Alice's task");
    const without = await createProject("No tasks for Alice");
    const created = await call(app, {
      method: "POST",
      url: "/api/v1/tasks",
      token: await token(SUPER_ADMIN),
      payload: { projectId: withTask.id, title: "Do it", priority: "medium", dueDate: dateFromToday(3), assigneeId: aliceId },
    });
    expect(created.statusCode).toBe(201);

    const alice = await token(ALICE);
    const aliceList = projectPageSchema.parse((await call(app, { method: "GET", url: "/api/v1/projects", token: alice })).json());
    expect(aliceList.items.map((p) => p.id)).toEqual([withTask.id]);
    expect((await call(app, { method: "GET", url: `/api/v1/projects/${withTask.id}`, token: alice })).statusCode).toBe(200);
    expect((await call(app, { method: "GET", url: `/api/v1/projects/${without.id}`, token: alice })).statusCode).toBe(404);

    const bob = await token(BOB);
    const bobList = projectPageSchema.parse((await call(app, { method: "GET", url: "/api/v1/projects", token: bob })).json());
    expect(bobList.items).toEqual([]);
    expect((await call(app, { method: "GET", url: `/api/v1/projects/${withTask.id}`, token: bob })).statusCode).toBe(404);
    expect((await call(app, { method: "GET", url: "/api/v1/projects/not-a-uuid", token: bob })).statusCode).toBe(404);

    const ceoList = projectPageSchema.parse(
      (await call(app, { method: "GET", url: "/api/v1/projects", token: await token(SUPER_ADMIN) })).json(),
    );
    expect(ceoList.items.length).toBeGreaterThanOrEqual(3);
  });
});
