import type { Company } from "@crm/contracts/growth";
import Link from "next/link";
import { DataTable, type Column } from "../../components/DataTable";
import styles from "./Growth.module.css";
import { ArchivedBadge, OwnerFlag } from "./OwnerFlag";

/** Companies in API order (name, then id). */
export function CompanyTable({ companies, nameOf }: { companies: Company[]; nameOf: (id: string) => string }) {
  const columns: Column<Company>[] = [
    {
      key: "name",
      header: "Company",
      render: (company) => (
        <Link href={`/growth/companies/${company.id}`} className={styles.titleLink}>
          {company.name}
        </Link>
      ),
    },
    { key: "industry", header: "Industry", render: (company) => <span className={styles.muted}>{company.industry ?? "—"}</span> },
    { key: "contacts", header: "Contacts", render: (company) => String(company.contactCount) },
    {
      key: "owner",
      header: "Owner",
      render: (company) => (
        <span className={styles.actions}>
          {nameOf(company.ownerId)}
          <OwnerFlag flagged={company.ownerFlagged} />
          {company.archivedAt ? <ArchivedBadge /> : null}
        </span>
      ),
    },
  ];
  return <DataTable caption="Companies" columns={columns} rows={companies} rowKey={(company) => company.id} />;
}
