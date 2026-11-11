import { statusLabel, type Task, type TaskStatus } from "@crm/contracts/tasks";
import type { ReactNode } from "react";
import styles from "./Board.module.css";
import { TaskCard } from "./TaskCard";

export function TaskColumn({
  status,
  tasks,
  nameOf,
  addAction,
}: {
  status: TaskStatus;
  tasks: Task[];
  nameOf: (id: string) => string;
  /** Only the Todo column receives this, and only for the CEO/CTO. */
  addAction?: ReactNode;
}) {
  const headingId = `column-${status}`;
  return (
    <section className={styles.column} aria-labelledby={headingId}>
      <div className={styles.columnHeader}>
        <h2 id={headingId} className={styles.columnTitle}>
          {statusLabel(status)}
          <span className={styles.count} aria-label={`${String(tasks.length)} tasks`}>
            {String(tasks.length)}
          </span>
        </h2>
      </div>
      {tasks.length === 0 ? (
        <p className={styles.empty}>No tasks</p>
      ) : (
        <ul className={styles.cards}>
          {tasks.map((task) => (
            <li key={task.id}>
              <TaskCard task={task} assigneeName={nameOf(task.assigneeId)} />
            </li>
          ))}
        </ul>
      )}
      {addAction ? <div className={styles.addRow}>{addAction}</div> : null}
    </section>
  );
}
