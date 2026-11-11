import { qualitySummaryResponseSchema } from "@crm/contracts/quality";
import Link from "next/link";
import { CapNotice } from "../../components/CapNotice";
import { EmptyState } from "../../components/EmptyState";
import { NotAllowed } from "../../components/NotAllowed";
import { dataOrForbidden, serverGet } from "../../lib/server-api";
import { TASK_CAP_NOTICE } from "../../lib/task-view";
import styles from "./Quality.module.css";
import { QualityTiles } from "./QualityTiles";
import { ReadinessTable } from "./ReadinessTable";

/**
 * Exact quality counts plus per-project readiness and blockers. Tiles use the uncapped counts; only the
 * project rows can be capped, and then a cap notice is shown. `previewRows` limits the table (dashboard).
 */
export async function QualityOverview({ canManage, previewRows }: { canManage: boolean; previewRows?: number }) {
  const summary = dataOrForbidden(await serverGet("/quality/summary", qualitySummaryResponseSchema));
  if (summary === "forbidden") return <NotAllowed />;
  const rows = previewRows === undefined ? summary.projects : summary.projects.slice(0, previewRows);

  return (
    <>
      <section className={styles.section} aria-labelledby="quality-counts-heading">
        <div className={styles.sectionHeader}>
          <h2 id="quality-counts-heading" className={styles.sectionTitle}>
            Quality
          </h2>
          {previewRows === undefined ? null : <Link href="/defects?open=true">Open defects</Link>}
        </div>
        <QualityTiles counts={summary.counts} />
      </section>

      <section className={styles.section} aria-labelledby="quality-blockers-heading">
        <div className={styles.sectionHeader}>
          <h2 id="quality-blockers-heading" className={styles.sectionTitle}>
            {previewRows === undefined ? "Release readiness and blockers" : "Top blockers"}
          </h2>
          {previewRows === undefined ? null : <Link href="/quality">View all</Link>}
        </div>
        <CapNotice show={summary.capped} message={TASK_CAP_NOTICE.qualityProjects} />
        {rows.length === 0 ? (
          <EmptyState title="No quality blockers">Every project is marked ready and has no open blockers.</EmptyState>
        ) : (
          <ReadinessTable rows={rows} canManage={canManage} />
        )}
      </section>
    </>
  );
}
