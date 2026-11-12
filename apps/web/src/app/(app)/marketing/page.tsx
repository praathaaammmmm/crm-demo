import { addDays } from "@crm/contracts/growth-reports";
import { contentPageSchema, marketingSummarySchema, type Content } from "@crm/contracts/marketing";
import Link from "next/link";
import { DonutChart } from "../../../components/Charts";
import { DataTable } from "../../../components/DataTable";
import { ActionList, BarList, ChartGrid, DashboardGrid, KpiStrip, Panel, PanelEmpty, SectionDivider } from "../../../components/Insights";
import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { Pill } from "../../../components/Pill";
import styles from "../../../components/RecordPage.module.css";
import { marketingMetrics } from "../../../features/marketing/MarketingTiles";
import { distributionRows, totalOf } from "../../../lib/chart-data";
import { CAMPAIGN_STATUS_LABELS, CHANNEL_LABELS, CONTENT_STATUS_LABELS, formatCount } from "../../../lib/marketing-view";
import { canSeeMarketing } from "../../../lib/navigation";
import { collectPages, dataOrForbidden, serverGet } from "../../../lib/server-api";
import { requireAppSession } from "../../../lib/session";

const TITLE = "Marketing overview";

/** CMO dashboard and CEO/CTO read-only overview. */
export default async function MarketingOverviewPage() {
  const { user } = await requireAppSession();
  const summary = canSeeMarketing(user.role) ? dataOrForbidden(await serverGet("/marketing/summary", marketingSummarySchema)) : "forbidden";
  if (summary === "forbidden") {
    return (
      <>
        <PageToolbar icon="gauge" title={TITLE} />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }
  const upcoming = dataOrForbidden(
    await collectPages("/marketing/content", contentPageSchema, { from: summary.today, to: addDays(summary.today, 13) }, 2),
  );
  const items = upcoming === "forbidden" ? [] : upcoming.items.filter((item) => ["draft", "planned", "in_review"].includes(item.status));
  items.sort((a, b) => (a.plannedFor ?? "").localeCompare(b.plannedFor ?? ""));

  const inReview = items.filter((item) => item.status === "in_review");
  const reachRows = summary.last30Days.map((row) => ({
    key: row.channel,
    label: CHANNEL_LABELS[row.channel],
    value: row.reach,
    text: `${formatCount(row.reach)} reach · ${formatCount(row.published)} published`,
  }));
  const hasReach = summary.last30Days.some((row) => row.reach > 0);

  return (
    <>
      <PageToolbar icon="gauge" title={TITLE} />
      <PageContent>
        <KpiStrip label="Marketing summary" metrics={marketingMetrics(summary)} />
        <DashboardGrid
          main={
            <>
              <Panel id="reach-heading" title="Reach by channel (last 30 days)">
                {hasReach ? (
                  <BarList label="Reach by channel" rows={reachRows} legend="Bar length: recorded reach. Figures are entered by the CMO; nothing is fetched from the platforms." />
                ) : (
                  <PanelEmpty>No reach recorded for content published in the last 30 days.</PanelEmpty>
                )}
              </Panel>
              <Panel id="upcoming-heading" title="Next 14 days" action={<Link href="/marketing/content">Content calendar</Link>} flush>
                {items.length === 0 ? (
                  <PanelEmpty>Nothing planned for the next 14 days.</PanelEmpty>
                ) : (
                  <DataTable<Content>
                    caption="Upcoming content"
                    density="compact"
                    rowKey={(row) => row.id}
                    rows={items}
                    columns={[
                      { key: "date", header: "Planned for", render: (row) => row.plannedFor ?? "—" },
                      { key: "title", header: "Title", render: (row) => <Link href={`/marketing/content/${row.id}`}>{row.title}</Link> },
                      { key: "channel", header: "Channel", render: (row) => CHANNEL_LABELS[row.channel] },
                      { key: "status", header: "Status", render: (row) => <Pill>{CONTENT_STATUS_LABELS[row.status]}</Pill> },
                    ]}
                  />
                )}
              </Panel>
            </>
          }
          side={
            <Panel id="review-heading" title="In review (next 14 days)" action={<Link href="/marketing/content?status=in_review">View all</Link>} flush>
              <ActionList
                label="Content in review"
                empty="No content waiting for review in the next 14 days."
                items={inReview.map((row) => ({
                  key: row.id,
                  title: row.title,
                  href: `/marketing/content/${row.id}`,
                  meta: CHANNEL_LABELS[row.channel],
                  trailing: row.plannedFor ?? undefined,
                  tone: "warning",
                }))}
              />
            </Panel>
          }
        />
        <ChartGrid>
          <Panel id="content-status-heading" title="Content by status" action={<Link href="/marketing/content">Content calendar</Link>}>
            {totalOf(summary.contentByStatus) === 0 ? (
              <PanelEmpty>No content yet.</PanelEmpty>
            ) : (
              <DonutChart
                label="Content by status"
                centerLabel="items"
                total={`${formatCount(totalOf(summary.contentByStatus))} content items`}
                rows={distributionRows(
                  summary.contentByStatus.map((row) => ({ key: row.status, count: row.count })),
                  (status) => CONTENT_STATUS_LABELS[status],
                  { hideZero: true },
                )}
              />
            )}
          </Panel>
          <Panel id="campaign-status-heading" title="Campaigns by status" action={<Link href="/marketing/campaigns">Campaigns</Link>}>
            {totalOf(summary.campaignsByStatus) === 0 ? (
              <PanelEmpty>No campaigns yet.</PanelEmpty>
            ) : (
              <BarList
                label="Campaigns by status"
                total={`${formatCount(totalOf(summary.campaignsByStatus))} campaigns`}
                rows={distributionRows(
                  summary.campaignsByStatus.map((row) => ({ key: row.status, count: row.count })),
                  (status) => CAMPAIGN_STATUS_LABELS[status],
                  { hideZero: true },
                )}
              />
            )}
          </Panel>
        </ChartGrid>
        <SectionDivider id="channels-heading" title="Published in the last 30 days" />
        <Panel id="channels-table-heading" title="Outcomes by channel" flush>
          <DataTable
            caption="Outcomes by channel"
            density="compact"
            rowKey={(row) => row.channel}
            rows={summary.last30Days}
            columns={[
              { key: "channel", header: "Channel", render: (row) => CHANNEL_LABELS[row.channel] },
              { key: "published", header: "Published", render: (row) => formatCount(row.published) },
              { key: "reach", header: "Reach", render: (row) => formatCount(row.reach) },
              { key: "engagements", header: "Engagements", render: (row) => formatCount(row.engagements) },
              { key: "clicks", header: "Clicks", render: (row) => formatCount(row.clicks) },
            ]}
          />
        </Panel>
        <p className={styles.muted}>Counts are the figures the CMO recorded for each published item; nothing is fetched from the platforms.</p>
      </PageContent>
    </>
  );
}
