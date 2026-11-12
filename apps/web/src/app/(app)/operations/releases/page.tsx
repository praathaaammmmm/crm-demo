import { releasePageSchema, releaseStatusSchema, RELEASE_ENVIRONMENTS, RELEASE_STATUSES, type Release } from "@crm/contracts/operations";
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
import { ENVIRONMENT_LABELS, RELEASE_STATUS_LABELS } from "../../../../lib/operations-view";
import { hrefWith, readParam, type SearchParams } from "../../../../lib/search-params";
import { collectPages, dataOrForbidden } from "../../../../lib/server-api";
import { requireAppSession } from "../../../../lib/session";

export default async function ReleasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  const status = releaseStatusSchema.safeParse(readParam(await searchParams, "status"));
  const releases = canSeeOperations(user.role)
    ? dataOrForbidden(await collectPages("/operations/releases", releasePageSchema, status.success ? { status: status.data } : {}))
    : "forbidden";
  const manager = canManageOperations(user.role);

  return (
    <>
      <PageToolbar
        icon="list"
        title="Releases"
        controls={
          releases === "forbidden" ? undefined : (
            <FilterBar clearHref={status.success ? "/operations/releases" : null}>
              {RELEASE_STATUSES.map((value) => (
                <PillLink key={value} href={hrefWith("/operations/releases", { status: value })} selected={status.success && status.data === value}>
                  {RELEASE_STATUS_LABELS[value]}
                </PillLink>
              ))}
            </FilterBar>
          )
        }
        primaryAction={
          manager ? (
            <ActionForm
              label="New release"
              title="New release record"
              confirm="Create release"
              variant="primary"
              path="/operations/releases"
              redirect={{ key: "release", prefix: "/operations/releases/" }}
              fields={[
                { name: "name", label: "Name", kind: "text", required: true, maxLength: 200 },
                { name: "versionLabel", label: "Version", kind: "text", required: true, maxLength: 64 },
                { name: "environment", label: "Environment", kind: "select", required: true, options: RELEASE_ENVIRONMENTS.map((value) => ({ value, label: ENVIRONMENT_LABELS[value] })) },
                { name: "plannedFor", label: "Planned for", kind: "date" },
                { name: "notes", label: "Notes", kind: "textarea", maxLength: 2000 },
              ]}
            />
          ) : undefined
        }
      />
      <PageContent>
        {releases === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={releases.truncated} message="Showing the first 250 releases. Filter to see more." />
            {releases.items.length === 0 ? (
              <EmptyState title="No releases match">Release records track checklists, approval and outcomes. Nothing here deploys.</EmptyState>
            ) : (
              <DataTable<Release>
                caption="Releases"
                rowKey={(row) => row.id}
                rows={releases.items}
                columns={[
                  { key: "name", header: "Release", render: (row) => <Link href={`/operations/releases/${row.id}`}>{`${row.name} (${row.versionLabel})`}</Link> },
                  { key: "env", header: "Environment", render: (row) => ENVIRONMENT_LABELS[row.environment] },
                  { key: "status", header: "Status", render: (row) => <Pill>{RELEASE_STATUS_LABELS[row.status]}</Pill> },
                  { key: "checklist", header: "Checklist", render: (row) => `${String(row.checklistDone)}/${String(row.checklistTotal)}` },
                  { key: "planned", header: "Planned for", render: (row) => row.plannedFor ?? "—" },
                ]}
              />
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
