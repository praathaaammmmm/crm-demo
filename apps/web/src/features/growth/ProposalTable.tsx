import { formatInr } from "@crm/contracts/growth-leads";
import type { Proposal } from "@crm/contracts/growth-proposals";
import Link from "next/link";
import { DataTable, type Column } from "../../components/DataTable";
import styles from "./Growth.module.css";
import { ProposalStatusPill } from "./ProposalStatusPill";

/** Proposals in API order; filtering stays server-side. */
export function ProposalTable({ proposals, nameOf }: { proposals: Proposal[]; nameOf: (id: string) => string }) {
  const columns: Column<Proposal>[] = [
    {
      key: "lead",
      header: "Lead",
      render: (proposal) => (
        <Link href={`/growth/leads/${proposal.leadId}`} className={styles.titleLink}>
          {proposal.leadName}
        </Link>
      ),
    },
    { key: "owner", header: "Owner", render: (proposal) => nameOf(proposal.ownerId) },
    { key: "amount", header: "Amount", render: (proposal) => formatInr(proposal.amountMinor) },
    { key: "validUntil", header: "Valid until", render: (proposal) => proposal.validUntil },
    { key: "status", header: "Status", render: (proposal) => <ProposalStatusPill status={proposal.status} /> },
  ];
  return <DataTable caption="Proposals" columns={columns} rows={proposals} rowKey={(proposal) => proposal.id} />;
}
