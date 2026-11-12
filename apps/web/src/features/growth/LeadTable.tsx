import { formatInr, type Lead } from "@crm/contracts/growth-leads";
import Link from "next/link";
import { DataTable, type Column } from "../../components/DataTable";
import styles from "./Growth.module.css";
import { OverdueBadge } from "./OverdueBadge";
import { ArchivedBadge, OwnerFlag } from "./OwnerFlag";
import { StagePill } from "./StagePill";

/** Leads in API order. */
export function LeadTable({ leads, nameOf, companyOf }: { leads: Lead[]; nameOf: (id: string) => string; companyOf: (id: string | null) => string }) {
  const columns: Column<Lead>[] = [
    {
      key: "name",
      header: "Lead",
      render: (lead) => (
        <Link href={`/growth/leads/${lead.id}`} className={styles.titleLink}>
          {lead.name}
        </Link>
      ),
    },
    { key: "company", header: "Company", render: (lead) => <span className={styles.muted}>{companyOf(lead.companyId)}</span> },
    {
      key: "stage",
      header: "Stage",
      render: (lead) => (
        <span className={styles.actions}>
          <StagePill stage={lead.stage} />
          {lead.archivedAt ? <ArchivedBadge /> : null}
        </span>
      ),
    },
    {
      key: "followUp",
      header: "Next follow-up",
      render: (lead) => (
        <span className={styles.actions}>
          {lead.nextFollowUpOn ?? "—"}
          <OverdueBadge overdue={lead.overdue} />
        </span>
      ),
    },
    { key: "value", header: "Value", render: (lead) => (lead.estimatedValueMinor === null ? "—" : formatInr(lead.estimatedValueMinor)) },
    {
      key: "owner",
      header: "Owner",
      render: (lead) => (
        <span className={styles.actions}>
          {nameOf(lead.ownerId)}
          <OwnerFlag flagged={lead.ownerFlagged} />
        </span>
      ),
    },
  ];
  return <DataTable caption="Leads" columns={columns} rows={leads} rowKey={(lead) => lead.id} />;
}
