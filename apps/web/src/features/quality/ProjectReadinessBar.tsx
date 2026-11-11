import type { ReadinessDecision } from "@crm/contracts/quality";
import { formatTimestamp } from "../tasks/TimelineEntry";
import styles from "./Quality.module.css";
import { ReadinessPill } from "./QualityPills";
import { SetReadinessDialog } from "./SetReadinessDialog";

/** The project's current readiness (the latest decision). No decision counts as Not ready. */
export function ProjectReadinessBar({
  projectId,
  projectName,
  current,
  canManage,
}: {
  projectId: string;
  projectName: string;
  current: ReadinessDecision | null;
  canManage: boolean;
}) {
  return (
    <div className={styles.readinessBar} role="group" aria-label="Release readiness">
      <span className={styles.cellMuted}>Release readiness</span>
      <ReadinessPill readiness={current?.readiness ?? "not_ready"} />
      <span className={styles.subtle}>
        {current ? `${current.label} · ${formatTimestamp(current.decidedAt)}` : "No decision yet"}
      </span>
      {canManage ? <SetReadinessDialog projectId={projectId} projectName={projectName} /> : null}
    </div>
  );
}
