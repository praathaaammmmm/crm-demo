import { PROPOSAL_STATUS_LABELS, type ProposalStatus } from "@crm/contracts/growth-proposals";
import styles from "./Growth.module.css";

const TONE: Record<ProposalStatus, keyof typeof styles> = {
  draft: "proposalDraft",
  pending_approval: "proposalWaiting",
  approved: "proposalApproved",
  rejected: "proposalStopped",
  sent: "proposalSent",
  acceptance_pending: "proposalWaiting",
  accepted: "proposalAccepted",
  acceptance_refused: "proposalStopped",
  withdrawn: "proposalStopped",
  superseded: "proposalStopped",
  won: "proposalWon",
};

const required = (value: string | undefined, mapping: string): string => {
  if (value === undefined) throw new Error(`Missing proposal status ${mapping}`);
  return value;
};

export function ProposalStatusPill({ status }: { status: ProposalStatus }) {
  const label = required(PROPOSAL_STATUS_LABELS[status], `label for ${status}`);
  const tone = required(styles[TONE[status]], `class for ${status}`);
  return <span className={[required(styles.badge, "badge class"), tone].join(" ")}>{label}</span>;
}
