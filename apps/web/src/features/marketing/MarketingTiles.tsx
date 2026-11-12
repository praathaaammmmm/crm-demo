import { marketingSummarySchema, type MarketingSummary } from "@crm/contracts/marketing";
import Link from "next/link";
import { Panel, StatGrid, type Metric } from "../../components/Insights";
import { formatCount } from "../../lib/marketing-view";
import { dataOrForbidden, serverGet } from "../../lib/server-api";

/**
 * All marketing summary metrics. A link is set only where the content or campaign list supports that exact
 * filter; "upcoming", "overdue" and the 30-day published count have no matching filter, so they are plain text.
 */
export function marketingMetrics(summary: MarketingSummary): Metric[] {
  const active = summary.campaignsByStatus.find((row) => row.status === "active")?.count ?? 0;
  const published = summary.last30Days.reduce((total, row) => total + row.published, 0);
  return [
    { label: "Active campaigns", value: formatCount(active), href: "/marketing/campaigns?status=active" },
    { label: "Overdue content", value: formatCount(summary.overdue), tone: summary.overdue > 0 ? "danger" : undefined },
    { label: "In review", value: formatCount(summary.inReview), href: "/marketing/content?status=in_review", tone: summary.inReview > 0 ? "warning" : undefined },
    { label: "Published (30 days)", value: formatCount(published) },
    { label: "Upcoming (14 days)", value: formatCount(summary.upcoming) },
  ];
}

/** Marketing panel for the CMO and the CEO/CTO home pages; nothing for anyone else. */
export async function MarketingTiles() {
  const summary = dataOrForbidden(await serverGet("/marketing/summary", marketingSummarySchema));
  if (summary === "forbidden") return null;
  return (
    <Panel id="marketing-heading" title="Marketing" action={<Link href="/marketing">View overview</Link>}>
      <StatGrid metrics={marketingMetrics(summary)} />
    </Panel>
  );
}
