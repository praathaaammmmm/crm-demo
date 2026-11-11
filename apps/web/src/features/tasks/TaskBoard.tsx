import type { Task } from "@crm/contracts/tasks";
import type { ReactNode } from "react";
import { groupByStatus } from "../../lib/task-view";
import styles from "./Board.module.css";
import { TaskColumn } from "./TaskColumn";

/**
 * Kanban columns in workflow order. Read-only: no drag-and-drop, because status changes are
 * role-restricted; cards open the task.
 */
export function TaskBoard({
  tasks,
  nameOf,
  todoAddAction,
}: {
  tasks: Task[];
  nameOf: (id: string) => string;
  todoAddAction?: ReactNode;
}) {
  return (
    <div className={styles.board} role="region" aria-label="Task board" tabIndex={0}>
      {groupByStatus(tasks).map((column) => (
        <TaskColumn
          key={column.status}
          status={column.status}
          tasks={column.tasks}
          nameOf={nameOf}
          {...(column.status === "todo" && todoAddAction ? { addAction: todoAddAction } : {})}
        />
      ))}
    </div>
  );
}
