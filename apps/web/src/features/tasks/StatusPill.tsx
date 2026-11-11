import { statusLabel, type TaskStatus } from "@crm/contracts/tasks";
import styles from "./Tasks.module.css";

const STATUS_CLASS: Record<TaskStatus, string | undefined> = {
  todo: styles.todo,
  in_progress: styles.inProgress,
  blocked: styles.blocked,
  in_review: styles.inReview,
  changes_requested: styles.changesRequested,
  completed: styles.completed,
};

/** Muted status colour plus a readable label, so colour is never the only signal. */
export function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <span className={[styles.status, STATUS_CLASS[status]].filter(Boolean).join(" ")}>
      <span className={styles.dot} aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}
