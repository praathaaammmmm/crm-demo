import { companyPageSchema } from "@crm/contracts/growth";
import { CapNotice } from "../../../../components/CapNotice";
import { EmptyState } from "../../../../components/EmptyState";
import { FilterBar } from "../../../../components/FilterBar";
import { NotAllowed } from "../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../components/PageToolbar";
import { PillLink } from "../../../../components/Pill";
import { CompanyFormDrawer } from "../../../../features/growth/CompanyFormDrawer";
import { CompanyTable } from "../../../../features/growth/CompanyTable";
import { canCreateCompany } from "../../../../lib/growth-actions";
import { canSeeGrowth } from "../../../../lib/navigation";
import { loadPeople } from "../../../../lib/people";
import { readParam, type SearchParams } from "../../../../lib/search-params";
import { collectPages, dataOrForbidden } from "../../../../lib/server-api";
import { requireAppSession } from "../../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../../lib/task-view";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  if (!canSeeGrowth(user.role)) {
    return (
      <>
        <PageToolbar icon="building" title="Companies" />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  const archived = readParam(await searchParams, "archived") === "true";
  const [companies, people] = await Promise.all([
    collectPages("/growth/companies", companyPageSchema, archived ? { archived: "true" } : {}),
    loadPeople(user),
  ]);
  const page = dataOrForbidden(companies);
  const isManager = canCreateCompany(user.role);

  return (
    <>
      <PageToolbar
        icon="building"
        title="Companies"
        controls={
          <FilterBar clearHref={null}>
            <PillLink href="/growth/companies" selected={!archived}>
              Active
            </PillLink>
            <PillLink href="/growth/companies?archived=true" selected={archived}>
              Archived
            </PillLink>
          </FilterBar>
        }
        primaryAction={isManager ? <CompanyFormDrawer /> : undefined}
      />
      <PageContent>
        {page === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={page.truncated} message={TASK_CAP_NOTICE.companies} />
            <CapNotice show={people.truncated} message={TASK_CAP_NOTICE.names} />
            {page.items.length === 0 ? (
              <EmptyState title={archived ? "No archived companies" : "No companies yet"}>
                {isManager && !archived ? "Add the first company you are talking to." : null}
              </EmptyState>
            ) : (
              <CompanyTable companies={page.items} nameOf={people.nameOf} />
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
