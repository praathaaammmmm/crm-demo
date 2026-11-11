import { defectStatusLabel, type DefectUpdate } from "@crm/contracts/quality";
import { Icon } from "../../components/Icon";
import { isSafeProofUrl } from "../../lib/task-actions";
import styles from "../tasks/Timeline.module.css";
import { TimelineEntry } from "../tasks/TimelineEntry";

/** Responses, evidence and status changes, oldest first (API order). Evidence renders as a link only when https. */
export function DefectTimeline({ updates, actorName }: { updates: DefectUpdate[]; actorName: (id: string) => string }) {
  if (updates.length === 0) return <p className={styles.empty}>No activity yet.</p>;
  return (
    <ol className={styles.timeline} aria-label="Activity">
      {updates.map((update) => {
        const action =
          update.fromStatus && update.toStatus
            ? `moved from ${defectStatusLabel(update.fromStatus)} to ${defectStatusLabel(update.toStatus)}`
            : update.evidenceUrl
              ? "added evidence"
              : "responded";
        return (
          <TimelineEntry key={update.id} actor={actorName(update.authorId)} at={update.createdAt} action={action}>
            {update.evidenceUrl ? (
              isSafeProofUrl(update.evidenceUrl) ? (
                <a className={styles.proofLink} href={update.evidenceUrl} target="_blank" rel="noopener noreferrer nofollow">
                  <Icon name="link" />
                  {update.evidenceUrl}
                </a>
              ) : (
                update.evidenceUrl
              )
            ) : null}
            {update.evidenceUrl && update.note ? "\n" : null}
            {update.note}
          </TimelineEntry>
        );
      })}
    </ol>
  );
}
