import { qualitySummaryResponseSchema } from "@crm/contracts/quality";
import Link from "next/link";
import { CapNotice } from "../../components/CapNotice";
import { EmptyState } from "../../components/EmptyState";
import { KpiStrip, Panel } from "../../components/Insights";
import { NotAllowed } from "../../components/NotAllowed";
import { dataOrForbidden, serverGet } from "../../lib/server-api";
import { TASK_CAP_NOTICE } from "../../lib/task-view";
import { qualityMetrics, QualityTiles } from "./QualityTiles";
import { ReadinessTable } from "./ReadinessTable";

/**
 * Exact quality counts plus per-project readiness and blockers. Tiles use the uncapped counts; only the
 * project rows can be capped, and then a cap notice is shown. `previewRows` limits the table (dashboard).
 */
export async function QualityOverview({ canManage, previewRows }: { canManage: boolean; previewRows?: number }) {
  const summary = dataOrForbidden(await serverGet("/quality/summary", qualitySummaryResponseSchema));
  if (summary === "forbidden") return <NotAllowed />;
  const rows = previewRows === undefined ? summary.projects : summary.projects.slice(0, previewRows);

  const isPage = previewRows === undefined;
  const blockers = (
    <Panel
      id="quality-blockers-heading"
      title={isPage ? "Release readiness and blockers" : "Top blockers"}
      action={isPage ? undefined : <Link href="/quality">View all</Link>}
      flush
    >
      <CapNotice show={summary.capped} message={TASK_CAP_NOTICE.qualityProjects} />
      {rows.length === 0 ? (
        <EmptyState title="No quality blockers">Every project is marked ready and has no open blockers.</EmptyState>
      ) : (
        <ReadinessTable rows={rows} canManage={canManage} />
      )}
    </Panel>
  );

  return isPage ? (
    <>
      <KpiStrip label="Quality summary" metrics={qualityMetrics(summary.counts)} />
      {blockers}
    </>
  ) : (
    <>
      <Panel id="quality-counts-heading" title="Quality" action={<Link href="/defects?open=true">Open defects</Link>}>
        <QualityTiles counts={summary.counts} />
      </Panel>
      {blockers}
    </>
  );
}
