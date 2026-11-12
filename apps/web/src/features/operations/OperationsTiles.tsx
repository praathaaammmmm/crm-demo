import { operationsSummarySchema, type OperationsSummary } from "@crm/contracts/operations";
import Link from "next/link";
import { Panel, StatGrid, type Metric } from "../../components/Insights";
import { dataOrForbidden, serverGet } from "../../lib/server-api";

export const openIncidentCount = (summary: OperationsSummary): number =>
  summary.openIncidentsBySeverity.reduce((total, row) => total + row.count, 0);

/**
 * All operations summary metrics. Links only where the list supports the filter: there is no health filter
 * for automations and no 30-day filter for releases, so those metrics are plain text.
 */
export function operationsMetrics(summary: OperationsSummary): Metric[] {
  const open = openIncidentCount(summary);
  const sev1 = summary.openIncidentsBySeverity.find((row) => row.severity === "sev1")?.count ?? 0;
  return [
    { label: "Open incidents", value: String(open), href: "/operations/incidents?open=true", tone: open > 0 ? "danger" : undefined },
    { label: "Open SEV 1", value: String(sev1), href: "/operations/incidents?open=true&severity=sev1", tone: sev1 > 0 ? "danger" : undefined },
    { label: "Releases awaiting approval", value: String(summary.releasesAwaitingApproval), href: "/operations/releases?status=awaiting_approval" },
    {
      label: "Unhealthy live automations",
      value: String(summary.unhealthyLiveAutomations),
      tone: summary.unhealthyLiveAutomations > 0 ? "warning" : undefined,
    },
    { label: "Automations awaiting approval", value: String(summary.automationsAwaitingApproval), href: "/operations/automations?status=awaiting_approval" },
    { label: "Deployed (30 days)", value: String(summary.deploymentsLast30Days.deployed) },
    { label: "Rollbacks (30 days)", value: String(summary.deploymentsLast30Days.rolledBack) },
  ];
}

/** Operations panel for the VP Engineering & Quality and the CEO/CTO home pages; nothing for anyone else. */
export async function OperationsTiles() {
  const summary = dataOrForbidden(await serverGet("/operations/summary", operationsSummarySchema));
  if (summary === "forbidden") return null;
  return (
    <Panel id="operations-heading" title="Engineering operations" action={<Link href="/operations">View overview</Link>}>
      <StatGrid metrics={operationsMetrics(summary)} />
    </Panel>
  );
}
