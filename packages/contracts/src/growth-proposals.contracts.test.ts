import { describe, expect, it } from "vitest";
import {
  acceptanceRequestSchema,
  canCreateVersion,
  canTransition,
  confirmationRequestSchema,
  createVersionRequestSchema,
  isActiveProposal,
  isLate,
  needsConfirmation,
  PROPOSAL_STATUSES,
  refusalRequestSchema,
  markWonRequestSchema,
  versionNoteRequestSchema,
} from "./growth-proposals.js";

const version = { documentUrl: "https://docs.example.test/p1", amountMinor: 500_000, validUntil: "2026-12-31", summary: " Scope ", expectedVersionNo: null };

describe("proposal workflow", () => {
  it("allows each user transition only from its listed statuses", () => {
    for (const status of PROPOSAL_STATUSES) {
      expect(canTransition("submit", status)).toBe(status === "draft");
      expect(canTransition("approve", status)).toBe(status === "pending_approval");
      expect(canTransition("reject", status)).toBe(status === "pending_approval");
      expect(canTransition("send", status)).toBe(status === "approved");
    }
    expect(canTransition("submit", null)).toBe(false);
  });

  it("withdraws from every active status but never from final ones", () => {
    for (const status of ["draft", "pending_approval", "approved", "sent", "acceptance_pending", "accepted"] as const) {
      expect(canTransition("withdraw", status)).toBe(true);
      expect(isActiveProposal(status)).toBe(true);
    }
    for (const status of ["rejected", "withdrawn", "acceptance_refused", "superseded", "won"] as const) {
      expect(canTransition("withdraw", status)).toBe(false);
      expect(isActiveProposal(status)).toBe(false);
    }
  });

  it("allows a new version with no proposal, over a draft, or after rejection, withdrawal or refusal", () => {
    expect(canCreateVersion(null)).toBe(true);
    for (const status of PROPOSAL_STATUSES) {
      expect(canCreateVersion(status)).toBe(["draft", "rejected", "withdrawn", "acceptance_refused"].includes(status));
    }
  });

  it("treats acceptance after validity, or recorded after validity, as late; verbal or late needs confirmation", () => {
    expect(isLate("2026-12-31", "2026-12-31", "2026-12-31")).toBe(false);
    expect(isLate("2026-12-31", "2027-01-01", "2027-01-01")).toBe(true);
    expect(isLate("2026-12-31", "2026-12-30", "2027-01-02")).toBe(true);
    expect(needsConfirmation("signed_document", false)).toBe(false);
    expect(needsConfirmation("verbal", false)).toBe(true);
    expect(needsConfirmation("email_confirmation", true)).toBe(true);
  });
});

describe("proposal requests", () => {
  it("accepts a valid version and trims the summary; refuses http links, ids in the body and bad amounts", () => {
    expect(createVersionRequestSchema.parse(version).summary).toBe("Scope");
    expect(createVersionRequestSchema.safeParse({ ...version, documentUrl: "http://docs.example.test" }).success).toBe(false);
    expect(createVersionRequestSchema.safeParse({ ...version, proposalId: "11111111-1111-7111-8111-111111111111" }).success).toBe(false);
    expect(createVersionRequestSchema.safeParse({ ...version, leadId: "11111111-1111-7111-8111-111111111111" }).success).toBe(false);
    expect(createVersionRequestSchema.safeParse({ ...version, amountMinor: 100_000_000_001 }).success).toBe(false);
    expect(createVersionRequestSchema.safeParse({ ...version, expectedVersionNo: 0 }).success).toBe(false);
  });

  it("needs evidence for non-verbal acceptance and a note for verbal acceptance", () => {
    const base = { versionNo: 1, acceptedOn: "2026-11-12" };
    expect(acceptanceRequestSchema.safeParse({ ...base, method: "signed_document" }).success).toBe(false);
    expect(acceptanceRequestSchema.safeParse({ ...base, method: "signed_document", evidenceUrl: "https://e.example.test/s" }).success).toBe(true);
    expect(acceptanceRequestSchema.safeParse({ ...base, method: "email_confirmation", evidenceUrl: "http://e.example.test" }).success).toBe(false);
    expect(acceptanceRequestSchema.safeParse({ ...base, method: "verbal" }).success).toBe(false);
    expect(acceptanceRequestSchema.safeParse({ ...base, method: "verbal", note: "Agreed on call" }).success).toBe(true);
  });

  it("requires a non-blank note to reject, withdraw or refuse", () => {
    expect(versionNoteRequestSchema.safeParse({ versionNo: 1, note: "  " }).success).toBe(false);
    expect(versionNoteRequestSchema.safeParse({ versionNo: 1 }).success).toBe(false);
    expect(versionNoteRequestSchema.parse({ versionNo: 2, note: " Too high " }).note).toBe("Too high");
  });

  it("rejects route-owned ids, cache fields and unknown keys in every mutable body", () => {
    expect(confirmationRequestSchema.safeParse({ versionNo: 1, proposalId: "11111111-1111-7111-8111-111111111111" }).success).toBe(false);
    expect(refusalRequestSchema.safeParse({ versionNo: 1, note: "No", leadId: "11111111-1111-7111-8111-111111111111" }).success).toBe(false);
    expect(markWonRequestSchema.safeParse({ versionNo: 1, status: "won" }).success).toBe(false);
    expect(acceptanceRequestSchema.safeParse({ versionNo: 1, method: "verbal", note: "Agreed", late: false }).success).toBe(false);
    expect(createVersionRequestSchema.safeParse({ ...version, ownerId: "11111111-1111-7111-8111-111111111111" }).success).toBe(false);
  });
});
