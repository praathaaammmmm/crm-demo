import type { Activity } from "@crm/contracts/growth-leads";
import type { Role } from "@crm/permissions";
import { EmptyState } from "../../components/EmptyState";
import { activityActionsFor } from "../../lib/lead-actions";
import { isSafeProofUrl } from "../../lib/task-actions";
import { KIND_LABELS } from "./ActivityDrawer";
import styles from "./Growth.module.css";
import { VoidActivityDialog } from "./LeadDialogs";

/** Newest first. Voided activities stay visible with their reason. */
export function ActivityTimeline(props: {
  activities: Activity[];
  role: Role;
  nameOf: (id: string) => string;
  contactOf: (id: string | null) => string | null;
  formatTime: (iso: string) => string;
}) {
  if (props.activities.length === 0) return <EmptyState title="No activity yet" />;
  return (
    <ol className={styles.timeline} aria-label="Activity">
      {props.activities.map((activity) => {
        const contact = props.contactOf(activity.contactId);
        const voided = activity.voidedAt !== null;
        return (
          <li key={activity.id} className={[styles.timelineItem, voided ? styles.voided : undefined].join(" ")}>
            <div className={styles.actions}>
              <strong>{KIND_LABELS[activity.kind]}</strong>
              <span className={styles.muted}>{activity.direction === "outbound" ? "Outbound" : "Inbound"}</span>
              {contact ? <span className={styles.muted}>· {contact}</span> : null}
              <span className={styles.subtle}>
                {props.formatTime(activity.occurredAt)} · {props.nameOf(activity.authorId)}
              </span>
              {voided ? <span className={[styles.badge, styles.archived].join(" ")}>Voided</span> : null}
            </div>
            <p className={styles.summary}>{activity.summary}</p>
            {activity.proofUrl && isSafeProofUrl(activity.proofUrl) ? (
              <a href={activity.proofUrl} target="_blank" rel="noopener noreferrer nofollow" className={styles.subtle}>
                Proof link
              </a>
            ) : null}
            {voided ? <p className={styles.subtle}>Void reason: {activity.voidReason}</p> : null}
            {activityActionsFor({ role: props.role, activity }).canVoid ? <VoidActivityDialog activityId={activity.id} /> : null}
          </li>
        );
      })}
    </ol>
  );
}
