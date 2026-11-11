import type { Approval } from "@crm/contracts/approvals";
import { DataTable, type Column } from "../../components/DataTable";
import { isRole, roleLabel } from "../../lib/navigation";
import { ApprovalActions } from "./ApprovalActions";
import styles from "./Approvals.module.css";

const STATUS_LABELS: Record<Approval["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** Unambiguous for every viewer: always UTC. */
const formatTime = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

function describe(approval: Approval): string {
  if (approval.type === "user.deactivate") return "Deactivate user";
  const newRole = approval.payload["newRole"];
  return isRole(newRole) ? `Change role to ${roleLabel(newRole)}` : "Change role";
}

export function ApprovalList({
  approvals,
  names,
  viewerId,
  viewerCanDecide,
}: {
  approvals: Approval[];
  names: ReadonlyMap<string, string>;
  viewerId: string;
  viewerCanDecide: boolean;
}) {
  const nameOf = (id: string | null) => (id === null ? "—" : (names.get(id) ?? "Unknown user"));
  const columns: Column<Approval>[] = [
    {
      key: "request",
      header: "Request",
      render: (a) => (
        <>
          <div>{describe(a)}</div>
          <div className={styles.muted}>For {nameOf(a.targetUserId)}</div>
        </>
      ),
    },
    { key: "reason", header: "Reason", render: (a) => a.reason },
    {
      key: "requested",
      header: "Requested",
      render: (a) => (
        <>
          <div>{nameOf(a.requestedBy)}</div>
          <div className={styles.muted}>{formatTime(a.requestedAt)}</div>
        </>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (a) => (
        <>
          <div className={styles.status}>{STATUS_LABELS[a.status]}</div>
          {a.decidedAt ? <div className={styles.muted}>{formatTime(a.decidedAt)}</div> : null}
          {a.decisionNote ? <div className={styles.muted}>{a.decisionNote}</div> : null}
        </>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (a) =>
        a.status === "pending" ? (
          <ApprovalActions
            approvalId={a.id}
            canDecide={viewerCanDecide}
            canCancel={a.requestedBy === viewerId}
          />
        ) : null,
    },
  ];
  return <DataTable caption="Approval requests" columns={columns} rows={approvals} rowKey={(a) => a.id} />;
}
