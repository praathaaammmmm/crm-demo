import { companyPageSchema } from "@crm/contracts/growth";
import { growthStageSchema, leadPageSchema } from "@crm/contracts/growth-leads";
import { CapNotice } from "../../../../components/CapNotice";
import { EmptyState } from "../../../../components/EmptyState";
import { NotAllowed } from "../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../components/PageToolbar";
import { ViewSwitch } from "../../../../components/ViewSwitch";
import { LeadBoard } from "../../../../features/growth/LeadBoard";
import { LeadFilters, leadsHref, type LeadFilterState } from "../../../../features/growth/LeadFilters";
import { LeadFormDrawer } from "../../../../features/growth/LeadFormDrawer";
import { LeadTable } from "../../../../features/growth/LeadTable";
import { canCreateLead } from "../../../../lib/lead-actions";
import { canSeeGrowth } from "../../../../lib/navigation";
import { loadPeople } from "../../../../lib/people";
import { readParam, type SearchParams } from "../../../../lib/search-params";
import { collectPages, dataOrForbidden } from "../../../../lib/server-api";
import { requireAppSession } from "../../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../../lib/task-view";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  if (!canSeeGrowth(user.role)) {
    return (
      <>
        <PageToolbar icon="board" title="Leads" />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  const params = await searchParams;
  const view = readParam(params, "view") === "list" ? "list" : "board";
  const stage = growthStageSchema.safeParse(readParam(params, "stage"));
  const state: LeadFilterState = {
    view,
    stage: view === "list" && stage.success ? stage.data : undefined,
    overdue: readParam(params, "overdue") === "true",
    stale: readParam(params, "stale") === "true",
    archived: readParam(params, "archived") === "true",
  };
  const query: Record<string, string> = {};
  if (state.stage) query["stage"] = state.stage;
  if (state.overdue) query["overdue"] = "true";
  if (state.stale) query["stale"] = "true";
  if (state.archived) query["archived"] = "true";

  const [leads, companies, people] = await Promise.all([
    collectPages("/growth/leads", leadPageSchema, query),
    collectPages("/growth/companies", companyPageSchema),
    loadPeople(user),
  ]);
  const page = dataOrForbidden(leads);
  const companyList = companies.ok ? companies.data.items.map((company) => ({ id: company.id, name: company.name })) : [];
  const companyNames = new Map(companyList.map((company) => [company.id, company.name]));
  const companyOf = (id: string | null) => (id === null ? "No company" : (companyNames.get(id) ?? "Archived company"));
  const isManager = canCreateLead(user.role);

  return (
    <>
      <PageToolbar
        icon="board"
        title="Leads"
        controls={
          <>
            <ViewSwitch current={view} hrefFor={(next) => leadsHref(state, { view: next, stage: undefined })} />
            <LeadFilters state={state} />
          </>
        }
        primaryAction={isManager ? <LeadFormDrawer companies={companyList} contacts={[]} /> : undefined}
      />
      <PageContent>
        {page === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={page.truncated} message={TASK_CAP_NOTICE.leads} />
            <CapNotice show={people.truncated} message={TASK_CAP_NOTICE.names} />
            {page.items.length === 0 ? (
              <EmptyState title={state.archived ? "No archived leads" : "No leads match"}>
                {isManager && !state.archived ? "Add a lead when a conversation starts." : null}
              </EmptyState>
            ) : view === "board" ? (
              <LeadBoard leads={page.items} companyOf={companyOf} />
            ) : (
              <LeadTable leads={page.items} nameOf={people.nameOf} companyOf={companyOf} />
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
