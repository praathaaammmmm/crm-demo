import { campaignPageSchema, contentPageSchema, contentStatusSchema, marketingChannelSchema, MARKETING_CHANNELS, type Content } from "@crm/contracts/marketing";
import Link from "next/link";
import { ActionForm } from "../../../../components/ActionForm";
import { CapNotice } from "../../../../components/CapNotice";
import { DataTable } from "../../../../components/DataTable";
import { EmptyState } from "../../../../components/EmptyState";
import { FilterBar } from "../../../../components/FilterBar";
import { NotAllowed } from "../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../components/PageToolbar";
import { Pill, PillLink } from "../../../../components/Pill";
import styles from "../../../../components/RecordPage.module.css";
import { CHANNEL_LABELS, CONTENT_STATUS_LABELS, groupByDate } from "../../../../lib/marketing-view";
import { canManageMarketing, canSeeMarketing } from "../../../../lib/navigation";
import { hrefWith, readParam, type SearchParams } from "../../../../lib/search-params";
import { collectPages, dataOrForbidden } from "../../../../lib/server-api";
import { requireAppSession } from "../../../../lib/session";

/** The content calendar: every item grouped by planned date, filterable by channel and status. */
export default async function ContentCalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  const params = await searchParams;
  const channel = marketingChannelSchema.safeParse(readParam(params, "channel"));
  const status = contentStatusSchema.safeParse(readParam(params, "status"));
  const query: Record<string, string> = {};
  if (channel.success) query["channel"] = channel.data;
  if (status.success) query["status"] = status.data;
  const allowed = canSeeMarketing(user.role);
  const [page, campaigns] = allowed
    ? await Promise.all([collectPages("/marketing/content", contentPageSchema, query), collectPages("/marketing/campaigns", campaignPageSchema)])
    : [null, null];
  const content = page ? dataOrForbidden(page) : "forbidden";
  const manager = canManageMarketing(user.role);
  const campaignList = campaigns?.ok ? campaigns.data.items : [];
  const campaignName = new Map(campaignList.map((campaign) => [campaign.id, campaign.name]));
  const href = (change: { channel?: string | undefined; status?: string | undefined }) =>
    hrefWith("/marketing/content", { channel: channel.success ? channel.data : undefined, status: status.success ? status.data : undefined, ...change });

  return (
    <>
      <PageToolbar
        icon="calendar"
        title="Content calendar"
        controls={
          content === "forbidden" ? undefined : (
            <FilterBar clearHref={channel.success || status.success ? "/marketing/content" : null}>
              {MARKETING_CHANNELS.map((value) => (
                <PillLink key={value} href={href({ channel: channel.success && channel.data === value ? undefined : value })} selected={channel.success && channel.data === value}>
                  {CHANNEL_LABELS[value]}
                </PillLink>
              ))}
            </FilterBar>
          )
        }
        primaryAction={
          manager ? (
            <ActionForm
              label="New content"
              title="New content"
              confirm="Create content"
              variant="primary"
              path="/marketing/content"
              redirect={{ key: "content", prefix: "/marketing/content/" }}
              fields={[
                { name: "title", label: "Title", kind: "text", required: true, maxLength: 200 },
                { name: "channel", label: "Channel", kind: "select", required: true, options: MARKETING_CHANNELS.map((value) => ({ value, label: CHANNEL_LABELS[value] })) },
                {
                  name: "campaignId",
                  label: "Campaign",
                  kind: "select",
                  options: [
                    { value: "", label: "No campaign" },
                    ...campaignList.filter((c) => c.status !== "completed" && c.status !== "cancelled").map((c) => ({ value: c.id, label: c.name })),
                  ],
                },
                { name: "plannedFor", label: "Planned for", kind: "date" },
                { name: "brief", label: "Brief", kind: "textarea", maxLength: 2000 },
              ]}
            />
          ) : undefined
        }
      />
      <PageContent>
        {content === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={content.truncated} message="Showing the first 250 items. Filter by channel or status to see more." />
            {content.items.length === 0 ? (
              <EmptyState title="No content matches">{manager ? "Plan a LinkedIn, Instagram or YouTube post." : null}</EmptyState>
            ) : (
              groupByDate(content.items).map((group) => (
                <section key={group.date ?? "unscheduled"} className={styles.day} aria-label={group.date ?? "Unscheduled"}>
                  <h2 className={styles.sectionTitle}>{group.date ?? "Unscheduled"}</h2>
                  <DataTable<Content>
                    caption={`Content for ${group.date ?? "no date"}`}
                    rowKey={(row) => row.id}
                    rows={group.items}
                    columns={[
                      { key: "title", header: "Title", render: (row) => <Link href={`/marketing/content/${row.id}`}>{row.title}</Link> },
                      { key: "channel", header: "Channel", render: (row) => CHANNEL_LABELS[row.channel] },
                      { key: "campaign", header: "Campaign", render: (row) => (row.campaignId ? (campaignName.get(row.campaignId) ?? "Campaign") : "—") },
                      {
                        key: "status",
                        header: "Status",
                        render: (row) => <Pill>{row.overdue ? `${CONTENT_STATUS_LABELS[row.status]} · overdue` : CONTENT_STATUS_LABELS[row.status]}</Pill>,
                      },
                    ]}
                  />
                </section>
              ))
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
