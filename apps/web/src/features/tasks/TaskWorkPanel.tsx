import type { ReactNode } from "react";
import { ProgressComposer } from "./ProgressComposer";
import styles from "./Rail.module.css";

/** Main work area: description, optional quality panel, the assignee's update composer, and the activity timeline. */
export function TaskWorkPanel({
  taskId,
  description,
  canPostUpdates,
  timeline,
  quality,
}: {
  taskId: string;
  description: string;
  canPostUpdates: boolean;
  timeline: ReactNode;
  quality?: ReactNode;
}) {
  return (
    <div className={styles.work}>
      <section className={styles.panel} aria-labelledby="description-heading">
        <h2 id="description-heading" className={styles.panelTitle}>
          Description
        </h2>
        {description.length > 0 ? (
          <p className={styles.description}>{description}</p>
        ) : (
          <p className={styles.muted}>No description.</p>
        )}
      </section>
      {quality}
      <section className={styles.panel} aria-labelledby="activity-heading">
        <h2 id="activity-heading" className={styles.panelTitle}>
          Activity
        </h2>
        {canPostUpdates ? <ProgressComposer taskId={taskId} /> : null}
        <div style={{ marginTop: canPostUpdates ? "var(--space-4)" : 0 }}>{timeline}</div>
      </section>
    </div>
  );
}
