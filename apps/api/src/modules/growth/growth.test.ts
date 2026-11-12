import { companyPageSchema, companyResponseSchema, contactPageSchema, contactResponseSchema, type Company } from "@crm/contracts/growth";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import { buildTestApp, call, createSuperAdmin, createUser, loginToken, SUPER_ADMIN, TEST_ORIGIN } from "../../../test/helpers.js";

const person = (key: string) => ({ email: `${key}@example.test`, name: `Test ${key}`, password: `test-${key}-password` });
const CGO = person("cgo");
const CFO = person("cfo");
const ALICE = person("alice");

/** Distinctive personal data that must never appear in audit events. */
const SECRET_NAME = "Private Person 7c2e";
const SECRET_EMAIL = "private-7c2e@example.test";
const UNKNOWN_ID = "00000000-0000-7000-8000-000000000000";

describe("growth companies and contacts", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const as = (key: string) => tokens[key] ?? "";
  const get = (who: string, url: string) => call(app, { method: "GET", url, token: as(who) });
  const post = (who: string, url: string, payload: object = {}) => call(app, { method: "POST", url, token: as(who), payload });
  const patch = (who: string, url: string, payload: object) =>
    app.inject({ method: "PATCH", url, headers: { origin: TEST_ORIGIN }, cookies: { crm_session: as(who) }, payload });

  const newCompany = async (name: string): Promise<Company> => {
    const response = await post("cgo", "/api/v1/growth/companies", { name, industry: "Software" });
    expect(response.statusCode).toBe(201);
    return companyResponseSchema.parse(response.json()).company;
  };
  const newContact = async (companyId: string, extra: object = { email: "asha@example.test" }) => {
    const response = await post("cgo", `/api/v1/growth/companies/${companyId}/contacts`, { fullName: "Asha Rao", ...extra });
    expect(response.statusCode).toBe(201);
    return contactResponseSchema.parse(response.json()).contact;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    ids["ceo"] = (await createSuperAdmin(db.migrator)).userId;
    ids["cgo"] = await createUser(db.migrator, { ...CGO, role: "cgo" });
    ids["cfo"] = await createUser(db.migrator, { ...CFO, role: "cfo" });
    ids["alice"] = await createUser(db.migrator, { ...ALICE, role: "employee" });
    const setupApp = await buildTestApp(db.app);
    for (const [key, who] of [["ceo", SUPER_ADMIN], ["cgo", CGO], ["cfo", CFO], ["alice", ALICE]] as const) {
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

  it("the CGO manages companies and contacts; the CEO reads; other roles get 403 everywhere", async () => {
    const company = await newCompany("Acme Corp");
    expect(company).toMatchObject({ name: "Acme Corp", industry: "Software", ownerId: ids["cgo"], ownerFlagged: false, archivedAt: null });
    const contact = await newContact(company.id);

    expect((await get("ceo", `/api/v1/growth/companies/${company.id}`)).statusCode).toBe(200);
    expect((await get("ceo", `/api/v1/growth/contacts/${contact.id}`)).statusCode).toBe(200);
    expect((await post("ceo", "/api/v1/growth/companies", { name: "CEO Co" })).statusCode).toBe(403);
    expect((await patch("ceo", `/api/v1/growth/companies/${company.id}`, { notes: "x" })).statusCode).toBe(403);
    expect((await post("ceo", `/api/v1/growth/contacts/${contact.id}/archive`)).statusCode).toBe(403);

    for (const who of ["cfo", "alice"]) {
      expect((await get(who, "/api/v1/growth/companies")).statusCode).toBe(403);
      expect((await get(who, `/api/v1/growth/companies/${company.id}`)).statusCode).toBe(403);
      expect((await get(who, `/api/v1/growth/companies/${company.id}/contacts`)).statusCode).toBe(403);
      expect((await get(who, `/api/v1/growth/contacts/${contact.id}`)).statusCode).toBe(403);
      expect((await post(who, "/api/v1/growth/companies", { name: "Nope" })).statusCode).toBe(403);
    }
    const list = companyPageSchema.parse((await get("ceo", "/api/v1/growth/companies")).json());
    expect(list.items.find((c) => c.id === company.id)?.contactCount).toBe(1);
  });

  it("uses the repository status convention: 403 before 404, malformed or unknown ids 404, bad bodies 400", async () => {
    expect((await get("cgo", "/api/v1/growth/companies/not-a-uuid")).statusCode).toBe(404);
    expect((await get("cfo", "/api/v1/growth/companies/not-a-uuid")).statusCode).toBe(403);
    expect((await patch("cgo", "/api/v1/growth/contacts/not-a-uuid", { fullName: "x" })).statusCode).toBe(404);
    expect((await patch("ceo", "/api/v1/growth/contacts/not-a-uuid", { fullName: "x" })).statusCode).toBe(403);
    expect((await get("cgo", `/api/v1/growth/companies/${UNKNOWN_ID}`)).statusCode).toBe(404);
    expect((await get("cgo", `/api/v1/growth/contacts/${UNKNOWN_ID}`)).statusCode).toBe(404);

    const company = await newCompany("Status Co");
    expect((await post("cgo", "/api/v1/growth/companies", { name: "   " })).statusCode).toBe(400);
    expect((await post("cgo", "/api/v1/growth/companies", { name: "X", websiteUrl: "http://x.test" })).statusCode).toBe(400);
    expect((await post("cgo", "/api/v1/growth/companies", { name: "X", industry: "x".repeat(101) })).statusCode).toBe(400);
    expect((await post("cgo", `/api/v1/growth/companies/${company.id}/contacts`, { fullName: "No Method" })).statusCode).toBe(400);
  });

  it("refuses duplicate company names that differ only by case or spacing, and duplicate contact emails", async () => {
    await newCompany("Globex   Industries");
    expect((await post("cgo", "/api/v1/growth/companies", { name: " globex industries " })).statusCode).toBe(409);
    const company = await newCompany("Initech");
    await newContact(company.id, { email: "peter@example.test" });
    expect((await post("cgo", `/api/v1/growth/companies/${company.id}/contacts`, { fullName: "P", email: "PETER@example.test" })).statusCode).toBe(409);
  });

  it("checks the contact-method rule against the edited result", async () => {
    const company = await newCompany("Methods Inc");
    const contact = await newContact(company.id, { email: "m@example.test" });
    expect((await patch("cgo", `/api/v1/growth/contacts/${contact.id}`, { email: "" })).statusCode).toBe(400);
    const changed = await patch("cgo", `/api/v1/growth/contacts/${contact.id}`, { email: "", phone: "+91 98765 43210" });
    expect(changed.statusCode).toBe(200);
    expect(contactResponseSchema.parse(changed.json()).contact).toMatchObject({ email: null, phone: "+91 98765 43210" });
  });

  it("archived companies and their contacts are read-only but still readable", async () => {
    const company = await newCompany("Archive Ltd");
    const contact = await newContact(company.id);
    expect((await post("cgo", `/api/v1/growth/companies/${company.id}/archive`)).statusCode).toBe(200);
    const [before] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_events WHERE entity_type LIKE 'growth_%'");

    expect((await post("cgo", `/api/v1/growth/companies/${company.id}/contacts`, { fullName: "Late", email: "late@example.test" })).statusCode).toBe(409);
    expect((await patch("cgo", `/api/v1/growth/contacts/${contact.id}`, { roleTitle: "CTO" })).statusCode).toBe(409);
    expect((await patch("cgo", `/api/v1/growth/contacts/${contact.id}`, { doNotContact: true })).statusCode).toBe(409);
    expect((await post("cgo", `/api/v1/growth/contacts/${contact.id}/archive`)).statusCode).toBe(409);
    expect((await patch("cgo", `/api/v1/growth/companies/${company.id}`, { notes: "x" })).statusCode).toBe(409);
    expect((await post("cgo", `/api/v1/growth/companies/${company.id}/archive`)).statusCode).toBe(409);

    const [after] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_events WHERE entity_type LIKE 'growth_%'");
    expect(after?.n).toBe(before?.n);

    expect((await get("cgo", `/api/v1/growth/companies/${company.id}`)).statusCode).toBe(200);
    expect((await get("ceo", `/api/v1/growth/contacts/${contact.id}`)).statusCode).toBe(200);
    const contacts = contactPageSchema.parse((await get("cgo", `/api/v1/growth/companies/${company.id}/contacts`)).json());
    expect(contacts.items[0]).toMatchObject({ id: contact.id, companyArchived: true });
    const archived = companyPageSchema.parse((await get("cgo", "/api/v1/growth/companies?archived=true")).json());
    expect(archived.items.map((c) => c.id)).toContain(company.id);
  });

  it("flags records whose owner is no longer an active CGO, keeps them editable, and refuses new ones from them", async () => {
    const company = await newCompany("Flag Co");
    // Test-only role change, as crm_migrator in the throwaway database.
    await db.query("UPDATE users SET role = 'cmo' WHERE id = $1", [ids["cgo"]]);
    try {
      const flagged = companyResponseSchema.parse((await get("ceo", `/api/v1/growth/companies/${company.id}`)).json()).company;
      expect(flagged.ownerFlagged).toBe(true);
    } finally {
      await db.query("UPDATE users SET role = 'cgo' WHERE id = $1", [ids["cgo"]]);
    }
    // Back to CGO: editing works again and the flag clears.
    expect((await patch("cgo", `/api/v1/growth/companies/${company.id}`, { notes: "Still ours" })).statusCode).toBe(200);
  });

  it("never records names, emails, phones, links, notes or industry in audit events", async () => {
    const company = await newCompany("Audit Co");
    await patch("cgo", `/api/v1/growth/companies/${company.id}`, { notes: SECRET_NAME, industry: SECRET_NAME });
    const contact = await newContact(company.id, { email: SECRET_EMAIL, linkedinUrl: "https://www.linkedin.com/in/private-7c2e" });
    await patch("cgo", `/api/v1/growth/contacts/${contact.id}`, { fullName: SECRET_NAME, doNotContact: true });
    await post("cgo", `/api/v1/growth/contacts/${contact.id}/archive`);
    const events = await db.query<{ action: string; before: unknown; after: unknown }>(
      "SELECT action, before, after FROM audit_events WHERE entity_type IN ('growth_company', 'growth_contact') AND entity_id IN ($1, $2)",
      [company.id, contact.id],
    );
    expect(events.map((e) => e.action).sort()).toEqual([
      "growth.company_created",
      "growth.company_updated",
      "growth.contact_archived",
      "growth.contact_created",
      "growth.contact_updated",
    ]);
    const update = events.find((e) => e.action === "growth.contact_updated");
    expect(update?.before).toEqual({ doNotContact: false });
    expect(update?.after).toMatchObject({ doNotContact: true, fullNameChanged: true });
    const serialized = JSON.stringify(events);
    for (const secret of [SECRET_NAME, SECRET_EMAIL, "private-7c2e", "Audit Co", "Asha Rao"]) expect(serialized).not.toContain(secret);
  });
});
