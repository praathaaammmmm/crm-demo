import type { QualityProjectRow } from "@crm/contracts/quality";
import Link from "next/link";
import { DataTable, type Column } from "../../components/DataTable";
import styles from "./Quality.module.css";
import { ReadinessPill } from "./QualityPills";
import { SetReadinessDialog } from "./SetReadinessDialog";

const Count = ({ value }: { value: number }) => <span className={value === 0 ? styles.countZero : styles.count}>{String(value)}</span>;

/** Per-project readiness and blockers in API order. A project with no decision shows as Not ready. */
export function ReadinessTable({
  rows,
  canManage,
  caption = "Release readiness and blockers by project",
}: {
  rows: QualityProjectRow[];
  canManage: boolean;
  caption?: string;
}) {
  const columns: Column<QualityProjectRow>[] = [
    {
      key: "project",
      header: "Project",
      render: (row) => (
        <Link href={`/projects/${row.projectId}`} className={styles.titleLink}>
          {row.name}
        </Link>
      ),
    },
    {
      key: "readiness",
      header: "Readiness",
      render: (row) => (
        <span className={styles.readinessCell}>
          <ReadinessPill readiness={row.readiness} />
          <span className={styles.subtle}>{row.label ?? "No decision yet"}</span>
        </span>
      ),
    },
    { key: "critical", header: "Critical", render: (row) => <Count value={row.openCriticalDefects} /> },
    { key: "high", header: "High", render: (row) => <Count value={row.openHighDefects} /> },
    { key: "failed", header: "Failed checks", render: (row) => <Count value={row.failedQaChecks} /> },
    { key: "blocked", header: "Blocked checks", render: (row) => <Count value={row.blockedQaChecks} /> },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "Actions",
            render: (row: QualityProjectRow) => <SetReadinessDialog projectId={row.projectId} projectName={row.name} />,
          },
        ]
      : []),
  ];
  return <DataTable caption={caption} columns={columns} rows={rows} rowKey={(row) => row.projectId} />;
}
