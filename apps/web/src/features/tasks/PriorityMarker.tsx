import type { Task } from "@crm/contracts/tasks";
import styles from "./Tasks.module.css";

type Priority = Task["priority"];

const LEVEL: Record<Priority, number> = { low: 1, medium: 2, high: 3, urgent: 4 };
const LABEL: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
const CLASS: Record<Priority, string | undefined> = {
  low: styles.low,
  medium: styles.medium,
  high: styles.high,
  urgent: styles.urgent,
};

export const priorityLabel = (priority: Priority): string => LABEL[priority];

/** Bars plus text (visible or screen-reader only). */
export function PriorityMarker({ priority, showLabel = false }: { priority: Priority; showLabel?: boolean }) {
  return (
    <span className={[styles.priority, CLASS[priority]].filter(Boolean).join(" ")} title={`Priority: ${LABEL[priority]}`}>
      <span className={styles.bars} aria-hidden="true">
        {[1, 2, 3, 4].map((level) => (
          <span key={level} className={[styles.bar, level <= LEVEL[priority] ? styles.barOn : undefined].filter(Boolean).join(" ")} />
        ))}
      </span>
      {showLabel ? LABEL[priority] : <span className="visually-hidden">Priority: {LABEL[priority]}</span>}
    </span>
  );
}
