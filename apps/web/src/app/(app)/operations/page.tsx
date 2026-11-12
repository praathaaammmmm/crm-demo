import { incidentPageSchema, operationsSummarySchema, releasePageSchema, type Incident } from "@crm/contracts/operations";
import Link from "next/link";
import { DataTable } from "../../../components/DataTable";
import { ActionList, BarList, DashboardGrid, KpiStrip, Panel, PanelEmpty, StatGrid } from "../../../components/Insights";
import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { Pill } from "../../../components/Pill";
import { openIncidentCount, operationsMetrics } from "../../../features/operations/OperationsTiles";
import { canApproveOperations, canSeeOperations } from "../../../lib/navigation";
import { ENVIRONMENT_LABELS, INCIDENT_STATUS_LABELS, SEVERITY_LABELS } from "../../../lib/operations-view";
import { loadPeople } from "../../../lib/people";
import { collectPages, dataOrForbidden, serverGet } from "../../../lib/server-api";
import { requireAppSession } from "../../../lib/session";

const TITLE = "Engineering operations";

/** VP operations dashboard; the CEO/CTO sees the same read-only overview plus the approvals waiting on them. */
export default async function OperationsOverviewPage() {
  const { user } = await requireAppSession();
  const [incidents, waiting, people, summaryResult] = canSeeOperations(user.role)
    ? await Promise.all([
        collectPages("/operations/incidents", incidentPageSchema, { open: "true" }, 2),
        collectPages("/operations/releases", releasePageSchema, { status: "awaiting_approval" }, 2),
        loadPeople(user),
        serverGet("/operations/summary", operationsSummarySchema),
      ])
    : [null, null, null, null];
  const open = incidents ? dataOrForbidden(incidents) : "forbidden";
  const pending = waiting ? dataOrForbidden(waiting) : "forbidden";
  if (open === "forbidden" || pending === "forbidden" || people === null) {
    return (
      <>
        <PageToolbar icon="gauge" title={TITLE} />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }
  const severityOrder = (incident: Incident) => incident.severity;
  const openIncidents = [...open.items].sort((a, b) => severityOrder(a).localeCompare(severityOrder(b)));

  const summary = dataOrForbidden(summaryResult);
  const metrics = summary === "forbidden" ? [] : operationsMetrics(summary);

  return (
    <>
      <PageToolbar icon="gauge" title={TITLE} />
      <PageContent>
        {metrics.length > 0 ? <KpiStrip label="Operations summary" metrics={metrics.slice(0, 4)} /> : null}
        <DashboardGrid
          main={
            <>
              {summary === "forbidden" ? null : (
                <Panel id="severity-heading" title="Open incidents by severity">
                  {openIncidentCount(summary) === 0 ? (
                    <PanelEmpty>No open incidents.</PanelEmpty>
                  ) : (
                    <BarList
                      label="Open incidents by severity"
                      rows={summary.openIncidentsBySeverity.map((row) => ({ key: row.severity, label: SEVERITY_LABELS[row.severity], value: row.count, text: String(row.count) }))}
                    />
                  )}
                </Panel>
              )}
              <Panel id="open-incidents-heading" title="Open incidents" action={<Link href="/operations/incidents">All incidents</Link>} flush>
                {openIncidents.length === 0 ? (
                  <PanelEmpty>No open incidents.</PanelEmpty>
                ) : (
                  <DataTable<Incident>
                    caption="Open incidents"
                    density="compact"
                    rowKey={(row) => row.id}
                    rows={openIncidents}
                    columns={[
                      { key: "severity", header: "Severity", render: (row) => <Pill tone={row.severity === "sev1" ? "danger" : row.severity === "sev2" ? "warning" : "neutral"}>{SEVERITY_LABELS[row.severity]}</Pill> },
                      { key: "title", header: "Incident", render: (row) => <Link href={`/operations/incidents/${row.id}`}>{row.title}</Link> },
                      { key: "status", header: "Status", render: (row) => INCIDENT_STATUS_LABELS[row.status] },
                      { key: "owner", header: "Owner", render: (row) => people.nameOf(row.ownerId) },
                    ]}
                  />
                )}
              </Panel>
            </>
          }
          side={
            <>
              <Panel
                id="awaiting-heading"
                title={canApproveOperations(user.role) ? "Releases waiting for your approval" : "Releases awaiting CEO/CTO approval"}
                action={<Link href="/operations/releases">All releases</Link>}
                flush
              >
                <ActionList
                  label="Releases awaiting approval"
                  empty="Nothing is waiting for approval."
                  items={pending.items.map((row) => ({
                    key: row.id,
                    title: `${row.name} (${row.versionLabel})`,
                    href: `/operations/releases/${row.id}`,
                    meta: ENVIRONMENT_LABELS[row.environment],
                    trailing: row.plannedFor ?? undefined,
                    tone: row.environment === "production" ? "warning" : undefined,
                  }))}
                />
              </Panel>
              {metrics.length > 4 ? (
                <Panel id="ops-more-heading" title="Automations and deployments">
                  <StatGrid metrics={metrics.slice(4)} />
                </Panel>
              ) : null}
            </>
          }
        />
      </PageContent>
    </>
  );
}
