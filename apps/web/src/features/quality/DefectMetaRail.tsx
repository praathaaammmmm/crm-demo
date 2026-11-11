import type { Defect } from "@crm/contracts/quality";
import Link from "next/link";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import type { DefectActions as Actions } from "../../lib/defect-actions";
import styles from "../tasks/Rail.module.css";
import { formatTimestamp } from "../tasks/TimelineEntry";
import { DefectActions } from "./DefectActions";
import { EditDefectDialog } from "./EditDefectDialog";
import { EvidenceDialog } from "./EvidenceDialog";
import { DefectStatusPill, SeverityPill } from "./QualityPills";

/** Compact defect metadata and the actions this viewer may take. */
export function DefectMetaRail({
  defect,
  actions,
  assigneeName,
  reporterName,
  taskTitle,
  projectName,
}: {
  defect: Defect;
  actions: Actions;
  assigneeName: string;
  reporterName: string;
  taskTitle: string;
  projectName: string;
}) {
  return (
    <aside className={styles.rail} aria-label="Defect details">
      <div className={styles.panel}>
        <dl className={styles.meta}>
          <dt>Status</dt>
          <dd>
            <DefectStatusPill status={defect.status} />
          </dd>
          <dt>Severity</dt>
          <dd>
            <SeverityPill severity={defect.severity} />
          </dd>
          <dt>Task</dt>
          <dd>
            <Link href={`/tasks/${defect.taskId}`}>{taskTitle}</Link>
          </dd>
          <dt>Project</dt>
          <dd>
            <Link href={`/projects/${defect.projectId}`}>{projectName}</Link>
          </dd>
          <dt>Assignee</dt>
          <dd>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
              <Avatar name={assigneeName} size="xs" />
              {assigneeName}
            </span>
          </dd>
          <dt>Reported by</dt>
          <dd>{reporterName}</dd>
          <dt>Reported</dt>
          <dd>{formatTimestamp(defect.createdAt)}</dd>
          {defect.resolvedAt ? (
            <>
              <dt>Resolved</dt>
              <dd>{formatTimestamp(defect.resolvedAt)}</dd>
            </>
          ) : null}
        </dl>
      </div>

      {actions.readOnly ? (
        <p className={styles.readOnly} role="status">
          <Icon name="check" />
          This defect is closed and read-only.
        </p>
      ) : (
        <div className={[styles.panel, styles.actions].join(" ")}>
          <DefectActions defectId={defect.id} moves={actions.moves} />
          {actions.canRespond ? (
            <div className={styles.actionRow}>
              <EvidenceDialog defectId={defect.id} />
              {actions.canEdit ? <EditDefectDialog defect={defect} /> : null}
            </div>
          ) : null}
          {actions.ownTaskNotice ? (
            <p className={styles.muted}>This defect is on your own task, so someone else must edit, verify, reopen or close it.</p>
          ) : null}
          {actions.moves.length === 0 && !actions.canRespond ? <p className={styles.muted}>No actions available.</p> : null}
        </div>
      )}
    </aside>
  );
}
