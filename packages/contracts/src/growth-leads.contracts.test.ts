import { describe, expect, it } from "vitest";
import {
  canMoveStage,
  canReopen,
  createLeadRequestSchema,
  formatInr,
  GROWTH_STAGES,
  isOverdue,
  logActivityRequestSchema,
  OPEN_STAGES,
  stageMoveRequestSchema,
} from "./growth-leads.js";

const ID = "11111111-1111-7111-8111-111111111111";

describe("growth stage workflow", () => {
  it("moves between different open stages and to lost, never to won or out of a final stage", () => {
    for (const from of OPEN_STAGES) {
      for (const to of GROWTH_STAGES) {
        expect(canMoveStage(from, to)).toBe(from !== to && to !== "won");
      }
    }
    for (const to of GROWTH_STAGES) {
      expect(canMoveStage("lost", to)).toBe(false);
      expect(canMoveStage("won", to)).toBe(false);
    }
  });

  it("reopens only lost leads, and only to an open stage", () => {
    expect(OPEN_STAGES.every((to) => canReopen("lost", to))).toBe(true);
    expect(canReopen("lost", "won")).toBe(false);
    expect(canReopen("lost", "lost")).toBe(false);
    expect(canReopen("qualified", "new")).toBe(false);
  });

  it("requires a reason and a note to mark a lead lost", () => {
    expect(stageMoveRequestSchema.safeParse({ to: "lost" }).success).toBe(false);
    expect(stageMoveRequestSchema.safeParse({ to: "lost", lostReason: "price" }).success).toBe(false);
    expect(stageMoveRequestSchema.safeParse({ to: "lost", lostReason: "price", note: "  " }).success).toBe(false);
    expect(stageMoveRequestSchema.safeParse({ to: "lost", lostReason: "price", note: "Too expensive" }).success).toBe(true);
    expect(stageMoveRequestSchema.safeParse({ to: "contacted" }).success).toBe(true);
  });
});

describe("overdue", () => {
  const lead = { stage: "contacted" as const, nextFollowUpOn: "2026-11-12", archivedAt: null };
  it("starts the day after the follow-up date, for open, non-archived leads only", () => {
    expect(isOverdue(lead, "2026-11-12")).toBe(false);
    expect(isOverdue(lead, "2026-11-13")).toBe(true);
    expect(isOverdue({ ...lead, stage: "lost" }, "2026-11-13")).toBe(false);
    expect(isOverdue({ ...lead, archivedAt: "2026-11-12T00:00:00.000Z" }, "2026-11-13")).toBe(false);
    expect(isOverdue({ ...lead, nextFollowUpOn: null }, "2026-11-13")).toBe(false);
  });
});

describe("lead and activity contracts", () => {
  it("normalises lead names and bounds INR values", () => {
    expect(createLeadRequestSchema.parse({ name: "  Big   Deal ", source: "referral" }).name).toBe("Big Deal");
    expect(createLeadRequestSchema.safeParse({ name: "X", source: "referral", estimatedValueMinor: -1 }).success).toBe(false);
    expect(createLeadRequestSchema.safeParse({ name: "X", source: "referral", estimatedValueMinor: 100_000_000_001 }).success).toBe(false);
    expect(createLeadRequestSchema.safeParse({ name: "X", source: "referral", primaryContactId: ID }).success).toBe(false);
    expect(formatInr(123_456_700)).toBe("₹12,34,567");
  });

  it("requires a contact for every outbound activity, including kind other", () => {
    const base = { leadId: ID, occurredAt: "2026-11-12T10:00:00.000Z", summary: "Spoke" };
    for (const kind of ["linkedin_dm", "email", "call", "meeting", "follow_up", "other"] as const) {
      expect(logActivityRequestSchema.safeParse({ ...base, kind, direction: "outbound" }).success).toBe(false);
      expect(logActivityRequestSchema.safeParse({ ...base, kind, direction: "outbound", contactId: ID }).success).toBe(true);
    }
    expect(logActivityRequestSchema.safeParse({ ...base, kind: "other", direction: "inbound" }).success).toBe(true);
  });

  it("needs a link, an https proof link if any, and a lead for a follow-up date", () => {
    const base = { kind: "email", direction: "inbound", occurredAt: "2026-11-12T10:00:00.000Z", summary: "Reply" } as const;
    expect(logActivityRequestSchema.safeParse(base).success).toBe(false);
    expect(logActivityRequestSchema.safeParse({ ...base, companyId: ID, proofUrl: "http://x.test" }).success).toBe(false);
    expect(logActivityRequestSchema.safeParse({ ...base, companyId: ID, nextFollowUpOn: "2026-11-20" }).success).toBe(false);
    expect(logActivityRequestSchema.safeParse({ ...base, leadId: ID, nextFollowUpOn: "2026-11-20" }).success).toBe(true);
  });
});
