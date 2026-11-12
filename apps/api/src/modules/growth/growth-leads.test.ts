import { companyResponseSchema, contactResponseSchema } from "@crm/contracts/growth";
import { leadDetailResponseSchema, leadPageSchema, leadResponseSchema, type Lead } from "@crm/contracts/growth-leads";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import { buildTestApp, call, createSuperAdmin, createUser, dateFromToday, loginToken, SUPER_ADMIN, TEST_ORIGIN } from "../../../test/helpers.js";

const person = (key: string) => ({ email: `${key}@example.test`, name: `Test ${key}`, password: `test-${key}-password` });
const CGO = person("cgo");
const CGO2 = person("cgo2");
const CFO = person("cfo");
const ALICE = person("alice");
const SECRET = "private-lead-text-5b1a";
const UNKNOWN_ID = "00000000-0000-7000-8000-000000000000";

describe("growth leads", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let companyId = "";
  let contactId = "";
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const as = (key: string) => tokens[key] ?? "";
  const get = (who: string, url: string) => call(app, { method: "GET", url, token: as(who) });
  const post = (who: string, url: string, payload: object = {}) => call(app, { method: "POST", url, token: as(who), payload });
  const patch = (who: string, url: string, payload: object) =>
    app.inject({ method: "PATCH", url, headers: { origin: TEST_ORIGIN }, cookies: { crm_session: as(who) }, payload });

  const newLead = async (extra: object = {}): Promise<Lead> => {
    const response = await post("cgo", "/api/v1/growth/leads", { name: "Big Deal", source: "referral", ...extra });
    expect(response.statusCode).toBe(201);
    return leadResponseSchema.parse(response.json()).lead;
  };
  const detail = async (id: string) => leadDetailResponseSchema.parse((await get("ceo", `/api/v1/growth/leads/${id}`)).json());
  const stage = (who: string, id: string, payload: object) => post(who, `/api/v1/growth/leads/${id}/stage`, payload);

  beforeAll(async () => {
    db = await createTestDatabase();
    ids["ceo"] = (await createSuperAdmin(db.migrator)).userId;
    ids["cgo"] = await createUser(db.migrator, { ...CGO, role: "cgo" });
    ids["cgo2"] = await createUser(db.migrator, { ...CGO2, role: "cgo" });
    ids["cfo"] = await createUser(db.migrator, { ...CFO, role: "cfo" });
    ids["alice"] = await createUser(db.migrator, { ...ALICE, role: "employee" });
    const setupApp = await buildTestApp(db.app);
    for (const [key, who] of [["ceo", SUPER_ADMIN], ["cgo", CGO], ["cgo2", CGO2], ["cfo", CFO], ["alice", ALICE]] as const) {
      tokens[key] = await loginToken(setupApp, who.email, who.password);
    }
    const company = await call(setupApp, { method: "POST", url: "/api/v1/growth/companies", token: as("cgo"), payload: { name: "Lead Co" } });
    companyId = companyResponseSchema.parse(company.json()).company.id;
    const contact = await call(setupApp, {
      method: "POST",
      url: `/api/v1/growth/companies/${companyId}/contacts`,
      token: as("cgo"),
      payload: { fullName: "Ravi Kumar", email: "ravi@example.test" },
    });
    contactId = contactResponseSchema.parse(contact.json()).contact.id;
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

  it("the CGO creates and edits leads; the CEO reads; other roles get 403", async () => {
    const lead = await newLead({ companyId, primaryContactId: contactId, estimatedValueMinor: 150_000_00, priority: "high" });
    expect(lead).toMatchObject({ stage: "new", stageRevision: 0, ownerId: ids["cgo"], currency: "INR", ownerFlagged: false, overdue: false });
    expect((await patch("cgo", `/api/v1/growth/leads/${lead.id}`, { priority: "low" })).statusCode).toBe(200);
    expect((await get("ceo", `/api/v1/growth/leads/${lead.id}`)).statusCode).toBe(200);
    expect((await post("ceo", "/api/v1/growth/leads", { name: "X", source: "other" })).statusCode).toBe(403);
    expect((await patch("ceo", `/api/v1/growth/leads/${lead.id}`, { priority: "high" })).statusCode).toBe(403);
    expect((await stage("ceo", lead.id, { to: "contacted" })).statusCode).toBe(403);
    for (const who of ["cfo", "alice"]) {
      expect((await get(who, "/api/v1/growth/leads")).statusCode).toBe(403);
      expect((await get(who, `/api/v1/growth/leads/${lead.id}`)).statusCode).toBe(403);
    }
    expect((await post("cgo", `/api/v1/growth/leads/${lead.id}/reassign`, { ownerId: ids["cgo2"] })).statusCode).toBe(403);
  });

  it("follows the status convention and validates links and dates", async () => {
    expect((await get("cgo", "/api/v1/growth/leads/not-a-uuid")).statusCode).toBe(404);
    expect((await get("cfo", "/api/v1/growth/leads/not-a-uuid")).statusCode).toBe(403);
    expect((await get("cgo", `/api/v1/growth/leads/${UNKNOWN_ID}`)).statusCode).toBe(404);
    expect((await stage("cgo", UNKNOWN_ID, { to: "contacted" })).statusCode).toBe(404);
    expect((await post("cgo", "/api/v1/growth/leads", { name: "  ", source: "referral" })).statusCode).toBe(400);
    expect((await post("cgo", "/api/v1/growth/leads", { name: "X", source: "referral", nextFollowUpOn: dateFromToday(-1) })).statusCode).toBe(400);
    expect((await post("cgo", "/api/v1/growth/leads", { name: "X", source: "referral", primaryContactId: contactId })).statusCode).toBe(400);
    const other = companyResponseSchema.parse((await post("cgo", "/api/v1/growth/companies", { name: "Other Lead Co" })).json()).company;
    expect((await post("cgo", "/api/v1/growth/leads", { name: "X", source: "referral", companyId: other.id, primaryContactId: contactId })).statusCode).toBe(409);
  });

  it("records one history row per stage revision, including repeated transitions", async () => {
    const lead = await newLead();
    for (const to of ["contacted", "new", "contacted", "new"]) expect((await stage("cgo", lead.id, { to })).statusCode).toBe(200);
    const result = await detail(lead.id);
    expect(result.lead).toMatchObject({ stage: "new", stageRevision: 4 });
    expect(result.history.map((h) => [h.stageRevision, h.fromStage, h.toStage])).toEqual([
      [1, "new", "contacted"],
      [2, "contacted", "new"],
      [3, "new", "contacted"],
      [4, "contacted", "new"],
    ]);
    const audits = await db.query<{ revision: number }>(
      "SELECT (after->>'stageRevision')::int AS revision FROM audit_events WHERE entity_id = $1 AND action = 'growth.lead_stage_changed' ORDER BY occurred_at, id",
      [lead.id],
    );
    expect(audits.map((a) => a.revision)).toEqual([1, 2, 3, 4]);
  });

  it("lost needs a reason and note, freezes the lead, blocks won; only the CEO reopens", async () => {
    const lead = await newLead();
    await stage("cgo", lead.id, { to: "contacted" });
    expect((await stage("cgo", lead.id, { to: "won" })).statusCode).toBe(409);
    expect((await stage("cgo", lead.id, { to: "lost" })).statusCode).toBe(400);
    expect((await stage("cgo", lead.id, { to: "lost", lostReason: "price", note: SECRET })).statusCode).toBe(200);
    expect((await patch("cgo", `/api/v1/growth/leads/${lead.id}`, { priority: "high" })).statusCode).toBe(409);
    expect((await stage("cgo", lead.id, { to: "qualified" })).statusCode).toBe(409);
    expect((await post("cgo", `/api/v1/growth/leads/${lead.id}/reopen`, { to: "qualified", note: "x" })).statusCode).toBe(403);
    expect((await post("ceo", `/api/v1/growth/leads/${lead.id}/reopen`, { to: "qualified" })).statusCode).toBe(400);
    const reopened = await post("ceo", `/api/v1/growth/leads/${lead.id}/reopen`, { to: "qualified", note: "Budget approved" });
    expect(reopened.statusCode).toBe(200);
    expect(leadResponseSchema.parse(reopened.json()).lead).toMatchObject({ stage: "qualified", lostReason: null, lostNote: null, stageRevision: 3 });
    const result = await detail(lead.id);
    expect(result.history.map((h) => [h.stageRevision, h.fromStage, h.toStage, h.lostReason])).toEqual([
      [1, "new", "contacted", null],
      [2, "contacted", "lost", "price"],
      [3, "lost", "qualified", null],
    ]);
    expect((await post("ceo", `/api/v1/growth/leads/${lead.id}/reopen`, { to: "new", note: "again" })).statusCode).toBe(409);
  });

  it("reassignment is CEO-only, to a different active CGO; flagged owners show until reassigned", async () => {
    const lead = await newLead();
    expect((await post("ceo", `/api/v1/growth/leads/${lead.id}/reassign`, { ownerId: ids["cgo"] })).statusCode).toBe(409);
    expect((await post("ceo", `/api/v1/growth/leads/${lead.id}/reassign`, { ownerId: ids["cfo"] })).statusCode).toBe(409);
    await db.query("UPDATE users SET role = 'cmo' WHERE id = $1", [ids["cgo"]]);
    try {
      const flagged = await detail(lead.id);
      expect(flagged.lead.ownerFlagged).toBe(true);
      const moved = await post("ceo", `/api/v1/growth/leads/${lead.id}/reassign`, { ownerId: ids["cgo2"] });
      expect(moved.statusCode).toBe(200);
      expect(leadResponseSchema.parse(moved.json()).lead).toMatchObject({ ownerId: ids["cgo2"], ownerFlagged: false });
    } finally {
      await db.query("UPDATE users SET role = 'cgo' WHERE id = $1", [ids["cgo"]]);
    }
  });

  it("archived leads are read-only and cannot be reopened or reassigned", async () => {
    const lead = await newLead();
    await stage("cgo", lead.id, { to: "lost", lostReason: "timing", note: "Later" });
    expect((await post("cgo", `/api/v1/growth/leads/${lead.id}/archive`)).statusCode).toBe(200);
    expect((await post("ceo", `/api/v1/growth/leads/${lead.id}/reopen`, { to: "new", note: "x" })).statusCode).toBe(409);
    expect((await post("ceo", `/api/v1/growth/leads/${lead.id}/reassign`, { ownerId: ids["cgo2"] })).statusCode).toBe(409);
    expect((await post("cgo", `/api/v1/growth/leads/${lead.id}/archive`)).statusCode).toBe(409);
    expect((await get("ceo", `/api/v1/growth/leads/${lead.id}`)).statusCode).toBe(200);
  });

  it("computes overdue in the organisation's time zone and filters by it", async () => {
    const due = await newLead({ nextFollowUpOn: dateFromToday(0) });
    await db.query("UPDATE growth_leads SET next_follow_up_on = $2::date WHERE id = $1", [due.id, dateFromToday(-1)]);
    const today = await newLead({ nextFollowUpOn: dateFromToday(0) });
    const overdue = leadPageSchema.parse((await get("cgo", "/api/v1/growth/leads?overdue=true")).json()).items.map((l) => l.id);
    expect(overdue).toContain(due.id);
    expect(overdue).not.toContain(today.id);
    expect((await detail(due.id)).lead.overdue).toBe(true);
    expect((await detail(today.id)).lead.overdue).toBe(false);
  });

  it("never records lead names, notes or contact data in audit events", async () => {
    const lead = await newLead({ name: `Name ${SECRET}`, sourceDetail: SECRET, companyId, primaryContactId: contactId });
    await patch("cgo", `/api/v1/growth/leads/${lead.id}`, { name: `Renamed ${SECRET}` });
    await stage("cgo", lead.id, { to: "lost", lostReason: "other", note: SECRET });
    await post("ceo", `/api/v1/growth/leads/${lead.id}/reopen`, { to: "new", note: SECRET });
    const events = await db.query<{ action: string; before: unknown; after: unknown }>(
      "SELECT action, before, after FROM audit_events WHERE entity_type = 'growth_lead' AND entity_id = $1",
      [lead.id],
    );
    expect(events.map((e) => e.action).sort()).toEqual([
      "growth.lead_created",
      "growth.lead_reopened",
      "growth.lead_stage_changed",
      "growth.lead_updated",
    ]);
    const serialized = JSON.stringify(events);
    for (const secret of [SECRET, "Ravi", "ravi@example.test"]) expect(serialized).not.toContain(secret);
  });
});
