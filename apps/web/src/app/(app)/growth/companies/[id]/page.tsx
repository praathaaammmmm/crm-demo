import { companyResponseSchema, contactPageSchema } from "@crm/contracts/growth";
import { activityPageSchema, leadPageSchema } from "@crm/contracts/growth-leads";
import { notFound } from "next/navigation";
import { CapNotice } from "../../../../../components/CapNotice";
import { EmptyState } from "../../../../../components/EmptyState";
import { Icon } from "../../../../../components/Icon";
import { NotAllowed } from "../../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../../components/PageToolbar";
import { ActivityDrawer } from "../../../../../features/growth/ActivityDrawer";
import { ActivityTimeline } from "../../../../../features/growth/ActivityTimeline";
import { ArchiveDialog } from "../../../../../features/growth/ArchiveDialog";
import { CompanyFormDrawer } from "../../../../../features/growth/CompanyFormDrawer";
import { ContactFormDrawer } from "../../../../../features/growth/ContactFormDrawer";
import { ContactTable } from "../../../../../features/growth/ContactTable";
import styles from "../../../../../features/growth/Growth.module.css";
import { LeadTable } from "../../../../../features/growth/LeadTable";
import { OwnerFlag } from "../../../../../features/growth/OwnerFlag";
import rail from "../../../../../features/tasks/Rail.module.css";
import { companyActionsFor } from "../../../../../lib/growth-actions";
import { growthTimeFormatter } from "../../../../../lib/growth-view";
import { canCreateLead } from "../../../../../lib/lead-actions";
import { canSeeGrowth } from "../../../../../lib/navigation";
import { loadPeople } from "../../../../../lib/people";
import { isUuid } from "../../../../../lib/search-params";
import { collectPages, dataOrForbidden, serverGet } from "../../../../../lib/server-api";
import { requireAppSession } from "../../../../../lib/session";
import { isSafeProofUrl } from "../../../../../lib/task-actions";
import { TASK_CAP_NOTICE } from "../../../../../lib/task-view";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAppSession();
  const crumbs = [{ href: "/growth/companies", label: "Companies" }];
  if (!canSeeGrowth(user.role)) {
    return (
      <>
        <PageToolbar icon="building" title="Company" breadcrumbs={crumbs} />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const result = dataOrForbidden(await serverGet(`/growth/companies/${id}`, companyResponseSchema));
  if (result === "forbidden") {
    return (
      <>
        <PageToolbar icon="building" title="Company" breadcrumbs={crumbs} />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }
  const { company } = result;
  const [contacts, people, leads, activities] = await Promise.all([
    collectPages(`/growth/companies/${id}/contacts`, contactPageSchema),
    loadPeople(user),
    collectPages("/growth/leads", leadPageSchema, { companyId: id }),
    collectPages(`/growth/companies/${id}/activities`, activityPageSchema),
  ]);
  const contactPage = dataOrForbidden(contacts);
  const leadPage = dataOrForbidden(leads);
  const activityPage = dataOrForbidden(activities);
  const contactList = contactPage === "forbidden" ? [] : contactPage.items;
  const contactOf = (contactId: string | null) => contactList.find((contact) => contact.id === contactId)?.fullName ?? null;
  const formatTime = growthTimeFormatter();
  const actions = companyActionsFor({ role: user.role, company });

  return (
    <>
      <PageToolbar
        icon="building"
        title={company.name}
        breadcrumbs={crumbs}
        primaryAction={
          actions.canEdit || actions.canArchive ? (
            <span className={styles.actions}>
              {actions.canEdit ? <CompanyFormDrawer company={company} /> : null}
              {actions.canArchive ? <ArchiveDialog kind="company" id={company.id} name={company.name} /> : null}
            </span>
          ) : undefined
        }
      />
      <PageContent>
        {actions.readOnly ? (
          <p className={styles.notice} role="status">
            <Icon name="info" />
            Archived, read-only. The company and its contacts can no longer be changed.
          </p>
        ) : null}
        <div className={rail.panel}>
          <dl className={rail.meta}>
            <dt>Industry</dt>
            <dd>{company.industry ?? "—"}</dd>
            <dt>Website</dt>
            <dd>
              {company.websiteUrl && isSafeProofUrl(company.websiteUrl) ? (
                <a href={company.websiteUrl} target="_blank" rel="noopener noreferrer nofollow">
                  {company.websiteUrl}
                </a>
              ) : (
                "—"
              )}
            </dd>
            <dt>Owner</dt>
            <dd className={styles.actions}>
              {people.nameOf(company.ownerId)}
              <OwnerFlag flagged={company.ownerFlagged} />
            </dd>
            <dt>Notes</dt>
            <dd className={rail.description}>{company.notes ?? "—"}</dd>
          </dl>
        </div>

        <section className={styles.section} aria-labelledby="contacts-heading">
          <div className={styles.sectionHeader}>
            <h2 id="contacts-heading" className={styles.sectionTitle}>
              Contacts
            </h2>
            {actions.canAddContact ? <ContactFormDrawer companyId={company.id} /> : null}
          </div>
          {contactPage === "forbidden" ? (
            <NotAllowed />
          ) : (
            <>
              <CapNotice show={contactPage.truncated} message={TASK_CAP_NOTICE.contacts} />
              {contactPage.items.length === 0 ? (
                <EmptyState title="No contacts yet" />
              ) : (
                <ContactTable contacts={contactPage.items} role={user.role} />
              )}
            </>
          )}
        </section>

        <section className={styles.section} aria-labelledby="leads-heading">
          <div className={styles.sectionHeader}>
            <h2 id="leads-heading" className={styles.sectionTitle}>
              Leads
            </h2>
          </div>
          {leadPage === "forbidden" ? (
            <NotAllowed />
          ) : (
            <>
              <CapNotice show={leadPage.truncated} message={TASK_CAP_NOTICE.leads} />
              {leadPage.items.length === 0 ? (
                <EmptyState title="No leads for this company">
                  {canCreateLead(user.role) && !actions.readOnly ? "Create one from the Leads page." : null}
                </EmptyState>
              ) : (
                <LeadTable leads={leadPage.items} nameOf={people.nameOf} companyOf={() => company.name} />
              )}
            </>
          )}
        </section>

        <section className={styles.section} aria-labelledby="company-activity-heading">
          <div className={styles.sectionHeader}>
            <h2 id="company-activity-heading" className={styles.sectionTitle}>
              Activity
            </h2>
            {actions.canAddContact ? (
              <ActivityDrawer
                link={{ companyId: company.id }}
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
              <ActivityTimeline activities={activityPage.items} role={user.role} nameOf={people.nameOf} contactOf={contactOf} formatTime={formatTime} />
            </>
          )}
        </section>
      </PageContent>
    </>
  );
}
