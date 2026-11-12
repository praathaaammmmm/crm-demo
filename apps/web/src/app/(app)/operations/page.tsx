import { incidentPageSchema, releasePageSchema, type Incident, type Release } from "@crm/contracts/operations";
import Link from "next/link";
import { DataTable } from "../../../components/DataTable";
import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { Pill } from "../../../components/Pill";
import styles from "../../../components/RecordPage.module.css";
import { OperationsTiles } from "../../../features/operations/OperationsTiles";
import { canApproveOperations, canSeeOperations } from "../../../lib/navigation";
import { ENVIRONMENT_LABELS, INCIDENT_STATUS_LABELS, SEVERITY_LABELS } from "../../../lib/operations-view";
import { loadPeople } from "../../../lib/people";
import { collectPages, dataOrForbidden } from "../../../lib/server-api";
import { requireAppSession } from "../../../lib/session";

const TITLE = "Engineering operations";

/** VP operations dashboard; the CEO/CTO sees the same read-only overview plus the approvals waiting on them. */
export default async function OperationsOverviewPage() {
  const { user } = await requireAppSession();
  const [incidents, waiting, people] = canSeeOperations(user.role)
    ? await Promise.all([
        collectPages("/operations/incidents", incidentPageSchema, { open: "true" }, 2),
        collectPages("/operations/releases", releasePageSchema, { status: "awaiting_approval" }, 2),
        loadPeople(user),
      ])
    : [null, null, null];
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

  return (
    <>
      <PageToolbar icon="gauge" title={TITLE} />
      <PageContent>
        <OperationsTiles heading={false} />
        <section className={styles.section} aria-labelledby="open-incidents-heading">
          <div className={styles.sectionHeader}>
            <h2 id="open-incidents-heading" className={styles.sectionTitle}>
              Open incidents
            </h2>
            <Link href="/operations/incidents">All incidents</Link>
          </div>
          {openIncidents.length === 0 ? (
            <p className={styles.muted}>No open incidents.</p>
          ) : (
            <DataTable<Incident>
              caption="Open incidents"
              rowKey={(row) => row.id}
              rows={openIncidents}
              columns={[
                { key: "severity", header: "Severity", render: (row) => <Pill>{SEVERITY_LABELS[row.severity]}</Pill> },
                { key: "title", header: "Incident", render: (row) => <Link href={`/operations/incidents/${row.id}`}>{row.title}</Link> },
                { key: "status", header: "Status", render: (row) => INCIDENT_STATUS_LABELS[row.status] },
                { key: "owner", header: "Owner", render: (row) => people.nameOf(row.ownerId) },
              ]}
            />
          )}
        </section>
        <section className={styles.section} aria-labelledby="awaiting-heading">
          <div className={styles.sectionHeader}>
            <h2 id="awaiting-heading" className={styles.sectionTitle}>
              {canApproveOperations(user.role) ? "Releases waiting for your approval" : "Releases awaiting CEO/CTO approval"}
            </h2>
            <Link href="/operations/releases">All releases</Link>
          </div>
          {pending.items.length === 0 ? (
            <p className={styles.muted}>Nothing is waiting for approval.</p>
          ) : (
            <DataTable<Release>
              caption="Releases awaiting approval"
              rowKey={(row) => row.id}
              rows={pending.items}
              columns={[
                { key: "name", header: "Release", render: (row) => <Link href={`/operations/releases/${row.id}`}>{`${row.name} (${row.versionLabel})`}</Link> },
                { key: "env", header: "Environment", render: (row) => ENVIRONMENT_LABELS[row.environment] },
                { key: "planned", header: "Planned for", render: (row) => row.plannedFor ?? "—" },
              ]}
            />
          )}
        </section>
      </PageContent>
    </>
  );
}
