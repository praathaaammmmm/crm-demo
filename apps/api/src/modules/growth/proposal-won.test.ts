import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, call, createSuperAdmin, createUser, dateFromToday, loginToken, SUPER_ADMIN } from "../../../test/helpers.js";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import { wonLeadsForConversion } from "./index.js";

describe("proposal won workflow", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  let cgoToken: string;
  let ceoToken: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    const cgoPassword = "Won-test-CGO-password-2026";
    await createSuperAdmin(db.migrator);
    await createUser(db.migrator, {
      email: "won-test-cgo@example.test",
      name: "Won Test CGO",
      password: cgoPassword,
      role: "cgo",
    });
    app = await buildTestApp(db.app);
    cgoToken = await loginToken(app, "won-test-cgo@example.test", cgoPassword);
    ceoToken = await loginToken(app, SUPER_ADMIN.email, SUPER_ADMIN.password);
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  const createSentProposal = async (amountMinor = 500_000) => {
    const lead = await call(app, { method: "POST", url: "/api/v1/growth/leads", token: cgoToken, payload: {
      name: "Won deal",
      source: "referral",
    } });
    expect(lead.statusCode).toBe(201);
    const leadId = lead.json<{ lead: { id: string } }>().lead.id;

    const version = await call(app, { method: "POST", url: `/api/v1/growth/leads/${leadId}/proposal/versions`, token: cgoToken, payload: {
      documentUrl: "https://example.com/proposal.pdf",
      amountMinor,
      validUntil: dateFromToday(30),
      summary: "Approved scope",
      expectedVersionNo: null,
    } });
    expect(version.statusCode).toBe(201);
    const proposal = version.json<{ proposal: { id: string; currentVersionNo: number; currentVersionId: string } }>().proposal;

    for (const [token, action] of [
      [cgoToken, "submit"],
      [ceoToken, "approve"],
      [cgoToken, "sent"],
    ] as const) {
      const response = await call(app, { method: "POST", url: `/api/v1/growth/proposals/${proposal.id}/${action}`, token, payload: {
        versionNo: proposal.currentVersionNo,
      } });
      expect(response.statusCode).toBe(200);
    }

    return { leadId, proposal };
  };

  const acceptSigned = async (proposal: { id: string; currentVersionNo: number }) => {
    const response = await call(app, { method: "POST", url: `/api/v1/growth/proposals/${proposal.id}/acceptance`, token: cgoToken, payload: {
      versionNo: proposal.currentVersionNo,
      method: "signed_document",
      evidenceUrl: "https://example.com/signed.pdf",
      acceptedOn: dateFromToday(0),
    } });
    expect(response.statusCode).toBe(200);
  };

  it("requires the current accepted version, stores the INR snapshot, and freezes the won lead", async () => {
    const { leadId, proposal } = await createSentProposal(987_654);

    const beforeAcceptance = await call(app, { method: "POST", url: `/api/v1/growth/leads/${leadId}/won`, token: cgoToken, payload: {
      versionNo: proposal.currentVersionNo,
    } });
    expect(beforeAcceptance.statusCode).toBe(409);

    await acceptSigned(proposal);
    const won = await call(app, { method: "POST", url: `/api/v1/growth/leads/${leadId}/won`, token: cgoToken, payload: {
      versionNo: proposal.currentVersionNo,
    } });
    expect(won.statusCode).toBe(200);

    const detail = await call(app, { method: "GET", url: `/api/v1/growth/leads/${leadId}`, token: cgoToken });
    expect(detail.statusCode).toBe(200);
    const wonDetail = detail.json<{
      lead: { stage: string; wonAmountMinor: number | null; wonCurrency: string | null; wonVersionId: string | null; wonAt: string | null };
      history: { fromStage: string; toStage: string }[];
    }>();
    const lead = wonDetail.lead;
    expect(lead).toMatchObject({
      stage: "won",
      wonAmountMinor: 987_654,
      wonCurrency: "INR",
      wonVersionId: proposal.currentVersionId,
    });
    expect(lead.wonAt).not.toBeNull();
    expect(wonDetail.history).toEqual(expect.arrayContaining([expect.objectContaining({ fromStage: "new", toStage: "won" })]));

    const frozen = await call(app, { method: "POST", url: `/api/v1/growth/leads/${leadId}/proposal/versions`, token: cgoToken, payload: {
      documentUrl: "https://example.com/revision.pdf",
      amountMinor: 1,
      validUntil: dateFromToday(30),
      summary: "Frozen lead revision",
      expectedVersionNo: proposal.currentVersionNo,
    } });
    expect(frozen.statusCode).toBe(409);
  });

  it("blocks won while a verbal acceptance is pending and after the CEO refuses it", async () => {
    const { leadId, proposal } = await createSentProposal();
    const acceptance = await call(app, { method: "POST", url: `/api/v1/growth/proposals/${proposal.id}/acceptance`, token: cgoToken, payload: {
      versionNo: proposal.currentVersionNo,
      method: "verbal",
      note: "Client accepted during the call",
      acceptedOn: dateFromToday(0),
    } });
    expect(acceptance.statusCode).toBe(200);

    const pending = await call(app, { method: "POST", url: `/api/v1/growth/leads/${leadId}/won`, token: cgoToken, payload: {
      versionNo: proposal.currentVersionNo,
    } });
    expect(pending.statusCode).toBe(409);

    const refused = await call(app, { method: "POST", url: `/api/v1/growth/proposals/${proposal.id}/refuse`, token: ceoToken, payload: {
      versionNo: proposal.currentVersionNo,
      note: "Written confirmation is required",
    } });
    expect(refused.statusCode).toBe(200);

    const afterRefusal = await call(app, { method: "POST", url: `/api/v1/growth/leads/${leadId}/won`, token: cgoToken, payload: {
      versionNo: proposal.currentVersionNo,
    } });
    expect(afterRefusal.statusCode).toBe(409);
  });

  it("returns only won leads from the conversion boundary in stable cursor order", async () => {
    const first = await createSentProposal(100_000);
    await acceptSigned(first.proposal);
    expect((await call(app, { method: "POST", url: `/api/v1/growth/leads/${first.leadId}/won`, token: cgoToken, payload: { versionNo: first.proposal.currentVersionNo } })).statusCode).toBe(200);

    const second = await createSentProposal(200_000);
    await acceptSigned(second.proposal);
    expect((await call(app, { method: "POST", url: `/api/v1/growth/leads/${second.leadId}/won`, token: cgoToken, payload: { versionNo: second.proposal.currentVersionNo } })).statusCode).toBe(200);

    const firstPage = await wonLeadsForConversion(db.app, undefined, 1);
    expect(firstPage).toHaveLength(1);
    expect(firstPage[0]?.leadId).toBe(first.leadId);
    const firstRow = firstPage[0];
    if (!firstRow?.wonAt) throw new Error("Won lead must have a won date");
    expect(firstRow.wonAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);

    const secondPage = await wonLeadsForConversion(db.app, { wonAt: firstRow.wonAt, id: firstRow.leadId }, 1);
    expect(secondPage).toHaveLength(1);
    expect(secondPage[0]).toMatchObject({
      leadId: second.leadId,
      amountMinor: 200_000,
      currency: "INR",
      proposalVersionId: second.proposal.currentVersionId,
    });
  });

  it("keeps the ordinary stage endpoint from moving a lead directly to won", async () => {
    const { leadId } = await createSentProposal();
    const response = await call(app, { method: "POST", url: `/api/v1/growth/leads/${leadId}/stage`, token: cgoToken, payload: { to: "won" } });
    expect(response.statusCode).toBe(409);
  });
});
