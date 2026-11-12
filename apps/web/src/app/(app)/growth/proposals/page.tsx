import { PROPOSAL_STATUSES, proposalPageSchema, proposalStatusSchema } from "@crm/contracts/growth-proposals";
import { CapNotice } from "../../../../components/CapNotice";
import { EmptyState } from "../../../../components/EmptyState";
import { FilterBar } from "../../../../components/FilterBar";
import { NotAllowed } from "../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../components/PageToolbar";
import { PillLink } from "../../../../components/Pill";
import { ProposalTable } from "../../../../features/growth/ProposalTable";
import { canSeeGrowth } from "../../../../lib/navigation";
import { loadPeople } from "../../../../lib/people";
import { readParam, type SearchParams } from "../../../../lib/search-params";
import { collectPages, dataOrForbidden } from "../../../../lib/server-api";
import { requireAppSession } from "../../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../../lib/task-view";

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  if (!canSeeGrowth(user.role)) {
    return <><PageToolbar icon="board" title="Proposals" /><PageContent><NotAllowed /></PageContent></>;
  }
  const parsed = proposalStatusSchema.safeParse(readParam(await searchParams, "status"));
  const status = parsed.success ? parsed.data : undefined;
  const [proposals, people] = await Promise.all([
    collectPages("/growth/proposals", proposalPageSchema, status ? { status } : {}),
    loadPeople(user),
  ]);
  const page = dataOrForbidden(proposals);
  return (
    <>
      <PageToolbar
        icon="board"
        title="Proposals"
        controls={
          <FilterBar clearHref={null}>
            <PillLink href="/growth/proposals" selected={status === undefined}>All</PillLink>
            {PROPOSAL_STATUSES.map((item) => <PillLink key={item} href={`/growth/proposals?status=${item}`} selected={status === item}>{item.replaceAll("_", " ")}</PillLink>)}
          </FilterBar>
        }
      />
      <PageContent>
        {page === "forbidden" ? <NotAllowed /> : <>
          <CapNotice show={page.truncated} message={TASK_CAP_NOTICE.leads} />
          <CapNotice show={people.truncated} message={TASK_CAP_NOTICE.names} />
          {page.items.length === 0 ? <EmptyState title={status ? "No proposals with this status" : "No proposals yet"}>Proposals appear here after a CGO creates a version for a lead.</EmptyState> : <ProposalTable proposals={page.items} nameOf={people.nameOf} />}
        </>}
      </PageContent>
    </>
  );
}
