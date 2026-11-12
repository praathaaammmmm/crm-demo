import {
  canCreateVersion,
  isActiveProposal,
  type ProposalDetail,
  type ProposalStatus,
} from "@crm/contracts/growth-proposals";
import { type GrowthStage } from "@crm/contracts/growth-leads";
import { can, type Role } from "@crm/permissions";

/** UI visibility only. The proposal API and database repeat every workflow check. */
export function proposalActionsFor(input: {
  role: Role;
  lead: { stage: GrowthStage; archivedAt: string | null };
  detail: ProposalDetail;
}) {
  const status: ProposalStatus | null = input.detail.proposal?.status ?? null;
  const writeableLead = input.lead.archivedAt === null && input.lead.stage !== "won" && input.lead.stage !== "lost";
  const manage = can({ role: input.role }, "growth:manage") && writeableLead;
  const approve = can({ role: input.role }, "growth:approve_proposals") && writeableLead;
  return {
    canCreateVersion: manage && canCreateVersion(status),
    canSubmit: manage && status === "draft",
    canSend: manage && status === "approved",
    canWithdraw: manage && isActiveProposal(status),
    canAccept: manage && status === "sent",
    canMarkWon: manage && status === "accepted",
    canApprove: approve && status === "pending_approval",
    canReject: approve && status === "pending_approval",
    canConfirm: approve && status === "acceptance_pending",
    canRefuse: approve && status === "acceptance_pending",
    waiting: status === "pending_approval" || status === "acceptance_pending",
    readOnly: !writeableLead || status === "won" || status === "superseded",
  };
}
