import { companyResponseSchema, contactResponseSchema } from "@crm/contracts/growth";
import { activityResponseSchema, leadPageSchema, leadResponseSchema, type Lead } from "@crm/contracts/growth-leads";
import { addDays, growthOverviewSchema, type GrowthOverview } from "@crm/contracts/growth-reports";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import { buildTestApp, call, createSuperAdmin, createUser, dateFromToday, loginToken, SUPER_ADMIN } from "../../../test/helpers.js";

const person = (key: string) => ({ email: `${key}@example.test`, name: `Test ${key}`, password: `test-${key}-password` });
const CGO = person("report-cgo");
const SECRET = "private-report-text-7c2e";
/** Every role without growth:read_all. */
const DENIED = ["cfo", "cmo", "vp_engineering_quality", "founder", "employee", "intern", "contractor"] as const;

describe("growth reports", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const as = (key: string) => tokens[key] ?? "";
  const get = (who: string, url: string) => call(app, { method: "GET", url, token: as(who) });
  const post = (who: string, url: string, payload: object = {}) => call(app, { method: "POST", url, token: as(who), payload });

  const overview = async (who = "cgo", query = ""): Promise<GrowthOverview> => {
    const response = await get(who, `/api/v1/growth/reports/overview${query}`);
    expect(response.statusCode).toBe(200);
    return growthOverviewSchema.parse(response.json());
  };
  const newLead = async (extra: object = {}): Promise<Lead> => {
    const response = await post("cgo", "/api/v1/growth/leads", { name: `Deal ${SECRET}`, source: "referral", ...extra });
    expect(response.statusCode).toBe(201);
    return leadResponseSchema.parse(response.json()).lead;
  };
  const move = async (id: string, payload: object) => {
    expect((await post("cgo", `/api/v1/growth/leads/${id}/stage`, payload)).statusCode).toBe(200);
  };
  const lose = (id: string) => move(id, { to: "lost", lostReason: "price", note: SECRET });
  const newCompany = async (name: string) =>
    companyResponseSchema.parse((await post("cgo", "/api/v1/growth/companies", { name })).json()).company.id;

  /** The 4A.3 path to won: version → submit → approve → sent → signed acceptance → mark won. */
  const win = async (leadId: string, amountMinor: number) => {
    const version = await post("cgo", `/api/v1/growth/leads/${leadId}/proposal/versions`, {
      documentUrl: "https://example.com/proposal.pdf",
      amountMinor,
      validUntil: dateFromToday(30),
      summary: "Scope",
      expectedVersionNo: null,
    });
    expect(version.statusCode).toBe(201);
    const proposal = version.json<{ proposal: { id: string; currentVersionNo: number } }>().proposal;
    const versionNo = proposal.currentVersionNo;
    for (const [who, action] of [["cgo", "submit"], ["ceo", "approve"], ["cgo", "sent"]] as const) {
      expect((await post(who, `/api/v1/growth/proposals/${proposal.id}/${action}`, { versionNo })).statusCode).toBe(200);
    }
    const accepted = await post("cgo", `/api/v1/growth/proposals/${proposal.id}/acceptance`, {
      versionNo,
      method: "signed_document",
      evidenceUrl: "https://example.com/signed.pdf",
      acceptedOn: dateFromToday(0),
    });
    expect(accepted.statusCode).toBe(200);
    expect((await post("cgo", `/api/v1/growth/leads/${leadId}/won`, { versionNo })).statusCode).toBe(200);
  };

  /** Only an open, non-archived lead's created_at can be moved; history and won/lost timestamps are immutable. */
  const ageLead = (id: string, days: number) =>
    db.query("UPDATE growth_leads SET created_at = now() - make_interval(days => $2::int) WHERE id = $1", [id, days]);

  beforeEach(async () => {
    db = await createTestDatabase();
    ids["ceo"] = (await createSuperAdmin(db.migrator)).userId;
    ids["cgo"] = await createUser(db.migrator, { ...CGO, role: "cgo" });
    for (const role of DENIED) await createUser(db.migrator, { ...person(`report-${role}`), role });
    app = await buildTestApp(db.app);
    tokens["ceo"] = await loginToken(app, SUPER_ADMIN.email, SUPER_ADMIN.password);
    tokens["cgo"] = await loginToken(app, CGO.email, CGO.password);
    for (const role of DENIED) {
      const who = person(`report-${role}`);
      tokens[role] = await loginToken(app, who.email, who.password);
    }
  });
  afterEach(async () => {
    await (app as FastifyInstance | undefined)?.close();
    await (db as TestDatabase | undefined)?.close();
  });

  it("is readable by the CEO/CTO and the CGO only, and reading writes no audit events", async () => {
    expect((await call(app, { method: "GET", url: "/api/v1/growth/reports/overview" })).statusCode).toBe(401);
    for (const role of DENIED) {
      expect((await get(role, "/api/v1/growth/reports/overview")).statusCode).toBe(403);
      expect((await get(role, "/api/v1/growth/reports/overview?from=bad")).statusCode).toBe(403);
      expect((await get(role, "/api/v1/growth/leads?stale=true")).statusCode).toBe(403);
    }
    const before = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_events");
    await overview("ceo");
    await overview("cgo");
    const after = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_events");
    expect(after[0]?.n).toBe(before[0]?.n);
    expect((await post("ceo", "/api/v1/growth/leads", { name: "X", source: "other" })).statusCode).toBe(403);
  });

  it("validates the range: 90-day default, no future dates, at most 366 days", async () => {
    const today = dateFromToday(0);
    const result = await overview();
    expect(result).toMatchObject({ today, range: { from: addDays(today, -89), to: today }, staleDays: 14, currency: "INR" });
    expect((await overview("cgo", `?from=${addDays(today, -365)}&to=${today}`)).range.from).toBe(addDays(today, -365));
    for (const query of [
      "?from=2026-13-01",
      "?to=tomorrow",
      "?owner=x",
      `?from=${today}&to=${addDays(today, -1)}`,
      `?to=${addDays(today, 1)}`,
      `?from=${addDays(today, -366)}&to=${today}`,
    ]) {
      expect((await get("cgo", `/api/v1/growth/reports/overview${query}`)).statusCode).toBe(400);
    }
  });

  it("an empty pipeline reports zeros, zero-filled stages and sources, and no win rate", async () => {
    const result = await overview();
    expect(result.pipeline).toEqual({ openCount: 0, openValueMinor: 0, unvaluedCount: 0, overdueCount: 0, staleCount: 0 });
    expect(result.stages.map((s) => [s.stage, s.count])).toEqual([["new", 0], ["contacted", 0], ["qualified", 0], ["proposal", 0], ["negotiation", 0]]);
    expect(result.funnel.every((f) => f.entered === 0)).toBe(true);
    expect(result.bySource).toHaveLength(8);
    expect(result.closed).toEqual({ wonCount: 0, wonAmountMinor: 0, lostCount: 0, winRate: null, lostReasons: [] });
    expect(result.byOwner).toEqual([]);
    expect(result.byCompany).toEqual([]);
  });

  it("live figures exclude archived leads; overdue and unvalued leads are counted", async () => {
    const companyId = await newCompany("Report Co");
    const a = await newLead({ estimatedValueMinor: 100_00, companyId, source: "linkedin" });
    const b = await newLead({ estimatedValueMinor: 250_00 });
    await move(b.id, { to: "qualified" });
    await newLead();
    const archived = await newLead({ estimatedValueMinor: 999_00 });
    expect((await post("cgo", `/api/v1/growth/leads/${archived.id}/archive`)).statusCode).toBe(200);
    await db.query("UPDATE growth_leads SET next_follow_up_on = $2::date WHERE id = $1", [a.id, dateFromToday(-1)]);

    const result = await overview("ceo");
    expect(result.pipeline).toEqual({ openCount: 3, openValueMinor: 350_00, unvaluedCount: 1, overdueCount: 1, staleCount: 0 });
    expect(result.stages.find((s) => s.stage === "new")).toEqual({ stage: "new", count: 2, valueMinor: 100_00 });
    expect(result.stages.find((s) => s.stage === "qualified")).toEqual({ stage: "qualified", count: 1, valueMinor: 250_00 });
    expect(result.bySource.find((s) => s.source === "linkedin")).toMatchObject({ openCount: 1, openValueMinor: 100_00 });
    expect(result.bySource.find((s) => s.source === "referral")).toMatchObject({ openCount: 2, openValueMinor: 250_00 });
    expect(result.byOwner).toEqual([
      { ownerId: ids["cgo"], ownerFlagged: false, openCount: 3, openValueMinor: 350_00, wonCount: 0, wonAmountMinor: 0, lostCount: 0 },
    ]);
    expect(result.byCompany).toEqual([
      { kind: "company", companyId, name: "Report Co", openCount: 1, openValueMinor: 100_00, wonCount: 0, wonAmountMinor: 0, lostCount: 0 },
      { kind: "none", companyId: null, name: null, openCount: 2, openValueMinor: 250_00, wonCount: 0, wonAmountMinor: 0, lostCount: 0 },
    ]);
  });

  it("won and lost are historical: archived leads count, reopened leads do not, and the range bounds them", async () => {
    const won = await newLead();
    await win(won.id, 500_00);
    await lose((await newLead()).id);
    const archivedLost = await newLead();
    await lose(archivedLost.id);
    expect((await post("cgo", `/api/v1/growth/leads/${archivedLost.id}/archive`)).statusCode).toBe(200);
    const reopened = await newLead();
    await lose(reopened.id);
    expect((await post("ceo", `/api/v1/growth/leads/${reopened.id}/reopen`, { to: "qualified", note: "Back" })).statusCode).toBe(200);

    const result = await overview();
    expect(result.closed).toEqual({ wonCount: 1, wonAmountMinor: 500_00, lostCount: 2, winRate: 1 / 3, lostReasons: [{ reason: "price", count: 2 }] });
    expect(result.byOwner[0]).toMatchObject({ wonCount: 1, wonAmountMinor: 500_00, lostCount: 2, openCount: 1 });
    expect(result.pipeline.openCount).toBe(1);

    const today = dateFromToday(0);
    const earlier = await overview("cgo", `?from=${addDays(today, -30)}&to=${addDays(today, -1)}`);
    expect(earlier.closed).toMatchObject({ wonCount: 0, lostCount: 0, winRate: null });
    expect(earlier.funnel.every((f) => f.entered === 0)).toBe(true);
    expect(earlier.pipeline.openCount).toBe(1);
    expect((await overview("cgo", `?from=${today}&to=${today}`)).closed.wonCount).toBe(1);
  });

  it("the funnel counts creation for new and each lead once per entered stage, lost included", async () => {
    const a = await newLead();
    for (const to of ["contacted", "new", "contacted", "qualified"]) await move(a.id, { to });
    const b = await newLead();
    await move(b.id, { to: "contacted" });
    await win(b.id, 10_00);
    const c = await newLead();
    await lose(c.id);
    const result = await overview();
    expect(Object.fromEntries(result.funnel.map((f) => [f.stage, f.entered]))).toEqual({
      new: 3,
      contacted: 2,
      qualified: 1,
      proposal: 0,
      negotiation: 0,
      won: 1,
      lost: 1,
    });
  });

  it("stale: more than 14 days without a stage change or non-voided activity; archived leads are never stale", async () => {
    const companyId = await newCompany("Stale Co");
    const contactId = contactResponseSchema.parse(
      (await post("cgo", `/api/v1/growth/companies/${companyId}/contacts`, { fullName: `Contact ${SECRET}`, email: "stale@example.test" })).json(),
    ).contact.id;
    const atThreshold = await newLead();
    const overThreshold = await newLead();
    const recent = await newLead();
    const voidedOnly = await newLead({ companyId, primaryContactId: contactId });
    const touched = await newLead();
    const archived = await newLead();
    await ageLead(atThreshold.id, 14);
    await ageLead(overThreshold.id, 15);
    await ageLead(recent.id, 13);
    await ageLead(voidedOnly.id, 20);
    await ageLead(touched.id, 20);
    await ageLead(archived.id, 20);
    expect((await post("cgo", `/api/v1/growth/leads/${archived.id}/archive`)).statusCode).toBe(200);

    const log = async (leadId: string) => {
      const response = await post("cgo", "/api/v1/growth/activities", {
        leadId,
        kind: "call",
        direction: "inbound",
        occurredAt: new Date().toISOString(),
        summary: SECRET,
      });
      expect(response.statusCode).toBe(201);
      return activityResponseSchema.parse(response.json()).activity.id;
    };
    const activity = await log(voidedOnly.id);
    expect((await post("cgo", `/api/v1/growth/activities/${activity}/void`, { reason: "Logged by mistake" })).statusCode).toBe(200);
    await log(touched.id);

    const staleIds = leadPageSchema.parse((await get("cgo", "/api/v1/growth/leads?stale=true")).json()).items.map((l) => l.id);
    expect(staleIds.sort()).toEqual([overThreshold.id, voidedOnly.id].sort());
    const fresh = leadPageSchema.parse((await get("ceo", "/api/v1/growth/leads?stale=false")).json()).items.map((l) => l.id);
    expect(fresh.sort()).toEqual([atThreshold.id, recent.id, touched.id].sort());
    expect((await overview()).pipeline.staleCount).toBe(2);

    await move(overThreshold.id, { to: "contacted" });
    expect((await overview()).pipeline.staleCount).toBe(1);
  });

  it("names the top ten companies, then no company, then folds the rest into other", async () => {
    for (let i = 1; i <= 12; i++) {
      const companyId = await newCompany(`Co ${String(i).padStart(2, "0")}`);
      await newLead({ companyId, estimatedValueMinor: i * 100 });
    }
    await newLead({ estimatedValueMinor: 5 });
    const rows = (await overview()).byCompany;
    expect(rows).toHaveLength(12);
    expect(rows.slice(0, 10).map((r) => r.name)).toEqual(["Co 12", "Co 11", "Co 10", "Co 09", "Co 08", "Co 07", "Co 06", "Co 05", "Co 04", "Co 03"]);
    expect(rows[10]).toMatchObject({ kind: "none", openCount: 1, openValueMinor: 5 });
    expect(rows[11]).toMatchObject({ kind: "other", companyId: null, name: null, openCount: 2, openValueMinor: 300 });
  });

  it("never returns lead names, notes or contact data", async () => {
    const companyId = await newCompany("Private Co");
    const contact = await post("cgo", `/api/v1/growth/companies/${companyId}/contacts`, { fullName: "Ravi Kumar", email: "ravi@example.test" });
    const contactId = contactResponseSchema.parse(contact.json()).contact.id;
    const lead = await newLead({ companyId, primaryContactId: contactId, sourceDetail: SECRET });
    await lose(lead.id);
    const body = (await get("ceo", "/api/v1/growth/reports/overview")).body;
    for (const secret of [SECRET, "Ravi", "ravi@example.test"]) expect(body).not.toContain(secret);
  });
});
