import {
  automationDetailResponseSchema,
  automationResponseSchema,
  checklistItemResponseSchema,
  incidentDetailResponseSchema,
  incidentResponseSchema,
  operationsSummarySchema,
  releaseDetailResponseSchema,
  releaseResponseSchema,
  type Automation,
  type Incident,
  type Release,
} from "@crm/contracts/operations";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import { buildTestApp, call, createSuperAdmin, createUser, loginToken, SUPER_ADMIN, TEST_ORIGIN } from "../../../test/helpers.js";

const person = (key: string) => ({ email: `${key}@example.test`, name: `Test ${key}`, password: `test-${key}-password` });
const VP = person("ops-vp");
const SECRET = "private-ops-text-9d1c";
/** Every role without operations:read_all. */
const DENIED = ["cfo", "cgo", "cmo", "founder", "employee", "intern", "contractor"] as const;

describe("engineering operations", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const as = (key: string) => tokens[key] ?? "";
  const get = (who: string, url: string) => call(app, { method: "GET", url, token: as(who) });
  const post = (who: string, url: string, payload: object = {}) => call(app, { method: "POST", url, token: as(who), payload });
  const patch = (who: string, url: string, payload: object) =>
    app.inject({ method: "PATCH", url, headers: { origin: TEST_ORIGIN }, cookies: { crm_session: as(who) }, payload });

  const newIncident = async (extra: object = {}): Promise<Incident> => {
    const response = await post("vp", "/api/v1/operations/incidents", { title: `Outage ${SECRET}`, severity: "sev2", ownerId: ids["vp"], summary: SECRET, ...extra });
    expect(response.statusCode).toBe(201);
    return incidentResponseSchema.parse(response.json()).incident;
  };
  const newRelease = async (environment: "staging" | "production", items = 2): Promise<Release> => {
    const response = await post("vp", "/api/v1/operations/releases", { name: `Release ${SECRET}`, versionLabel: "v1.2.0", environment, notes: SECRET });
    expect(response.statusCode).toBe(201);
    const release = releaseResponseSchema.parse(response.json()).release;
    for (let i = 0; i < items; i++) {
      const item = await post("vp", `/api/v1/operations/releases/${release.id}/checklist`, { label: `Check ${String(i)} ${SECRET}` });
      expect(item.statusCode).toBe(201);
    }
    return release;
  };
  const tickAll = async (releaseId: string) => {
    const detail = releaseDetailResponseSchema.parse((await get("vp", `/api/v1/operations/releases/${releaseId}`)).json());
    for (const item of detail.checklist) expect((await post("vp", `/api/v1/operations/checklist-items/${item.id}`, { done: true })).statusCode).toBe(200);
  };
  const decide = (who: string, id: string, to: string, note?: string) =>
    post(who, `/api/v1/operations/releases/${id}/decisions`, note === undefined ? { to } : { to, note });
  const newAutomation = async (): Promise<Automation> => {
    const response = await post("vp", "/api/v1/operations/automations", { name: `Nightly ${SECRET}`, purpose: SECRET, trigger: "Every night at 02:00" });
    expect(response.statusCode).toBe(201);
    return automationResponseSchema.parse(response.json()).automation;
  };
  const lifecycle = (who: string, id: string, to: string, note?: string) =>
    post(who, `/api/v1/operations/automations/${id}/status`, note === undefined ? { to } : { to, note });
  const run = (id: string, outcome: "succeeded" | "failed", errorSummary?: string) => {
    const finished = new Date();
    const started = new Date(finished.getTime() - 60_000);
    return post("vp", `/api/v1/operations/automations/${id}/runs`, {
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      outcome,
      ...(errorSummary === undefined ? {} : { errorSummary }),
    });
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    ids["ceo"] = (await createSuperAdmin(db.migrator)).userId;
    ids["vp"] = await createUser(db.migrator, { ...VP, role: "vp_engineering_quality" });
    for (const role of DENIED) ids[role] = await createUser(db.migrator, { ...person(`ops-${role}`), role });
    ids["gone"] = await createUser(db.migrator, { ...person("ops-gone"), role: "employee" });
    await db.query("UPDATE users SET status = 'deactivated', deactivated_at = now() WHERE id = $1", [ids["gone"]]);
    const setup = await buildTestApp(db.app);
    tokens["ceo"] = await loginToken(setup, SUPER_ADMIN.email, SUPER_ADMIN.password);
    tokens["vp"] = await loginToken(setup, VP.email, VP.password);
    for (const role of DENIED) tokens[role] = await loginToken(setup, person(`ops-${role}`).email, person(`ops-${role}`).password);
    await setup.close();
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

  it("the VP manages, the CEO/CTO reads and approves only, and every other role is refused", async () => {
    const incident = await newIncident();
    expect((await call(app, { method: "GET", url: "/api/v1/operations/summary" })).statusCode).toBe(401);
    for (const url of ["/api/v1/operations/summary", "/api/v1/operations/incidents", "/api/v1/operations/releases", "/api/v1/operations/automations", `/api/v1/operations/incidents/${incident.id}`]) {
      expect((await get("ceo", url)).statusCode).toBe(200);
      expect((await get("vp", url)).statusCode).toBe(200);
      for (const role of DENIED) expect((await get(role, url)).statusCode).toBe(403);
    }
    for (const who of ["ceo", ...DENIED]) {
      expect((await post(who, "/api/v1/operations/incidents", { title: "X", severity: "sev4", ownerId: ids["vp"] })).statusCode).toBe(403);
      expect((await post(who, "/api/v1/operations/releases", { name: "X", versionLabel: "1", environment: "staging" })).statusCode).toBe(403);
      expect((await post(who, "/api/v1/operations/automations", { name: "X", purpose: "Y", trigger: "Z" })).statusCode).toBe(403);
      expect((await post(who, `/api/v1/operations/incidents/${incident.id}/notes`, { note: "x" })).statusCode).toBe(403);
    }
    for (const role of DENIED) expect((await post(role, `/api/v1/operations/releases/${incident.id}/decisions`, { to: "approved" })).statusCode).toBe(403);
  });

  it("incidents keep an append-only timeline; resolution is required and the post-incident note is written once", async () => {
    expect((await post("vp", "/api/v1/operations/incidents", { title: "X", severity: "sev1", ownerId: ids["gone"] })).statusCode).toBe(409);
    expect((await post("vp", "/api/v1/operations/incidents", { title: "X", severity: "sev1", ownerId: ids["vp"], startedAt: "2099-01-01T00:00:00Z" })).statusCode).toBe(400);
    const incident = await newIncident({ severity: "sev1" });
    const base = `/api/v1/operations/incidents/${incident.id}`;
    expect((await post("vp", `${base}/status`, { to: "open" })).statusCode).toBe(409);
    expect((await post("vp", `${base}/status`, { to: "investigating", note: "Paged on-call" })).statusCode).toBe(200);
    expect((await post("vp", `${base}/notes`, { note: "Cause narrowed to the pool" })).statusCode).toBe(200);
    expect((await post("vp", `${base}/post-incident`, { note: "Too early" })).statusCode).toBe(409);
    expect((await post("vp", `${base}/status`, { to: "resolved" })).statusCode).toBe(400);
    const resolved = await post("vp", `${base}/status`, { to: "resolved", resolution: "Raised the pool size" });
    expect(incidentResponseSchema.parse(resolved.json()).incident).toMatchObject({ status: "resolved", resolution: "Raised the pool size" });
    expect((await patch("vp", base, { severity: "sev3" })).statusCode).toBe(409);
    expect((await post("vp", `${base}/notes`, { note: "late" })).statusCode).toBe(409);
    expect((await post("vp", `${base}/post-incident`, { note: "Add pool alerts" })).statusCode).toBe(200);
    expect((await post("vp", `${base}/post-incident`, { note: "Again" })).statusCode).toBe(409);
    const detail = incidentDetailResponseSchema.parse((await get("ceo", base)).json());
    expect(detail.incident.postIncidentNote).toBe("Add pool alerts");
    expect(detail.timeline.map((entry) => [entry.kind, entry.fromStatus, entry.toStatus])).toEqual([
      ["status", "open", "investigating"],
      ["note", null, null],
      ["status", "investigating", "resolved"],
    ]);
  });

  it("production releases need a complete checklist and CEO/CTO approval; outcomes and rollback are recorded by the VP", async () => {
    const release = await newRelease("production");
    expect((await decide("vp", release.id, "awaiting_approval")).statusCode).toBe(409);
    await tickAll(release.id);
    expect((await decide("vp", release.id, "deployed")).statusCode).toBe(409);
    expect((await decide("ceo", release.id, "awaiting_approval")).statusCode).toBe(403);
    expect((await decide("vp", release.id, "awaiting_approval")).statusCode).toBe(200);
    expect((await post("vp", `/api/v1/operations/releases/${release.id}/checklist`, { label: "Late item" })).statusCode).toBe(409);
    expect((await decide("vp", release.id, "approved")).statusCode).toBe(403);
    expect((await decide("ceo", release.id, "rejected")).statusCode).toBe(400);
    expect((await decide("ceo", release.id, "rejected", "Missing load test")).statusCode).toBe(200);
    expect((await decide("vp", release.id, "draft")).statusCode).toBe(200);
    expect((await decide("vp", release.id, "awaiting_approval")).statusCode).toBe(200);
    expect((await decide("ceo", release.id, "approved")).statusCode).toBe(200);
    expect((await decide("ceo", release.id, "deployed")).statusCode).toBe(403);
    expect((await decide("vp", release.id, "deployed")).statusCode).toBe(200);
    expect((await decide("vp", release.id, "rolled_back")).statusCode).toBe(400);
    expect((await decide("vp", release.id, "rolled_back", "Error rate doubled")).statusCode).toBe(200);
    expect((await decide("vp", release.id, "deployed")).statusCode).toBe(409);
    const detail = releaseDetailResponseSchema.parse((await get("ceo", `/api/v1/operations/releases/${release.id}`)).json());
    expect(detail.release).toMatchObject({ status: "rolled_back", checklistTotal: 2, checklistDone: 2 });
    expect(detail.decisions.map((d) => [d.fromStatus, d.toStatus, d.actorId === ids["ceo"] ? "ceo" : "vp"])).toEqual([
      ["draft", "awaiting_approval", "vp"],
      ["awaiting_approval", "rejected", "ceo"],
      ["rejected", "draft", "vp"],
      ["draft", "awaiting_approval", "vp"],
      ["awaiting_approval", "approved", "ceo"],
      ["approved", "deployed", "vp"],
      ["deployed", "rolled_back", "vp"],
    ]);
  });

  it("staging releases record an outcome without approval; checklist items toggle only on drafts", async () => {
    const empty = await newRelease("staging", 0);
    expect((await decide("vp", empty.id, "deployed")).statusCode).toBe(409);
    const release = await newRelease("staging", 1);
    expect((await decide("vp", release.id, "awaiting_approval")).statusCode).toBe(409);
    const detail = releaseDetailResponseSchema.parse((await get("vp", `/api/v1/operations/releases/${release.id}`)).json());
    const itemId = detail.checklist[0]?.id ?? "";
    const ticked = await post("vp", `/api/v1/operations/checklist-items/${itemId}`, { done: true });
    expect(checklistItemResponseSchema.parse(ticked.json()).item).toMatchObject({ done: true, doneBy: ids["vp"] });
    expect((await patch("vp", `/api/v1/operations/releases/${release.id}`, { versionLabel: "v1.2.1" })).statusCode).toBe(200);
    expect((await decide("vp", release.id, "failed")).statusCode).toBe(200);
    expect((await post("vp", `/api/v1/operations/checklist-items/${itemId}`, { done: false })).statusCode).toBe(409);
    expect((await patch("vp", `/api/v1/operations/releases/${release.id}`, { versionLabel: "v1.2.2" })).statusCode).toBe(409);
  });

  it("automations go live only with CEO/CTO approval; runs drive health; unsafe error summaries are refused", async () => {
    const automation = await newAutomation();
    expect(automation).toMatchObject({ status: "draft", health: "unknown", lastRunAt: null });
    expect((await run(automation.id, "succeeded")).statusCode).toBe(409);
    expect((await lifecycle("vp", automation.id, "live")).statusCode).toBe(409);
    expect((await lifecycle("vp", automation.id, "testing")).statusCode).toBe(200);
    expect((await run(automation.id, "succeeded")).statusCode).toBe(201);
    expect((await lifecycle("vp", automation.id, "awaiting_approval")).statusCode).toBe(200);
    expect((await lifecycle("vp", automation.id, "live")).statusCode).toBe(403);
    expect((await lifecycle("ceo", automation.id, "testing")).statusCode).toBe(400);
    expect((await lifecycle("ceo", automation.id, "testing", "Add a dry run")).statusCode).toBe(200);
    expect((await lifecycle("vp", automation.id, "awaiting_approval")).statusCode).toBe(200);
    expect((await lifecycle("ceo", automation.id, "live")).statusCode).toBe(200);
    expect((await patch("vp", `/api/v1/operations/automations/${automation.id}`, { name: "Renamed" })).statusCode).toBe(409);

    expect((await run(automation.id, "failed")).statusCode).toBe(400);
    expect((await run(automation.id, "failed", "token=abc123 leaked")).statusCode).toBe(400);
    expect((await run(automation.id, "failed", "see https://logs.example.com/x")).statusCode).toBe(400);
    expect((await run(automation.id, "failed", `Queue timeout ${SECRET}`)).statusCode).toBe(201);
    let detail = automationDetailResponseSchema.parse((await get("ceo", `/api/v1/operations/automations/${automation.id}`)).json());
    expect(detail.automation).toMatchObject({ health: "failing", failuresLast30Days: 1 });
    expect((await run(automation.id, "succeeded")).statusCode).toBe(201);
    detail = automationDetailResponseSchema.parse((await get("ceo", `/api/v1/operations/automations/${automation.id}`)).json());
    expect(detail.automation.health).toBe("degraded");
    expect(detail.runs).toHaveLength(3);
    expect(detail.changes.map((c) => c.toStatus)).toEqual(["testing", "awaiting_approval", "testing", "awaiting_approval", "live"]);

    const summary = operationsSummarySchema.parse((await get("ceo", "/api/v1/operations/summary")).json());
    expect(summary.unhealthyLiveAutomations).toBeGreaterThanOrEqual(1);
    expect((await lifecycle("vp", automation.id, "retired")).statusCode).toBe(200);
    expect((await lifecycle("vp", automation.id, "live")).statusCode).toBe(409);
    expect((await run(automation.id, "succeeded")).statusCode).toBe(409);
  });

  it("audits every mutation without titles, notes, resolutions or error summaries", async () => {
    const incident = await newIncident();
    await post("vp", `/api/v1/operations/incidents/${incident.id}/notes`, { note: SECRET });
    await post("vp", `/api/v1/operations/incidents/${incident.id}/status`, { to: "resolved", resolution: SECRET, note: SECRET });
    await post("vp", `/api/v1/operations/incidents/${incident.id}/post-incident`, { note: SECRET });
    const release = await newRelease("staging", 1);
    await tickAll(release.id);
    await decide("vp", release.id, "failed");
    await decide("vp", release.id, "rolled_back", SECRET);
    const events = await db.query<{ action: string; before: unknown; after: unknown }>(
      "SELECT action, before, after FROM audit_events WHERE action LIKE 'operations.%'",
    );
    const actions = new Set(events.map((e) => e.action));
    for (const action of [
      "operations.incident_created",
      "operations.incident_note_added",
      "operations.incident_status_changed",
      "operations.incident_post_note_added",
      "operations.release_created",
      "operations.release_checklist_item_added",
      "operations.release_checklist_item_changed",
      "operations.release_status_changed",
      "operations.automation_run_recorded",
    ]) {
      expect(actions).toContain(action);
    }
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });
});
