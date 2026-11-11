import type { Task } from "@crm/contracts/tasks";
import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "../../components/Avatar";
import { DataTable, type Column } from "../../components/DataTable";
import { DueDate } from "./DueDate";
import { PriorityMarker } from "./PriorityMarker";
import { StatusPill } from "./StatusPill";
import styles from "./Tasks.module.css";

/** The List view: the same data as the board, in API order. */
export function TaskTable({
  tasks,
  nameOf,
  projectNameOf,
  showAssignee = true,
  showProject = true,
  caption = "Tasks",
  actions,
}: {
  tasks: Task[];
  nameOf: (id: string) => string;
  projectNameOf: (id: string) => string;
  showAssignee?: boolean;
  showProject?: boolean;
  caption?: string;
  /** Optional per-row actions column (used by the review queue). */
  actions?: (task: Task) => ReactNode;
}) {
  const columns: Column<Task>[] = [
    {
      key: "title",
      header: "Task",
      render: (task) => (
        <Link href={`/tasks/${task.id}`} className={styles.titleLink}>
          {task.title}
        </Link>
      ),
    },
    ...(showProject
      ? [{ key: "project", header: "Project", render: (task: Task) => <span className={styles.cellMuted}>{projectNameOf(task.projectId)}</span> }]
      : []),
    ...(showAssignee
      ? [
          {
            key: "assignee",
            header: "Assignee",
            render: (task: Task) => (
              <span className={styles.person}>
                <Avatar name={nameOf(task.assigneeId)} size="xs" />
                {nameOf(task.assigneeId)}
              </span>
            ),
          },
        ]
      : []),
    { key: "priority", header: "Priority", render: (task) => <PriorityMarker priority={task.priority} showLabel /> },
    { key: "status", header: "Status", render: (task) => <StatusPill status={task.status} /> },
    { key: "due", header: "Due", render: (task) => <DueDate date={task.dueDate} overdue={task.overdue} /> },
    ...(actions ? [{ key: "actions", header: "Actions", render: actions }] : []),
  ];
  return <DataTable caption={caption} columns={columns} rows={tasks} rowKey={(task) => task.id} />;
}
