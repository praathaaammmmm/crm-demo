import type { Project } from "@crm/contracts/projects";
import Link from "next/link";
import { DataTable, type Column } from "../../components/DataTable";
import { formatDate } from "../tasks/DueDate";
import styles from "./Projects.module.css";

export function ProjectTable({ projects }: { projects: Project[] }) {
  const columns: Column<Project>[] = [
    {
      key: "name",
      header: "Project",
      render: (project) => (
        <Link href={`/projects/${project.id}`} className={styles.name}>
          {project.name}
        </Link>
      ),
    },
    {
      key: "description",
      header: "Description",
      render: (project) => <span className={styles.description}>{project.description || "—"}</span>,
    },
    {
      key: "created",
      header: "Created",
      render: (project) => <span className={styles.date}>{formatDate(project.createdAt.slice(0, 10))}</span>,
    },
  ];
  return <DataTable caption="Projects" columns={columns} rows={projects} rowKey={(project) => project.id} />;
}
