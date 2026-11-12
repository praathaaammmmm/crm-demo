import { automationPageSchema, automationStatusSchema, AUTOMATION_STATUSES, type Automation } from "@crm/contracts/operations";
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
import { AUTOMATION_STATUS_LABELS, HEALTH_LABELS } from "../../../../lib/operations-view";
import { hrefWith, readParam, type SearchParams } from "../../../../lib/search-params";
import { collectPages, dataOrForbidden } from "../../../../lib/server-api";
import { requireAppSession } from "../../../../lib/session";

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  const status = automationStatusSchema.safeParse(readParam(await searchParams, "status"));
  const automations = canSeeOperations(user.role)
    ? dataOrForbidden(await collectPages("/operations/automations", automationPageSchema, status.success ? { status: status.data } : {}))
    : "forbidden";
  const manager = canManageOperations(user.role);

  return (
    <>
      <PageToolbar
        icon="board"
        title="Automations"
        controls={
          automations === "forbidden" ? undefined : (
            <FilterBar clearHref={status.success ? "/operations/automations" : null}>
              {AUTOMATION_STATUSES.map((value) => (
                <PillLink key={value} href={hrefWith("/operations/automations", { status: value })} selected={status.success && status.data === value}>
                  {AUTOMATION_STATUS_LABELS[value]}
                </PillLink>
              ))}
            </FilterBar>
          )
        }
        primaryAction={
          manager ? (
            <ActionForm
              label="Register automation"
              title="Register an automation"
              confirm="Register"
              variant="primary"
              path="/operations/automations"
              redirect={{ key: "automation", prefix: "/operations/automations/" }}
              fields={[
                { name: "name", label: "Name", kind: "text", required: true, maxLength: 200 },
                { name: "purpose", label: "Purpose", kind: "textarea", required: true, maxLength: 1000 },
                { name: "trigger", label: "Trigger or schedule", kind: "text", required: true, maxLength: 200 },
              ]}
            />
          ) : undefined
        }
      />
      <PageContent>
        {automations === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={automations.truncated} message="Showing the first 250 automations. Filter to see more." />
            {automations.items.length === 0 ? (
              <EmptyState title="No automations match">The registry records automations and their runs. Nothing here executes them.</EmptyState>
            ) : (
              <DataTable<Automation>
                caption="Automations"
                rowKey={(row) => row.id}
                rows={automations.items}
                columns={[
                  { key: "name", header: "Automation", render: (row) => <Link href={`/operations/automations/${row.id}`}>{row.name}</Link> },
                  { key: "status", header: "Status", render: (row) => <Pill>{AUTOMATION_STATUS_LABELS[row.status]}</Pill> },
                  { key: "health", header: "Health", render: (row) => HEALTH_LABELS[row.health] },
                  { key: "failures", header: "Failures (30 days)", render: (row) => String(row.failuresLast30Days) },
                ]}
              />
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
