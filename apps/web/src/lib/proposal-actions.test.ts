import {
  PROPOSAL_STATUSES,
  PROPOSAL_STATUS_LABELS,
  canCreateVersion,
  canTransition,
  isActiveProposal,
  type ProposalDetail,
  type ProposalStatus,
} from "@crm/contracts/growth-proposals";
import type { Role } from "@crm/permissions";
import { describe, expect, it } from "vitest";
import { proposalActionsFor } from "./proposal-actions";

const proposalFor = (status: ProposalStatus | null): ProposalDetail => ({
  proposal:
    status === null
      ? null
      : {
          id: "11111111-1111-7111-8111-111111111111",
          leadId: "22222222-2222-7222-8222-222222222222",
          leadName: "Proposal test lead",
          ownerId: "33333333-3333-7333-8333-333333333333",
          status,
          currentVersionId: "44444444-4444-7444-8444-444444444444",
          currentVersionNo: 1,
          amountMinor: 500_000,
          currency: "INR",
          validUntil: "2099-12-31",
          createdAt: "2099-01-01T00:00:00.000Z",
          updatedAt: "2099-01-01T00:00:00.000Z",
        },
  versions: [],
  events: [],
  acceptances: [],
});

const actions = (role: Role, status: ProposalStatus | null, lead: { stage: "new" | "lost" | "won"; archivedAt: string | null } = { stage: "new", archivedAt: null }) =>
  proposalActionsFor({ role, lead, detail: proposalFor(status) });

const mutationKeys = [
  "canCreateVersion",
  "canSubmit",
  "canSend",
  "canWithdraw",
  "canAccept",
  "canMarkWon",
  "canApprove",
  "canReject",
  "canConfirm",
  "canRefuse",
] as const;

describe("proposalActionsFor", () => {
  it("shows CGO actions only for their active proposal status", () => {
    expect(actions("cgo", null)).toMatchObject({ canCreateVersion: true });
    expect(actions("cgo", "draft")).toMatchObject({ canSubmit: true, canWithdraw: true });
    expect(actions("cgo", "approved")).toMatchObject({ canSend: true, canWithdraw: true });
    expect(actions("cgo", "sent")).toMatchObject({ canAccept: true, canWithdraw: true });
    expect(actions("cgo", "acceptance_pending")).toMatchObject({ canWithdraw: true, waiting: true });
    expect(actions("cgo", "accepted")).toMatchObject({ canMarkWon: true, canWithdraw: true });
  });

  it("shows CEO actions only for pending approval and confirmation states", () => {
    expect(actions("ceo_cto", "pending_approval")).toMatchObject({ canApprove: true, canReject: true, waiting: true });
    expect(actions("ceo_cto", "acceptance_pending")).toMatchObject({ canConfirm: true, canRefuse: true, waiting: true });
    for (const status of PROPOSAL_STATUSES.filter((status) => status !== "pending_approval" && status !== "acceptance_pending")) {
      const current = actions("ceo_cto", status);
      expect(current.canApprove || current.canReject || current.canConfirm || current.canRefuse).toBe(false);
    }
  });

  it("does not show proposal mutation actions to unrelated roles", () => {
    for (const role of ["cfo", "cmo", "vp_engineering_quality", "founder", "employee", "intern", "contractor"] as const) {
      const current = actions(role, "pending_approval");
      for (const key of mutationKeys) expect(current[key]).toBe(false);
    }
  });

  it("allows only a new version from rejected, withdrawn, and acceptance-refused states", () => {
    for (const status of ["rejected", "withdrawn", "acceptance_refused"] as const) {
      const current = actions("cgo", status);
      expect(current.canCreateVersion).toBe(true);
      for (const key of mutationKeys.filter((key) => key !== "canCreateVersion")) expect(current[key]).toBe(false);
    }
  });

  it("allows mark won only from accepted, never from a confirmation-pending proposal", () => {
    expect(actions("cgo", "accepted").canMarkWon).toBe(true);
    const pending = actions("cgo", "acceptance_pending");
    expect(pending.canMarkWon).toBe(false);
    expect(pending.waiting).toBe(true);
  });

  it("exposes no mutation actions for won, archived, or frozen lead states", () => {
    const states = [
      actions("cgo", "won"),
      actions("cgo", "accepted", { stage: "new", archivedAt: "2099-01-01T00:00:00.000Z" }),
      actions("cgo", "accepted", { stage: "won", archivedAt: null }),
      actions("cgo", "accepted", { stage: "lost", archivedAt: null }),
    ];
    for (const current of states) {
      for (const key of mutationKeys) expect(current[key]).toBe(false);
      expect(current.readOnly).toBe(true);
    }
  });

  it("keeps status labels and workflow helpers aligned with the approved transitions", () => {
    expect(Object.keys(PROPOSAL_STATUS_LABELS).sort()).toEqual([...PROPOSAL_STATUSES].sort());
    expect(PROPOSAL_STATUS_LABELS.acceptance_pending).toBe("Awaiting CEO confirmation");
    expect(canCreateVersion(null)).toBe(true);
    expect(canCreateVersion("rejected")).toBe(true);
    expect(canCreateVersion("sent")).toBe(false);
    expect(isActiveProposal("accepted")).toBe(true);
    expect(isActiveProposal("withdrawn")).toBe(false);
    expect(canTransition("submit", "draft")).toBe(true);
    expect(canTransition("approve", "pending_approval")).toBe(true);
    expect(canTransition("send", "approved")).toBe(true);
    expect(canTransition("withdraw", "accepted")).toBe(true);
    expect(canTransition("approve", "draft")).toBe(false);
  });
});
