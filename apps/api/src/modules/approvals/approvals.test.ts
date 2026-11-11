import { approvalPageSchema, approvalResponseSchema } from "@crm/contracts/approvals";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import {
  buildTestApp,
  call,
  createSuperAdmin,
  createUser,
  getMe,
  loginToken,
  postLogin,
  SUPER_ADMIN,
} from "../../../test/helpers.js";

const person = (key: string) => ({ email: `${key}@example.test`, name: `Test ${key}`, password: `test-${key}-password` });
const CFO = person("cfo");
const CGO = person("cgo");
const EMPLOYEE = person("employee");
const TARGET_A = person("target-a");
const TARGET_B = person("target-b");
const TARGET_C = person("target-c");
const TARGET_D = person("target-d");
const TARGET_E = person("target-e");

describe("approvals: requests and CEO decisions", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  const ids: Record<string, string> = {};

  const id = (key: string): string => {
    const value = ids[key];
    if (value === undefined) throw new Error(`unknown user ${key}`);
    return value;
  };
  const tokenOf = (who: { email: string; password: string }) => loginToken(app, who.email, who.password);
  const approval = (response: { json: () => unknown }) => approvalResponseSchema.parse(response.json()).approval;
  const auditActions = (entityId: string) =>
    db
      .query<{ action: string }>("SELECT action FROM audit_events WHERE entity_id = $1 ORDER BY occurred_at, id", [entityId])
      .then((rows) => rows.map((row) => row.action));

  const request = (token: string, payload: object) => call(app, { method: "POST", url: "/api/v1/approvals", token, payload });
  const roleChange = (target: string, newRole: string) => ({
    type: "user.role_change",
    targetUserId: target,
    payload: { newRole },
    reason: "Responsibilities changed",
  });
  const deactivation = (target: string) => ({
    type: "user.deactivate",
    targetUserId: target,
    payload: {},
    reason: "Left the company",
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    ids["ceo"] = (await createSuperAdmin(db.migrator)).userId;
    ids["cfo"] = await createUser(db.migrator, { ...CFO, role: "cfo" });
    ids["cgo"] = await createUser(db.migrator, { ...CGO, role: "cgo" });
    ids["employee"] = await createUser(db.migrator, { ...EMPLOYEE, role: "employee" });
    for (const [key, who] of [
      ["a", TARGET_A],
      ["b", TARGET_B],
      ["c", TARGET_C],
      ["d", TARGET_D],
      ["e", TARGET_E],
    ] as const) {
      ids[key] = await createUser(db.migrator, { ...who, role: "employee" });
    }
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

  it("records a CFO's role-change request as pending, audited without free text", async () => {
    const response = await request(await tokenOf(CFO), roleChange(id("a"), "founder"));
    expect(response.statusCode).toBe(201);
    const created = approval(response);
    expect(created).toMatchObject({ status: "pending", requestedBy: id("cfo"), decidedBy: null, decidedAt: null });

    const audits = await db.query<{ actor_user_id: string; after: unknown }>(
      "SELECT actor_user_id, after FROM audit_events WHERE action = 'approval.requested' AND entity_id = $1",
      [created.id],
    );
    expect(audits).toEqual([
      {
        actor_user_id: id("cfo"),
        after: { type: "user.role_change", status: "pending", targetUserId: id("a"), newRole: "founder" },
      },
    ]);
  });

  it("refuses requests from employees, about yourself, about the CEO, and duplicates", async () => {
    expect((await request(await tokenOf(EMPLOYEE), deactivation(id("b")))).statusCode).toBe(403);

    const cfo = await tokenOf(CFO);
    expect((await request(cfo, deactivation(id("cfo")))).statusCode).toBe(403);
    expect((await request(cfo, deactivation(id("ceo")))).statusCode).toBe(403);
    expect((await request(cfo, roleChange(id("ceo"), "cfo"))).statusCode).toBe(403);
    expect((await request(cfo, roleChange(id("a"), "founder"))).statusCode).toBe(409);
  });

  it("shows requesters only their own requests (others are 404) and the CEO everything", async () => {
    const cgoRequest = approval(await request(await tokenOf(CGO), deactivation(id("b"))));

    const cfo = await tokenOf(CFO);
    const cfoList = approvalPageSchema.parse((await call(app, { method: "GET", url: "/api/v1/approvals", token: cfo })).json());
    expect(cfoList.items.length).toBeGreaterThan(0);
    expect(cfoList.items.every((item) => item.requestedBy === id("cfo"))).toBe(true);

    expect((await call(app, { method: "POST", url: `/api/v1/approvals/${cgoRequest.id}/cancel`, token: cfo })).statusCode).toBe(404);
    expect((await call(app, { method: "POST", url: `/api/v1/approvals/${cgoRequest.id}/approve`, token: cfo })).statusCode).toBe(403);

    const ceoList = approvalPageSchema.parse(
      (await call(app, { method: "GET", url: "/api/v1/approvals?status=pending", token: await tokenOf(SUPER_ADMIN) })).json(),
    );
    const requesters = new Set(ceoList.items.map((item) => item.requestedBy));
    expect(requesters).toEqual(new Set([id("cfo"), id("cgo")]));
  });

  it("CEO approval changes the role, revokes the target's sessions with attendance, and audits", async () => {
    const targetToken = await tokenOf(TARGET_A);
    const ceo = await tokenOf(SUPER_ADMIN);
    const pending = approvalPageSchema
      .parse((await call(app, { method: "GET", url: "/api/v1/approvals?status=pending", token: ceo })).json())
      .items.find((item) => item.targetUserId === id("a"));
    if (!pending) throw new Error("pending request for target A not found");

    const response = await call(app, {
      method: "POST",
      url: `/api/v1/approvals/${pending.id}/approve`,
      token: ceo,
      payload: { note: "Agreed" },
    });
    expect(response.statusCode).toBe(200);
    expect(approval(response)).toMatchObject({ status: "approved", decidedBy: id("ceo"), decisionNote: "Agreed" });

    const [user] = await db.query<{ role: string; status: string }>("SELECT role, status FROM users WHERE id = $1", [id("a")]);
    expect(user).toEqual({ role: "founder", status: "active" });
    expect((await getMe(app, targetToken)).statusCode).toBe(401);

    const ended = await db.query<{ end_reason: string; attendance_matches: boolean }>(
      `SELECT s.end_reason, a.occurred_at = s.ended_at AS attendance_matches
       FROM sessions s JOIN attendance_events a ON a.session_id = s.id AND a.kind = 'session_end'
       WHERE s.user_id = $1`,
      [id("a")],
    );
    expect(ended).toEqual([{ end_reason: "revoked", attendance_matches: true }]);

    expect(await auditActions(pending.id)).toEqual(["approval.requested", "approval.approved"]);
    const [roleAudit] = await db.query<{ before: unknown; after: unknown }>(
      "SELECT before, after FROM audit_events WHERE action = 'user.role_changed' AND entity_id = $1",
      [id("a")],
    );
    expect(roleAudit).toEqual({
      before: { role: "employee", status: "active" },
      after: { role: "founder", status: "active", sessionsRevoked: 1 },
    });

    const again = await call(app, { method: "POST", url: `/api/v1/approvals/${pending.id}/approve`, token: ceo });
    expect(again.statusCode).toBe(409);
  });

  it("CEO rejection requires a note and is audited", async () => {
    const ceo = await tokenOf(SUPER_ADMIN);
    const pending = approvalPageSchema
      .parse((await call(app, { method: "GET", url: "/api/v1/approvals?status=pending", token: ceo })).json())
      .items.find((item) => item.targetUserId === id("b"));
    if (!pending) throw new Error("pending request for target B not found");

    const url = `/api/v1/approvals/${pending.id}/reject`;
    expect((await call(app, { method: "POST", url, token: ceo, payload: {} })).statusCode).toBe(400);
    const response = await call(app, { method: "POST", url, token: ceo, payload: { note: "Not needed" } });
    expect(response.statusCode).toBe(200);
    expect(approval(response)).toMatchObject({ status: "rejected", decidedBy: id("ceo"), decisionNote: "Not needed" });
    expect(await auditActions(pending.id)).toEqual(["approval.requested", "approval.rejected"]);

    const [user] = await db.query<{ status: string }>("SELECT status FROM users WHERE id = $1", [id("b")]);
    expect(user).toEqual({ status: "active" });
  });

  it("only the requester can cancel; the CEO gets 403", async () => {
    const cfo = await tokenOf(CFO);
    const created = approval(await request(cfo, deactivation(id("c"))));
    const url = `/api/v1/approvals/${created.id}/cancel`;

    expect((await call(app, { method: "POST", url, token: await tokenOf(SUPER_ADMIN) })).statusCode).toBe(403);
    const response = await call(app, { method: "POST", url, token: cfo });
    expect(response.statusCode).toBe(200);
    expect(approval(response)).toMatchObject({ status: "cancelled", decidedBy: null });
    expect(approval(response).decidedAt).not.toBeNull();
    expect(await auditActions(created.id)).toEqual(["approval.requested", "approval.cancelled"]);
  });

  it("a CEO's own deactivation request is approved and carried out immediately", async () => {
    const targetToken = await tokenOf(TARGET_D);
    const response = await request(await tokenOf(SUPER_ADMIN), deactivation(id("d")));
    expect(response.statusCode).toBe(201);
    const created = approval(response);
    expect(created).toMatchObject({ status: "approved", requestedBy: id("ceo"), decidedBy: id("ceo") });

    const [user] = await db.query<{ status: string; deactivated: boolean }>(
      "SELECT status, deactivated_at IS NOT NULL AS deactivated FROM users WHERE id = $1",
      [id("d")],
    );
    expect(user).toEqual({ status: "deactivated", deactivated: true });
    expect((await getMe(app, targetToken)).statusCode).toBe(401);
    expect((await postLogin(app, TARGET_D.email, TARGET_D.password)).statusCode).toBe(401);

    expect(await auditActions(created.id)).toEqual(["approval.requested", "approval.approved"]);
    expect(await auditActions(id("d"))).toEqual(["user.deactivated"]);
  });

  it("re-checks the target at approval: a change that no longer applies is refused and stays pending", async () => {
    const pending = approval(await request(await tokenOf(CFO), roleChange(id("e"), "contractor")));
    const ceo = await tokenOf(SUPER_ADMIN);
    expect((await request(ceo, deactivation(id("e")))).statusCode).toBe(201);

    const auditsBefore = await auditActions(pending.id);
    const response = await call(app, { method: "POST", url: `/api/v1/approvals/${pending.id}/approve`, token: ceo });
    expect(response.statusCode).toBe(409);

    const [row] = await db.query<{ status: string }>("SELECT status FROM approval_requests WHERE id = $1", [pending.id]);
    expect(row).toEqual({ status: "pending" });
    expect(await auditActions(pending.id)).toEqual(auditsBefore);
    const [user] = await db.query<{ role: string }>("SELECT role FROM users WHERE id = $1", [id("e")]);
    expect(user).toEqual({ role: "employee" });
  });
});
