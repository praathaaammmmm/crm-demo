import type { Task } from "@crm/contracts/tasks";
import Link from "next/link";
import { Avatar } from "../../components/Avatar";
import styles from "./Board.module.css";
import { DueDate } from "./DueDate";
import { PriorityMarker } from "./PriorityMarker";

/** Review state shown on the card, derived from the status only (no extra data is fetched). */
const REVIEW_INDICATOR: Partial<Record<Task["status"], string>> = {
  in_review: "Submitted",
  changes_requested: "Changes requested",
};

/** The whole card is one link to the task. */
export function TaskCard({ task, assigneeName }: { task: Task; assigneeName: string }) {
  const indicator = REVIEW_INDICATOR[task.status];
  return (
    <Link href={`/tasks/${task.id}`} className={[styles.card, task.overdue ? styles.cardOverdue : undefined].filter(Boolean).join(" ")}>
      <span className={styles.cardTitle}>{task.title}</span>
      {indicator ? <span className={styles.indicator}>{indicator}</span> : null}
      <span className={styles.cardMeta}>
        <span className={styles.cardMetaLeft}>
          <PriorityMarker priority={task.priority} />
          <DueDate date={task.dueDate} overdue={task.overdue} />
        </span>
        <Avatar name={assigneeName} size="xs" />
      </span>
    </Link>
  );
}
