import { companyResponseSchema, contactResponseSchema } from "@crm/contracts/growth";
import { activityPageSchema, activityResponseSchema, leadDetailResponseSchema, leadResponseSchema } from "@crm/contracts/growth-leads";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import { buildTestApp, call, createSuperAdmin, createUser, dateFromToday, loginToken, SUPER_ADMIN, TEST_ORIGIN } from "../../../test/helpers.js";

const person = (key: string) => ({ email: `${key}@example.test`, name: `Test ${key}`, password: `test-${key}-password` });
const CGO = person("cgo");
const CFO = person("cfo");
const SECRET = "private-activity-text-8d3f";
const SECRET_URL = "https://example.test/private-8d3f";

describe("growth activities", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const as = (key: string) => tokens[key] ?? "";
  const get = (who: string, url: string) => call(app, { method: "GET", url, token: as(who) });
  const post = (who: string, url: string, payload: object = {}) => call(app, { method: "POST", url, token: as(who), payload });
  const patch = (url: string, payload: object) =>
    app.inject({ method: "PATCH", url, headers: { origin: TEST_ORIGIN }, cookies: { crm_session: as("cgo") }, payload });
  const now = () => new Date().toISOString();

  const company = async (name: string) =>
    companyResponseSchema.parse((await post("cgo", "/api/v1/growth/companies", { name })).json()).company.id;
  const contact = async (companyId: string, email: string) =>
    contactResponseSchema.parse((await post("cgo", `/api/v1/growth/companies/${companyId}/contacts`, { fullName: "Meera Iyer", email })).json())
      .contact.id;
  const lead = async (extra: object = {}) =>
    leadResponseSchema.parse((await post("cgo", "/api/v1/growth/leads", { name: "Deal", source: "linkedin", ...extra })).json()).lead.id;
  const log = (payload: object) => post("cgo", "/api/v1/growth/activities", { kind: "email", occurredAt: now(), summary: "Wrote", ...payload });

  beforeAll(async () => {
    db = await createTestDatabase();
    ids["ceo"] = (await createSuperAdmin(db.migrator)).userId;
    ids["cgo"] = await createUser(db.migrator, { ...CGO, role: "cgo" });
    ids["cfo"] = await createUser(db.migrator, { ...CFO, role: "cfo" });
    const setupApp = await buildTestApp(db.app);
    for (const [key, who] of [["ceo", SUPER_ADMIN], ["cgo", CGO], ["cfo", CFO]] as const) {
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

  it("outbound always needs a contact, including kind other; only the CGO logs", async () => {
    const companyId = await company("Outbound Co");
    expect((await log({ companyId, direction: "outbound", kind: "other" })).statusCode).toBe(400);
    expect((await log({ companyId, direction: "outbound" })).statusCode).toBe(400);
    expect((await log({ companyId, direction: "inbound", kind: "other" })).statusCode).toBe(201);
    expect((await post("ceo", "/api/v1/growth/activities", { companyId, kind: "email", direction: "inbound", occurredAt: now(), summary: "x" })).statusCode).toBe(403);
    expect((await post("cfo", "/api/v1/growth/activities", { companyId, kind: "email", direction: "inbound", occurredAt: now(), summary: "x" })).statusCode).toBe(403);
  });

  it("derives the company from the lead or contact, and refuses mismatched links", async () => {
    const companyId = await company("Link Co");
    const otherCompany = await company("Elsewhere Co");
    const contactId = await contact(companyId, "meera@example.test");
    const otherContact = await contact(otherCompany, "other@example.test");
    const leadId = await lead({ companyId });

    const fromLead = activityResponseSchema.parse((await log({ leadId, direction: "inbound" })).json()).activity;
    expect(fromLead.companyId).toBe(companyId);
    const fromContact = activityResponseSchema.parse((await log({ contactId, direction: "outbound" })).json()).activity;
    expect(fromContact.companyId).toBe(companyId);

    expect((await log({ leadId, companyId: otherCompany, direction: "inbound" })).statusCode).toBe(409);
    expect((await log({ leadId, contactId: otherContact, direction: "outbound" })).statusCode).toBe(409);
    expect((await log({ companyId, contactId: otherContact, direction: "outbound" })).statusCode).toBe(409);
  });

  it("a lead with no company accepts only inbound activity without a contact", async () => {
    const companyId = await company("Loose Co");
    const contactId = await contact(companyId, "loose@example.test");
    const leadId = await lead();
    expect((await log({ leadId, direction: "inbound" })).statusCode).toBe(201);
    expect((await log({ leadId, contactId, direction: "inbound" })).statusCode).toBe(409);
    expect((await log({ leadId, contactId, direction: "outbound" })).statusCode).toBe(409);
    expect((await log({ leadId, companyId, direction: "inbound" })).statusCode).toBe(409);
  });

  it("refuses outbound to do-not-contact or archived contacts and archived leads; inbound to do-not-contact is allowed", async () => {
    const companyId = await company("Rules Co");
    const contactId = await contact(companyId, "rules@example.test");
    await patch(`/api/v1/growth/contacts/${contactId}`, { doNotContact: true });
    expect((await log({ contactId, direction: "outbound" })).statusCode).toBe(409);
    expect((await log({ contactId, direction: "inbound" })).statusCode).toBe(201);
    const archivedContact = await contact(companyId, "gone@example.test");
    await post("cgo", `/api/v1/growth/contacts/${archivedContact}/archive`);
    expect((await log({ contactId: archivedContact, direction: "inbound" })).statusCode).toBe(409);
    const leadId = await lead({ companyId });
    await post("cgo", `/api/v1/growth/leads/${leadId}/archive`);
    expect((await log({ leadId, direction: "inbound" })).statusCode).toBe(409);
  });

  it("refuses future or very old times and http proof links", async () => {
    const companyId = await company("Time Co");
    expect((await log({ companyId, direction: "inbound", occurredAt: new Date(Date.now() + 10 * 60_000).toISOString() })).statusCode).toBe(400);
    expect((await log({ companyId, direction: "inbound", occurredAt: new Date(Date.now() - 400 * 86_400_000).toISOString() })).statusCode).toBe(400);
    expect((await log({ companyId, direction: "inbound", proofUrl: "http://x.test" })).statusCode).toBe(400);
  });

  it("can set the lead's next follow-up date in the same transaction", async () => {
    const leadId = await lead();
    expect((await log({ leadId, direction: "inbound", nextFollowUpOn: dateFromToday(3) })).statusCode).toBe(201);
    const detail = leadDetailResponseSchema.parse((await get("ceo", `/api/v1/growth/leads/${leadId}`)).json());
    expect(detail.lead.nextFollowUpOn).toBe(dateFromToday(3));
    expect((await log({ leadId, direction: "inbound", nextFollowUpOn: dateFromToday(-1) })).statusCode).toBe(400);
  });

  it("voids once with a reason; voided activities stay visible", async () => {
    const companyId = await company("Void Co");
    const activity = activityResponseSchema.parse((await log({ companyId, direction: "inbound" })).json()).activity;
    expect((await post("cgo", `/api/v1/growth/activities/${activity.id}/void`, {})).statusCode).toBe(400);
    expect((await post("ceo", `/api/v1/growth/activities/${activity.id}/void`, { reason: "x" })).statusCode).toBe(403);
    expect((await post("cgo", `/api/v1/growth/activities/${activity.id}/void`, { reason: "Logged twice" })).statusCode).toBe(200);
    expect((await post("cgo", `/api/v1/growth/activities/${activity.id}/void`, { reason: "Again" })).statusCode).toBe(409);
    const list = activityPageSchema.parse((await get("ceo", `/api/v1/growth/companies/${companyId}/activities`)).json());
    expect(list.items[0]).toMatchObject({ id: activity.id, voidReason: "Logged twice" });
    expect((await get("cfo", `/api/v1/growth/companies/${companyId}/activities`)).statusCode).toBe(403);
  });

  it("never records summaries, proof links, void reasons or contact data in audit events", async () => {
    const companyId = await company("Audit Activity Co");
    const contactId = await contact(companyId, "audit@example.test");
    const activity = activityResponseSchema.parse(
      (await log({ contactId, direction: "outbound", summary: SECRET, proofUrl: SECRET_URL })).json(),
    ).activity;
    await post("cgo", `/api/v1/growth/activities/${activity.id}/void`, { reason: SECRET });
    const events = await db.query<{ action: string; after: Record<string, unknown> }>(
      "SELECT action, after FROM audit_events WHERE entity_type = 'growth_activity' AND entity_id = $1 ORDER BY occurred_at, id",
      [activity.id],
    );
    expect(events.map((e) => e.action)).toEqual(["growth.activity_logged", "growth.activity_voided"]);
    expect(events[0]?.after).toMatchObject({ kind: "email", direction: "outbound", hasProof: true, contactId, companyId });
    const serialized = JSON.stringify(events);
    for (const secret of [SECRET, SECRET_URL, "Meera", "audit@example.test"]) expect(serialized).not.toContain(secret);
  });
});
