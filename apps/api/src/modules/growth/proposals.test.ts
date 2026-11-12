import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, call, createSuperAdmin, createUser, loginToken, SUPER_ADMIN } from "../../../test/helpers.js";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";

const CGO = { email: "proposal-cgo@example.test", name: "Proposal CGO", password: "proposal-cgo-password" } as const;
const CFO = { email: "proposal-cfo@example.test", name: "Proposal CFO", password: "proposal-cfo-password" } as const;

describe("proposal API", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  const tokens: Record<string, string> = {};
  const tokenFor = (who: string): string => {
    const token = tokens[who];
    if (token === undefined) throw new Error(`Missing test token for ${who}`);
    return token;
  };
  const post = (who: string, url: string, payload: object = {}) =>
    call(app, { method: "POST", url, token: tokenFor(who), payload });
  const get = (who: string, url: string) => call(app, { method: "GET", url, token: tokenFor(who) });
  const lead = async () => (await post("cgo", "/api/v1/growth/leads", { name: "Proposal lead", source: "linkedin" })).json<{ lead: { id: string } }>().lead.id;
  const version = { documentUrl: "https://docs.example.test/proposal", amountMinor: 500_000, validUntil: "2099-12-31", summary: "Scope", expectedVersionNo: null };

  beforeAll(async () => {
    db = await createTestDatabase();
    await createSuperAdmin(db.migrator);
    await createUser(db.migrator, { ...CGO, role: "cgo" });
    await createUser(db.migrator, { ...CFO, role: "cfo" });
    const setup = await buildTestApp(db.app);
    tokens.ceo = await loginToken(setup, SUPER_ADMIN.email, SUPER_ADMIN.password);
    tokens.cgo = await loginToken(setup, CGO.email, CGO.password);
    tokens.cfo = await loginToken(setup, CFO.email, CFO.password);
    await setup.close();
  });
  afterAll(async () => { await db.close(); });
  beforeEach(async () => { app = await buildTestApp(db.app); });
  afterEach(async () => { await app.close(); });

  it("checks read access first and returns an empty detail for an existing lead without a proposal", async () => {
    const leadId = await lead();
    expect((await get("cfo", `/api/v1/growth/leads/${leadId}/proposal`)).statusCode).toBe(403);
    expect((await get("ceo", "/api/v1/growth/leads/not-a-uuid/proposal")).statusCode).toBe(404);
    expect((await get("ceo", "/api/v1/growth/leads/11111111-1111-7111-8111-111111111111/proposal")).statusCode).toBe(404);
    expect((await get("ceo", `/api/v1/growth/leads/${leadId}/proposal`)).json()).toMatchObject({ proposal: null, versions: [], events: [], acceptances: [] });
  });

  it("allows CGO creation, rejects stale versions, and records draft supersession", async () => {
    const leadId = await lead();
    expect((await post("ceo", `/api/v1/growth/leads/${leadId}/proposal/versions`, version)).statusCode).toBe(403);
    const first = await post("cgo", `/api/v1/growth/leads/${leadId}/proposal/versions`, version);
    expect(first.statusCode).toBe(201);
    const proposal = first.json<{ proposal: { id: string; currentVersionNo: number } }>().proposal;
    expect((await post("cgo", `/api/v1/growth/leads/${leadId}/proposal/versions`, version)).statusCode).toBe(409);
    const second = await post("cgo", `/api/v1/growth/leads/${leadId}/proposal/versions`, { ...version, expectedVersionNo: proposal.currentVersionNo });
    expect(second.statusCode).toBe(201);
    const detail = (await get("ceo", `/api/v1/growth/leads/${leadId}/proposal`)).json<{ events: { fromStatus: string | null; toStatus: string }[] }>();
    expect(detail.events.map((event) => [event.fromStatus, event.toStatus])).toEqual([[null, "draft"], ["draft", "superseded"], [null, "draft"]]);
  });

  it("enforces CGO/CEO operational boundaries and the direct proposal lifecycle", async () => {
    const leadId = await lead();
    const created = (await post("cgo", `/api/v1/growth/leads/${leadId}/proposal/versions`, version)).json<{ proposal: { id: string; currentVersionNo: number } }>().proposal;
    expect((await post("ceo", `/api/v1/growth/proposals/${created.id}/submit`, { versionNo: created.currentVersionNo })).statusCode).toBe(403);
    expect((await post("cgo", `/api/v1/growth/proposals/${created.id}/approve`, { versionNo: created.currentVersionNo })).statusCode).toBe(403);
    expect((await post("cfo", `/api/v1/growth/proposals/${created.id}/submit`, { versionNo: created.currentVersionNo })).statusCode).toBe(403);
    expect((await post("cgo", `/api/v1/growth/proposals/${created.id}/submit`, { versionNo: created.currentVersionNo })).statusCode).toBe(200);
    expect((await post("ceo", `/api/v1/growth/proposals/${created.id}/approve`, { versionNo: created.currentVersionNo })).statusCode).toBe(200);
    expect((await post("cgo", `/api/v1/growth/proposals/${created.id}/sent`, { versionNo: created.currentVersionNo })).statusCode).toBe(200);
    expect((await post("cgo", `/api/v1/growth/proposals/${created.id}/withdraw`, { versionNo: created.currentVersionNo, note: "Client paused" })).statusCode).toBe(200);
  });

  it("lists proposals and restricts the CEO queue", async () => {
    const leadId = await lead();
    const proposal = (await post("cgo", `/api/v1/growth/leads/${leadId}/proposal/versions`, version)).json<{ proposal: { id: string; currentVersionNo: number } }>().proposal;
    await post("cgo", `/api/v1/growth/proposals/${proposal.id}/submit`, { versionNo: proposal.currentVersionNo });
    expect((await get("cfo", "/api/v1/growth/proposals")).statusCode).toBe(403);
    expect((await get("cgo", "/api/v1/growth/proposals")).statusCode).toBe(200);
    expect((await get("cgo", "/api/v1/growth/proposals/queue")).statusCode).toBe(403);
    const queue = await get("ceo", "/api/v1/growth/proposals/queue");
    expect(queue.statusCode).toBe(200);
    expect(queue.json<{ items: { status: string }[] }>().items.every((item) => ["pending_approval", "acceptance_pending"].includes(item.status))).toBe(true);
  });
});
