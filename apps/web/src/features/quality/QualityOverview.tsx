import {
  DEFECT_SEVERITIES,
  DEFECT_STATUSES,
  defectPageSchema,
  defectStatusLabel,
  qualitySummaryResponseSchema,
  RELEASE_READINESS,
  readinessLabel,
  severityLabel,
} from "@crm/contracts/quality";
import Link from "next/link";
import { CapNotice } from "../../components/CapNotice";
import { DonutChart } from "../../components/Charts";
import { EmptyState } from "../../components/EmptyState";
import { BarList, ChartGrid, KpiStrip, Panel, PanelEmpty } from "../../components/Insights";
import { NotAllowed } from "../../components/NotAllowed";
import { countBy, distributionRows } from "../../lib/chart-data";
import { collectPages, dataOrForbidden, serverGet } from "../../lib/server-api";
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

  const readiness = (
    <Panel id="quality-readiness-heading" title="Projects needing attention, by readiness">
      <CapNotice show={summary.capped} message={TASK_CAP_NOTICE.qualityProjects} />
      {summary.projects.length === 0 ? (
        <PanelEmpty>No projects need attention.</PanelEmpty>
      ) : (
        <BarList
          label="Projects by readiness"
          rows={distributionRows(countBy(summary.projects, (row) => row.readiness, RELEASE_READINESS), readinessLabel, { hideZero: true })}
          legend="Only projects that are not ready or have open blockers are listed; a project with no readiness record counts as Not ready."
        />
      )}
    </Panel>
  );

  if (!isPage) {
    return (
      <>
        <Panel id="quality-counts-heading" title="Quality" action={<Link href="/defects?open=true">Open defects</Link>}>
          <QualityTiles counts={summary.counts} />
        </Panel>
        {readiness}
        {blockers}
      </>
    );
  }

  // Defect breakdowns on the Quality page only, counted from the defect list the caller can read.
  const defects = dataOrForbidden(await collectPages("/defects", defectPageSchema, {}, 5));
  return (
    <>
      <KpiStrip label="Quality summary" metrics={qualityMetrics(summary.counts)} />
      <ChartGrid>
        {readiness}
        {defects === "forbidden" ? null : (
          <>
            <Panel id="defect-severity-heading" title="Defects by severity" action={<Link href="/defects">All defects</Link>}>
              <CapNotice show={defects.truncated} message={TASK_CAP_NOTICE.defects} />
              {defects.items.length === 0 ? (
                <PanelEmpty>No defects reported.</PanelEmpty>
              ) : (
                <DonutChart
                  label="Defects by severity"
                  centerLabel="defects"
                  total={`${String(defects.items.length)} defects, any status`}
                  rows={distributionRows(countBy(defects.items, (row) => row.severity, DEFECT_SEVERITIES), severityLabel, { hideZero: true })}
                />
              )}
            </Panel>
            <Panel id="defect-status-heading" title="Defects by status">
              {defects.items.length === 0 ? (
                <PanelEmpty>No defects reported.</PanelEmpty>
              ) : (
                <BarList
                  label="Defects by status"
                  total={`${String(defects.items.length)} defects`}
                  rows={distributionRows(countBy(defects.items, (row) => row.status, DEFECT_STATUSES), defectStatusLabel, { hideZero: true })}
                />
              )}
            </Panel>
          </>
        )}
      </ChartGrid>
      {blockers}
    </>
  );
}
