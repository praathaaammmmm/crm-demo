import type { QualitySummary } from "@crm/contracts/quality";
import { StatGrid, type Metric } from "../../components/Insights";

/**
 * Exact, uncapped counts from GET /quality/summary. Defect counts link to the defect list, which supports
 * severity and open filters; the check and readiness counts have no list filter and are plain text.
 */
export function qualityMetrics(counts: QualitySummary["counts"]): Metric[] {
  return [
    { label: "Critical open", value: String(counts.openCriticalDefects), href: "/defects?severity=critical&open=true", tone: counts.openCriticalDefects > 0 ? "danger" : undefined },
    { label: "High open", value: String(counts.openHighDefects), href: "/defects?severity=high&open=true", tone: counts.openHighDefects > 0 ? "warning" : undefined },
    { label: "Failed checks", value: String(counts.failedQaChecks), tone: counts.failedQaChecks > 0 ? "danger" : undefined },
    { label: "Blocked checks", value: String(counts.blockedQaChecks), tone: counts.blockedQaChecks > 0 ? "warning" : undefined },
    { label: "Projects not ready", value: String(counts.projectsNotReady) },
  ];
}

export function QualityTiles({ counts }: { counts: QualitySummary["counts"] }) {
  return <StatGrid metrics={qualityMetrics(counts)} />;
}
