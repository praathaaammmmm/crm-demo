import type { Defect, QaCheck } from "@crm/contracts/quality";
import Link from "next/link";
import styles from "../tasks/Rail.module.css";
import { AddQaCheckDialog } from "./AddQaCheckDialog";
import q from "./Quality.module.css";
import { DefectStatusPill, QaOutcomePill, SeverityPill } from "./QualityPills";
import { RecordResultDialog } from "./RecordResultDialog";
import { ReportDefectDialog } from "./ReportDefectDialog";

/** QA checks and defects on one task. Managers can add checks, record results and report defects. */
export function TaskQualityPanel({
  taskId,
  qaChecks,
  defects,
  canManage,
}: {
  taskId: string;
  qaChecks: QaCheck[];
  defects: Defect[];
  canManage: boolean;
}) {
  return (
    <section className={styles.panel} aria-labelledby="quality-heading">
      <h2 id="quality-heading" className={styles.panelTitle}>
        Quality
      </h2>
      {canManage ? (
        <div className={q.panelActions}>
          <AddQaCheckDialog taskId={taskId} />
          <ReportDefectDialog
            taskId={taskId}
            qaChecks={qaChecks.map((check) => ({ id: check.id, title: check.title }))}
            triggerVariant="secondary"
          />
        </div>
      ) : null}

      <h3 className={q.sectionTitle}>QA checks</h3>
      {qaChecks.length === 0 ? (
        <p className={q.empty}>No QA checks.</p>
      ) : (
        <ul className={q.list} aria-label="QA checks">
          {qaChecks.map((check) => (
            <li key={check.id} className={q.item}>
              <span className={q.itemMain}>
                <QaOutcomePill outcome={check.latestOutcome} />
                {check.title}
              </span>
              {canManage ? <RecordResultDialog qaCheckId={check.id} checkTitle={check.title} /> : null}
            </li>
          ))}
        </ul>
      )}

      <h3 className={q.sectionTitle} style={{ marginTop: "var(--space-4)" }}>
        Defects
      </h3>
      {defects.length === 0 ? (
        <p className={q.empty}>No defects.</p>
      ) : (
        <ul className={q.list} aria-label="Defects">
          {defects.map((defect) => (
            <li key={defect.id} className={q.item}>
              <span className={q.itemMain}>
                <SeverityPill severity={defect.severity} />
                <Link href={`/defects/${defect.id}`} className={q.titleLink}>
                  {defect.title}
                </Link>
              </span>
              <DefectStatusPill status={defect.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
