import { companyPageSchema, contactPageSchema } from "@crm/contracts/growth";
import { activityPageSchema, leadDetailResponseSchema } from "@crm/contracts/growth-leads";
import { proposalDetailSchema } from "@crm/contracts/growth-proposals";
import { directoryPageSchema } from "@crm/contracts/organization";
import { notFound } from "next/navigation";
import { CapNotice } from "../../../../../components/CapNotice";
import { Icon } from "../../../../../components/Icon";
import { NotAllowed } from "../../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../../components/PageToolbar";
import { ActivityDrawer } from "../../../../../features/growth/ActivityDrawer";
import { ActivityTimeline } from "../../../../../features/growth/ActivityTimeline";
import { ArchiveDialog } from "../../../../../features/growth/ArchiveDialog";
import styles from "../../../../../features/growth/Growth.module.css";
import { LostDialog, ReassignDialog, ReopenDialog, StageDialog } from "../../../../../features/growth/LeadDialogs";
import { LeadFormDrawer } from "../../../../../features/growth/LeadFormDrawer";
import { LeadRail } from "../../../../../features/growth/LeadRail";
import { ProposalPanel } from "../../../../../features/growth/ProposalPanel";
import { StagePill } from "../../../../../features/growth/StagePill";
import { growthTimeFormatter } from "../../../../../lib/growth-view";
import { leadActionsFor } from "../../../../../lib/lead-actions";
import { canSeeGrowth } from "../../../../../lib/navigation";
import { loadPeople } from "../../../../../lib/people";
import { isUuid } from "../../../../../lib/search-params";
import { collectPages, dataOrForbidden, serverGet } from "../../../../../lib/server-api";
import { requireAppSession } from "../../../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../../../lib/task-view";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAppSession();
  const crumbs = [{ href: "/growth/leads", label: "Leads" }];
  const blocked = (
    <>
      <PageToolbar icon="board" title="Lead" breadcrumbs={crumbs} />
      <PageContent>
        <NotAllowed />
      </PageContent>
    </>
  );
  if (!canSeeGrowth(user.role)) return blocked;
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const result = dataOrForbidden(await serverGet(`/growth/leads/${id}`, leadDetailResponseSchema));
  if (result === "forbidden") return blocked;
  const { lead, history } = result;
  const actions = leadActionsFor({ role: user.role, lead });

  const [activities, proposalDetail, companies, contacts, people, directory] = await Promise.all([
    collectPages(`/growth/leads/${id}/activities`, activityPageSchema),
    serverGet(`/growth/leads/${id}/proposal`, proposalDetailSchema),
    collectPages("/growth/companies", companyPageSchema),
    lead.companyId ? collectPages(`/growth/companies/${lead.companyId}/contacts`, contactPageSchema) : null,
    loadPeople(user),
    actions.canReassign ? collectPages("/users", directoryPageSchema) : null,
  ]);
  const companyList = companies.ok ? companies.data.items.map((company) => ({ id: company.id, name: company.name })) : [];
  const contactList = contacts?.ok ? contacts.data.items : [];
  const contactName = (contactId: string | null) => contactList.find((contact) => contact.id === contactId)?.fullName ?? null;
  const cgos = directory?.ok
    ? directory.data.items.filter((person) => person.role === "cgo" && person.status === "active").map(({ id: cgoId, name }) => ({ id: cgoId, name }))
    : [];
  const activityPage = dataOrForbidden(activities);
  const proposalPage = dataOrForbidden(proposalDetail);
  const formatTime = growthTimeFormatter();

  return (
    <>
      <PageToolbar
        icon="board"
        title={lead.name}
        breadcrumbs={crumbs}
        primaryAction={
          <span className={styles.actions}>
            <StagePill stage={lead.stage} />
            {actions.canMove && actions.moveTargets.length > 0 ? <StageDialog leadId={lead.id} targets={actions.moveTargets} /> : null}
            {actions.canMarkLost ? <LostDialog leadId={lead.id} /> : null}
            {actions.canEdit ? (
              <LeadFormDrawer
                lead={lead}
                companies={companyList}
                contacts={contactList.filter((contact) => contact.archivedAt === null).map((contact) => ({ id: contact.id, companyId: contact.companyId, name: contact.fullName }))}
              />
            ) : null}
            {actions.canReopen ? <ReopenDialog leadId={lead.id} /> : null}
            {actions.canReassign ? <ReassignDialog leadId={lead.id} ownerId={lead.ownerId} cgos={cgos} /> : null}
            {actions.canArchive ? <ArchiveDialog kind="lead" id={lead.id} name={lead.name} /> : null}
          </span>
        }
      />
      <PageContent>
        {lead.archivedAt ? (
          <p className={styles.notice} role="status">
            <Icon name="info" />
            Archived, read-only.
          </p>
        ) : lead.stage === "lost" ? (
          <p className={styles.notice} role="status">
            <Icon name="info" />
            Lost. Only the CEO/CTO can reopen this lead.
          </p>
        ) : null}
        <LeadRail
          lead={lead}
          history={history}
          nameOf={people.nameOf}
          companyName={companyList.find((company) => company.id === lead.companyId)?.name ?? null}
          contactName={contactName(lead.primaryContactId)}
          formatTime={formatTime}
        />
        {proposalPage === "forbidden" ? (
          <section className={styles.section} aria-labelledby="proposal-heading">
            <h2 id="proposal-heading" className={styles.sectionTitle}>Proposal</h2>
            <NotAllowed />
          </section>
        ) : (
          <ProposalPanel lead={lead} detail={proposalPage} role={user.role} nameOf={people.nameOf} formatTime={formatTime} />
        )}
        <section className={styles.section} aria-labelledby="activity-heading">
          <div className={styles.sectionHeader}>
            <h2 id="activity-heading" className={styles.sectionTitle}>
              Activity
            </h2>
            {actions.canLogActivity ? (
              <ActivityDrawer
                link={{ leadId: lead.id }}
                contacts={contactList
                  .filter((contact) => contact.archivedAt === null)
                  .map((contact) => ({ id: contact.id, name: contact.fullName, doNotContact: contact.doNotContact }))}
              />
            ) : null}
          </div>
          {activityPage === "forbidden" ? (
            <NotAllowed />
          ) : (
            <>
              <CapNotice show={activityPage.truncated} message={TASK_CAP_NOTICE.activities} />
              <ActivityTimeline
                activities={activityPage.items}
                role={user.role}
                nameOf={people.nameOf}
                contactOf={contactName}
                formatTime={formatTime}
              />
            </>
          )}
        </section>
      </PageContent>
    </>
  );
}
