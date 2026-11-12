import { addDays } from "@crm/contracts/growth-reports";
import { contentPageSchema, marketingSummarySchema, type Content } from "@crm/contracts/marketing";
import Link from "next/link";
import { DataTable } from "../../../components/DataTable";
import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { Pill } from "../../../components/Pill";
import styles from "../../../components/RecordPage.module.css";
import { MarketingTiles } from "../../../features/marketing/MarketingTiles";
import { CHANNEL_LABELS, CONTENT_STATUS_LABELS, formatCount } from "../../../lib/marketing-view";
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

  return (
    <>
      <PageToolbar icon="gauge" title={TITLE} />
      <PageContent>
        <MarketingTiles heading={false} />
        <section className={styles.section} aria-labelledby="upcoming-heading">
          <div className={styles.sectionHeader}>
            <h2 id="upcoming-heading" className={styles.sectionTitle}>
              Next 14 days
            </h2>
            <Link href="/marketing/content">Content calendar</Link>
          </div>
          {items.length === 0 ? (
            <p className={styles.muted}>Nothing planned for the next 14 days.</p>
          ) : (
            <DataTable<Content>
              caption="Upcoming content"
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
        </section>
        <section className={styles.section} aria-labelledby="channels-heading">
          <h2 id="channels-heading" className={styles.sectionTitle}>
            Published in the last 30 days
          </h2>
          <DataTable
            caption="Outcomes by channel"
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
          <p className={styles.muted}>Counts are the figures the CMO recorded for each published item; nothing is fetched from the platforms.</p>
        </section>
      </PageContent>
    </>
  );
}
