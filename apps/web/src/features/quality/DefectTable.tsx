import type { Defect } from "@crm/contracts/quality";
import Link from "next/link";
import { Avatar } from "../../components/Avatar";
import { DataTable, type Column } from "../../components/DataTable";
import { formatTimestamp } from "../tasks/TimelineEntry";
import styles from "./Quality.module.css";
import { DefectStatusPill, SeverityPill } from "./QualityPills";

/** Defects in API order; nothing is re-sorted here. */
export function DefectTable({
  defects,
  nameOf,
  projectNameOf,
  showAssignee = true,
  showProject = true,
  caption = "Defects",
}: {
  defects: Defect[];
  nameOf: (id: string) => string;
  projectNameOf: (id: string) => string;
  showAssignee?: boolean;
  showProject?: boolean;
  caption?: string;
}) {
  const columns: Column<Defect>[] = [
    {
      key: "title",
      header: "Defect",
      render: (defect) => (
        <Link href={`/defects/${defect.id}`} className={styles.titleLink}>
          {defect.title}
        </Link>
      ),
    },
    { key: "severity", header: "Severity", render: (defect) => <SeverityPill severity={defect.severity} /> },
    { key: "status", header: "Status", render: (defect) => <DefectStatusPill status={defect.status} /> },
    ...(showProject
      ? [{ key: "project", header: "Project", render: (defect: Defect) => <span className={styles.cellMuted}>{projectNameOf(defect.projectId)}</span> }]
      : []),
    ...(showAssignee
      ? [
          {
            key: "assignee",
            header: "Assignee",
            render: (defect: Defect) => (
              <span className={styles.itemMain}>
                <Avatar name={nameOf(defect.assigneeId)} size="xs" />
                {nameOf(defect.assigneeId)}
              </span>
            ),
          },
        ]
      : []),
    { key: "updated", header: "Updated", render: (defect) => <span className={styles.cellMuted}>{formatTimestamp(defect.updatedAt)}</span> },
  ];
  return <DataTable caption={caption} columns={columns} rows={defects} rowKey={(defect) => defect.id} />;
}
