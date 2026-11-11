import type { Task } from "@crm/contracts/tasks";
import Link from "next/link";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import type { TaskActions } from "../../lib/task-actions";
import { AssigneeActions } from "./AssigneeActions";
import type { Option } from "./CreateTaskDialog";
import { DueDate } from "./DueDate";
import { EditTaskDialog } from "./EditTaskDialog";
import { PriorityMarker } from "./PriorityMarker";
import styles from "./Rail.module.css";
import { ReviewActions } from "./ReviewActions";
import { StatusPill } from "./StatusPill";
import { formatTimestamp } from "./TimelineEntry";

/** Compact metadata and the actions this viewer may take. */
export function TaskMetaRail({
  task,
  actions,
  assigneeName,
  projectName,
  assignees,
}: {
  task: Task;
  actions: TaskActions;
  assigneeName: string;
  projectName: string;
  assignees: Option[];
}) {
  const hasAssigneeActions = actions.moves.length > 0 || actions.canAddUpdates || actions.canSubmit || actions.submitHint !== null;
  return (
    <aside className={styles.rail} aria-label="Task details">
      <div className={styles.panel}>
        <dl className={styles.meta}>
          <dt>Status</dt>
          <dd>
            <StatusPill status={task.status} />
          </dd>
          <dt>Priority</dt>
          <dd>
            <PriorityMarker priority={task.priority} showLabel />
          </dd>
          <dt>Due</dt>
          <dd>
            <DueDate date={task.dueDate} overdue={task.overdue} />
          </dd>
          <dt>Assignee</dt>
          <dd>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
              <Avatar name={assigneeName} size="xs" />
              {assigneeName}
            </span>
          </dd>
          <dt>Project</dt>
          <dd>
            <Link href={`/projects/${task.projectId}`}>{projectName}</Link>
          </dd>
          <dt>Updated</dt>
          <dd>{formatTimestamp(task.updatedAt)}</dd>
          {task.completedAt ? (
            <>
              <dt>Completed</dt>
              <dd>{formatTimestamp(task.completedAt)}</dd>
            </>
          ) : null}
        </dl>
      </div>

      {actions.readOnly ? (
        <p className={styles.readOnly} role="status">
          <Icon name="check" />
          This task is completed and read-only.
        </p>
      ) : (
        <div className={[styles.panel, styles.actions].join(" ")}>
          {hasAssigneeActions ? (
            <AssigneeActions
              taskId={task.id}
              moves={actions.moves}
              canAddProof={actions.canAddUpdates}
              canSubmit={actions.canSubmit}
              submitHint={actions.submitHint}
            />
          ) : null}
          <ReviewActions taskId={task.id} canReview={actions.canReview} canMarkComplete={actions.canMarkComplete} />
          {actions.canEdit ? <EditTaskDialog task={task} assignees={assignees} /> : null}
          {!hasAssigneeActions && !actions.canReview && !actions.canMarkComplete && !actions.canEdit ? (
            <p className={styles.muted}>No actions available for this status.</p>
          ) : null}
        </div>
      )}
    </aside>
  );
}
