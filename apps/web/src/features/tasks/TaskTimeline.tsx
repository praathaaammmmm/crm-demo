import { statusLabel, type TaskDetail } from "@crm/contracts/tasks";
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { isSafeProofUrl } from "../../lib/task-actions";
import styles from "./Timeline.module.css";
import { TimelineEntry } from "./TimelineEntry";

type Detail = TaskDetail;

const REVIEW_ACTION = {
  approved: "approved the work",
  changes_requested: "requested changes",
  marked_complete: "marked the task complete",
} as const;

interface Entry {
  id: string;
  at: string;
  node: ReactNode;
}

/**
 * Updates, proofs and reviews merged oldest first. Proof links render as links only when they are
 * valid https:// URLs, and always open in a new tab without referrer.
 */
export function TaskTimeline({
  detail,
  actorName,
}: {
  detail: Pick<Detail, "updates" | "proofs" | "reviews">;
  actorName: (id: string, kind: "update" | "proof" | "review") => string;
}) {
  const entries: Entry[] = [
    ...detail.updates.map((update) => ({
      id: update.id,
      at: update.createdAt,
      node: (
        <TimelineEntry
          key={update.id}
          actor={actorName(update.authorId, "update")}
          at={update.createdAt}
          action={
            update.toStatus === "in_review"
              ? "submitted for review"
              : update.toStatus && update.fromStatus
                ? `moved from ${statusLabel(update.fromStatus)} to ${statusLabel(update.toStatus)}`
                : "posted an update"
          }
        >
          {update.note}
        </TimelineEntry>
      ),
    })),
    ...detail.proofs.map((proof) => ({
      id: proof.id,
      at: proof.createdAt,
      node: (
        <TimelineEntry key={proof.id} actor={actorName(proof.authorId, "proof")} at={proof.createdAt} action="added proof of work">
          {isSafeProofUrl(proof.url) ? (
            <a className={styles.proofLink} href={proof.url} target="_blank" rel="noopener noreferrer nofollow">
              <Icon name="link" />
              {proof.url}
            </a>
          ) : (
            proof.url
          )}
          {proof.url && proof.note ? "\n" : null}
          {proof.note}
        </TimelineEntry>
      ),
    })),
    ...detail.reviews.map((review) => ({
      id: review.id,
      at: review.createdAt,
      node: (
        <TimelineEntry key={review.id} actor={actorName(review.reviewerId, "review")} at={review.createdAt} action={REVIEW_ACTION[review.decision]}>
          {review.note}
        </TimelineEntry>
      ),
    })),
  ].sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at)));

  if (entries.length === 0) return <p className={styles.empty}>No activity yet.</p>;
  return (
    <ol className={styles.timeline} aria-label="Activity">
      {entries.map((entry) => entry.node)}
    </ol>
  );
}
