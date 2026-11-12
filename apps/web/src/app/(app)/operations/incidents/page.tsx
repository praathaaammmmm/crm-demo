import { incidentPageSchema, incidentSeveritySchema, incidentStatusSchema, INCIDENT_SEVERITIES, type Incident } from "@crm/contracts/operations";
import Link from "next/link";
import { ActionForm } from "../../../../components/ActionForm";
import { CapNotice } from "../../../../components/CapNotice";
import { DataTable } from "../../../../components/DataTable";
import { EmptyState } from "../../../../components/EmptyState";
import { FilterBar } from "../../../../components/FilterBar";
import { NotAllowed } from "../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../components/PageToolbar";
import { Pill, PillLink } from "../../../../components/Pill";
import { canManageOperations, canSeeOperations } from "../../../../lib/navigation";
import { INCIDENT_STATUS_LABELS, SEVERITY_LABELS } from "../../../../lib/operations-view";
import { loadPeople } from "../../../../lib/people";
import { hrefWith, readParam, type SearchParams } from "../../../../lib/search-params";
import { collectPages, dataOrForbidden } from "../../../../lib/server-api";
import { requireAppSession } from "../../../../lib/session";

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  const params = await searchParams;
  const open = readParam(params, "open") === "true";
  const severity = incidentSeveritySchema.safeParse(readParam(params, "severity"));
  const status = incidentStatusSchema.safeParse(readParam(params, "status"));
  const query: Record<string, string> = {};
  if (open) query["open"] = "true";
  if (severity.success) query["severity"] = severity.data;
  if (status.success) query["status"] = status.data;
  const allowed = canSeeOperations(user.role);
  const [page, people] = allowed ? await Promise.all([collectPages("/operations/incidents", incidentPageSchema, query), loadPeople(user)]) : [null, null];
  const incidents = page ? dataOrForbidden(page) : "forbidden";
  const manager = canManageOperations(user.role);
  const href = (change: Record<string, string | undefined>) =>
    hrefWith("/operations/incidents", { open: open ? "true" : undefined, severity: severity.success ? severity.data : undefined, ...change });

  return (
    <>
      <PageToolbar
        icon="alert"
        title="Incidents"
        controls={
          incidents === "forbidden" ? undefined : (
            <FilterBar clearHref={open || severity.success || status.success ? "/operations/incidents" : null}>
              <PillLink href={href({ open: open ? undefined : "true" })} selected={open}>
                Open
              </PillLink>
              {INCIDENT_SEVERITIES.map((value) => (
                <PillLink key={value} href={href({ severity: severity.success && severity.data === value ? undefined : value })} selected={severity.success && severity.data === value}>
                  {SEVERITY_LABELS[value]}
                </PillLink>
              ))}
            </FilterBar>
          )
        }
        primaryAction={
          manager && people ? (
            <ActionForm
              label="New incident"
              title="New incident"
              confirm="Open incident"
              variant="primary"
              path="/operations/incidents"
              redirect={{ key: "incident", prefix: "/operations/incidents/" }}
              fields={[
                { name: "title", label: "Title", kind: "text", required: true, maxLength: 200 },
                { name: "severity", label: "Severity", kind: "select", required: true, options: INCIDENT_SEVERITIES.map((value) => ({ value, label: SEVERITY_LABELS[value] })) },
                {
                  name: "ownerId",
                  label: "Owner",
                  kind: "select",
                  required: true,
                  defaultValue: user.id,
                  options: [{ value: user.id, label: "You" }, ...people.assignees.filter((p) => p.id !== user.id).map((p) => ({ value: p.id, label: p.name }))],
                },
                { name: "startedAt", label: "Started at", kind: "datetime", hint: "Optional. Defaults to now." },
                { name: "summary", label: "Summary", kind: "textarea", maxLength: 2000 },
              ]}
            />
          ) : undefined
        }
      />
      <PageContent>
        {incidents === "forbidden" || people === null ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={incidents.truncated} message="Showing the first 250 incidents. Filter to see more." />
            {incidents.items.length === 0 ? (
              <EmptyState title="No incidents match" />
            ) : (
              <DataTable<Incident>
                caption="Incidents"
                rowKey={(row) => row.id}
                rows={incidents.items}
                columns={[
                  { key: "severity", header: "Severity", render: (row) => <Pill>{SEVERITY_LABELS[row.severity]}</Pill> },
                  { key: "title", header: "Incident", render: (row) => <Link href={`/operations/incidents/${row.id}`}>{row.title}</Link> },
                  { key: "status", header: "Status", render: (row) => INCIDENT_STATUS_LABELS[row.status] },
                  { key: "owner", header: "Owner", render: (row) => people.nameOf(row.ownerId) },
                  { key: "started", header: "Started", render: (row) => row.startedAt.slice(0, 16).replace("T", " ") },
                ]}
              />
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
