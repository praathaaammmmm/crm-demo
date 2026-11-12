import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, call, createSuperAdmin, createUser, dateFromToday, loginToken, SUPER_ADMIN } from "../../../test/helpers.js";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";

const CGO = { email: "accept-cgo@example.test", name: "Acceptance CGO", password: "accept-cgo-password" } as const;

describe("proposal acceptance API", () => {
  let db: TestDatabase; let app: FastifyInstance; const tokens: Record<string, string> = {};
  const tokenFor = (who: string): string => {
    const token = tokens[who];
    if (token === undefined) throw new Error(`Missing test token for ${who}`);
    return token;
  };
  const post = (who: string, url: string, payload: object = {}) =>
    call(app, { method: "POST", url, token: tokenFor(who), payload });
  const ready = async () => {
    const lead = (await post("cgo", "/api/v1/growth/leads", { name: "Acceptance lead", source: "linkedin" })).json<{ lead: { id: string } }>().lead;
    const proposal = (await post("cgo", `/api/v1/growth/leads/${lead.id}/proposal/versions`, { documentUrl: "https://docs.example.test/a", amountMinor: 500_000, validUntil: "2099-12-31", summary: "Scope", expectedVersionNo: null })).json<{ proposal: { id: string; currentVersionNo: number } }>().proposal;
    await post("cgo", `/api/v1/growth/proposals/${proposal.id}/submit`, { versionNo: proposal.currentVersionNo });
    await post("ceo", `/api/v1/growth/proposals/${proposal.id}/approve`, { versionNo: proposal.currentVersionNo });
    await post("cgo", `/api/v1/growth/proposals/${proposal.id}/sent`, { versionNo: proposal.currentVersionNo });
    return { lead, proposal };
  };
  beforeAll(async () => { db = await createTestDatabase(); await createSuperAdmin(db.migrator); await createUser(db.migrator, { ...CGO, role: "cgo" }); const setup = await buildTestApp(db.app); tokens.ceo = await loginToken(setup, SUPER_ADMIN.email, SUPER_ADMIN.password); tokens.cgo = await loginToken(setup, CGO.email, CGO.password); await setup.close(); });
  afterAll(async () => { await db.close(); }); beforeEach(async () => { app = await buildTestApp(db.app); }); afterEach(async () => { await app.close(); });

  it("requires evidence for non-verbal acceptance and a note for verbal acceptance", async () => {
    const { proposal } = await ready();
    expect((await post("cgo", `/api/v1/growth/proposals/${proposal.id}/acceptance`, { versionNo: proposal.currentVersionNo, method: "signed_document", acceptedOn: "2099-01-01" })).statusCode).toBe(400);
    expect((await post("cgo", `/api/v1/growth/proposals/${proposal.id}/acceptance`, { versionNo: proposal.currentVersionNo, method: "verbal", acceptedOn: "2099-01-01" })).statusCode).toBe(400);
  });

  it("requires CEO confirmation for verbal acceptance and keeps evidence and notes out of proposal audits", async () => {
    const { proposal } = await ready();
    expect((await post("cgo", `/api/v1/growth/proposals/${proposal.id}/acceptance`, { versionNo: proposal.currentVersionNo, method: "verbal", acceptedOn: dateFromToday(0), note: "Verbal secret" })).statusCode).toBe(200);
    expect((await post("cgo", `/api/v1/growth/proposals/${proposal.id}/confirm`, { versionNo: proposal.currentVersionNo })).statusCode).toBe(403);
    expect((await post("ceo", `/api/v1/growth/proposals/${proposal.id}/confirm`, { versionNo: proposal.currentVersionNo })).statusCode).toBe(200);
    const events = await db.query<{ after: Record<string, unknown> }>("SELECT after FROM audit_events WHERE entity_type = 'growth_proposal' AND entity_id = $1", [proposal.id]);
    expect(JSON.stringify(events)).not.toContain("Verbal secret");
  });

  it("allows CEO refusal and lets the refused version be replaced", async () => {
    const { lead, proposal } = await ready();
    await post("cgo", `/api/v1/growth/proposals/${proposal.id}/acceptance`, { versionNo: proposal.currentVersionNo, method: "verbal", acceptedOn: dateFromToday(0), note: "Call" });
    expect((await post("ceo", `/api/v1/growth/proposals/${proposal.id}/refuse`, { versionNo: proposal.currentVersionNo, note: "Need proof" })).statusCode).toBe(200);
    expect((await post("cgo", `/api/v1/growth/leads/${lead.id}/proposal/versions`, { documentUrl: "https://docs.example.test/b", amountMinor: 600_000, validUntil: "2099-12-31", summary: "Replacement", expectedVersionNo: proposal.currentVersionNo })).statusCode).toBe(201);
  });
});
