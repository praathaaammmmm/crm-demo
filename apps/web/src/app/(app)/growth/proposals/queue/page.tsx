import { proposalPageSchema } from "@crm/contracts/growth-proposals";
import { can } from "@crm/permissions";
import { CapNotice } from "../../../../../components/CapNotice";
import { EmptyState } from "../../../../../components/EmptyState";
import { NotAllowed } from "../../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../../components/PageToolbar";
import { ProposalTable } from "../../../../../features/growth/ProposalTable";
import { loadPeople } from "../../../../../lib/people";
import { collectPages, dataOrForbidden } from "../../../../../lib/server-api";
import { requireAppSession } from "../../../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../../../lib/task-view";

export default async function ProposalQueuePage() {
  const { user } = await requireAppSession();
  const allowed = can({ role: user.role }, "growth:approve_proposals");
  if (!allowed) {
    return <><PageToolbar icon="inbox" title="Approval queue" /><PageContent><NotAllowed /></PageContent></>;
  }
  const [proposals, people] = await Promise.all([collectPages("/growth/proposals/queue", proposalPageSchema), loadPeople(user)]);
  const page = dataOrForbidden(proposals);
  return (
    <>
      <PageToolbar icon="inbox" title="Approval queue" />
      <PageContent>
        {page === "forbidden" ? <NotAllowed /> : <>
          <CapNotice show={page.truncated} message={TASK_CAP_NOTICE.leads} />
          <CapNotice show={people.truncated} message={TASK_CAP_NOTICE.names} />
          {page.items.length === 0 ? <EmptyState title="Nothing needs approval">Pending proposal approvals and acceptance confirmations appear here.</EmptyState> : <ProposalTable proposals={page.items} nameOf={people.nameOf} />}
        </>}
      </PageContent>
    </>
  );
}
