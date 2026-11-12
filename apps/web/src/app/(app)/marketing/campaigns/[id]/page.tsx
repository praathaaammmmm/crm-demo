import { CAMPAIGN_TRANSITIONS, campaignAcceptsContent, campaignDetailResponseSchema, contentPageSchema, MARKETING_CHANNELS, type Content } from "@crm/contracts/marketing";
import Link from "next/link";
import { ActionForm } from "../../../../../components/ActionForm";
import { DataTable } from "../../../../../components/DataTable";
import { NotAllowed } from "../../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../../components/PageToolbar";
import { Pill } from "../../../../../components/Pill";
import styles from "../../../../../components/RecordPage.module.css";
import { CAMPAIGN_STATUS_LABELS, CHANNEL_LABELS, CONTENT_STATUS_LABELS, formatCount } from "../../../../../lib/marketing-view";
import { canManageMarketing, canSeeMarketing } from "../../../../../lib/navigation";
import { isUuid } from "../../../../../lib/search-params";
import { collectPages, dataOrForbidden, serverGet } from "../../../../../lib/server-api";
import { requireAppSession } from "../../../../../lib/session";
import { notFound } from "next/navigation";

const CHANNEL_OPTIONS = MARKETING_CHANNELS.map((value) => ({ value, label: CHANNEL_LABELS[value] }));

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAppSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = canSeeMarketing(user.role) ? dataOrForbidden(await serverGet(`/marketing/campaigns/${id}`, campaignDetailResponseSchema)) : "forbidden";
  if (detail === "forbidden") {
    return (
      <>
        <PageToolbar icon="folder" title="Campaign" />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }
  const { campaign, outcome } = detail;
  const content = dataOrForbidden(await collectPages("/marketing/content", contentPageSchema, { campaignId: id }, 2));
  const items = content === "forbidden" ? [] : content.items;
  const manager = canManageMarketing(user.role);
  const open = campaignAcceptsContent(campaign.status);

  return (
    <>
      <PageToolbar icon="folder" title={campaign.name} breadcrumbs={[{ href: "/marketing/campaigns", label: "Campaigns" }]} />
      <PageContent>
        {manager ? (
          <div className={styles.actions}>
            {CAMPAIGN_TRANSITIONS[campaign.status].map((to) => (
              <ActionForm
                key={to}
                label={`Mark ${CAMPAIGN_STATUS_LABELS[to].toLowerCase()}`}
                title={`Mark the campaign ${CAMPAIGN_STATUS_LABELS[to].toLowerCase()}?`}
                confirm="Confirm"
                variant={to === "cancelled" ? "danger" : "secondary"}
                path={`/marketing/campaigns/${id}/status`}
                fixed={{ to }}
              />
            ))}
            {open ? (
              <>
                <ActionForm
                  label="Edit campaign"
                  title="Edit campaign"
                  confirm="Save"
                  method="PATCH"
                  path={`/marketing/campaigns/${id}`}
                  fields={[
                    { name: "name", label: "Name", kind: "text", required: true, maxLength: 200, defaultValue: campaign.name },
                    { name: "objective", label: "Objective", kind: "textarea", empty: "null", maxLength: 1000, defaultValue: campaign.objective ?? "" },
                    { name: "startsOn", label: "Starts on", kind: "date", empty: "null", defaultValue: campaign.startsOn ?? "" },
                    { name: "endsOn", label: "Ends on", kind: "date", empty: "null", defaultValue: campaign.endsOn ?? "" },
                  ]}
                />
                <ActionForm
                  label="Add content"
                  title="Add content to this campaign"
                  confirm="Add content"
                  variant="primary"
                  path="/marketing/content"
                  fixed={{ campaignId: id }}
                  redirect={{ key: "content", prefix: "/marketing/content/" }}
                  fields={[
                    { name: "title", label: "Title", kind: "text", required: true, maxLength: 200 },
                    { name: "channel", label: "Channel", kind: "select", required: true, options: CHANNEL_OPTIONS },
                    { name: "plannedFor", label: "Planned for", kind: "date" },
                    { name: "brief", label: "Brief", kind: "textarea", maxLength: 2000 },
                  ]}
                />
              </>
            ) : null}
          </div>
        ) : null}
        <dl className={styles.meta}>
          <dt>Status</dt>
          <dd>
            <Pill>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Pill>
          </dd>
          <dt>Dates</dt>
          <dd>{`${campaign.startsOn ?? "—"} → ${campaign.endsOn ?? "—"}`}</dd>
          <dt>Objective</dt>
          <dd className={styles.prose}>{campaign.objective ?? "—"}</dd>
        </dl>

        <section className={styles.section} aria-labelledby="outcome-heading">
          <h2 id="outcome-heading" className={styles.sectionTitle}>
            Outcome
          </h2>
          <p className={styles.muted}>
            {`${String(outcome.publishedOnTime)} published on time, ${String(outcome.publishedLate)} late. `}
            {outcome.contentByStatus.map((row) => `${CONTENT_STATUS_LABELS[row.status]}: ${String(row.count)}`).join(" · ")}
          </p>
          <DataTable
            caption="Campaign outcome by channel"
            rowKey={(row) => row.channel}
            rows={outcome.byChannel}
            columns={[
              { key: "channel", header: "Channel", render: (row) => CHANNEL_LABELS[row.channel] },
              { key: "published", header: "Published", render: (row) => formatCount(row.published) },
              { key: "reach", header: "Reach", render: (row) => formatCount(row.reach) },
              { key: "engagements", header: "Engagements", render: (row) => formatCount(row.engagements) },
              { key: "clicks", header: "Clicks", render: (row) => formatCount(row.clicks) },
            ]}
          />
        </section>

        <section className={styles.section} aria-labelledby="content-heading">
          <h2 id="content-heading" className={styles.sectionTitle}>
            Content
          </h2>
          {items.length === 0 ? (
            <p className={styles.muted}>No content in this campaign yet.</p>
          ) : (
            <DataTable<Content>
              caption="Campaign content"
              rowKey={(row) => row.id}
              rows={items}
              columns={[
                { key: "title", header: "Title", render: (row) => <Link href={`/marketing/content/${row.id}`}>{row.title}</Link> },
                { key: "channel", header: "Channel", render: (row) => CHANNEL_LABELS[row.channel] },
                { key: "date", header: "Planned for", render: (row) => row.plannedFor ?? "—" },
                { key: "status", header: "Status", render: (row) => <Pill>{CONTENT_STATUS_LABELS[row.status]}</Pill> },
              ]}
            />
          )}
        </section>
      </PageContent>
    </>
  );
}
