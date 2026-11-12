import { marketingSummarySchema } from "@crm/contracts/marketing";
import Link from "next/link";
import { Icon } from "../../components/Icon";
import { formatCount } from "../../lib/marketing-view";
import { dataOrForbidden, serverGet } from "../../lib/server-api";
import dashboard from "../dashboard/Dashboard.module.css";

/** Marketing counts for the CMO and the CEO/CTO; nothing for anyone else. */
export async function MarketingTiles({ heading = true }: { heading?: boolean }) {
  const summary = dataOrForbidden(await serverGet("/marketing/summary", marketingSummarySchema));
  if (summary === "forbidden") return null;
  const active = summary.campaignsByStatus.find((row) => row.status === "active")?.count ?? 0;
  const published = summary.last30Days.reduce((total, row) => total + row.published, 0);
  const tiles = [
    { label: "Active campaigns", value: active, href: "/marketing/campaigns?status=active", tone: undefined },
    { label: "Upcoming (14 days)", value: summary.upcoming, href: "/marketing/content", tone: undefined },
    { label: "Overdue content", value: summary.overdue, href: "/marketing/content", tone: "danger" as const },
    { label: "In review", value: summary.inReview, href: "/marketing/content?status=in_review", tone: "warning" as const },
    { label: "Published (30 days)", value: published, href: "/marketing/content?status=published", tone: undefined },
  ];
  return (
    <section className={dashboard.section} aria-labelledby="marketing-heading">
      {heading ? (
        <div className={dashboard.sectionHeader}>
          <h2 id="marketing-heading" className={dashboard.sectionTitle}>
            Marketing
          </h2>
          <Link href="/marketing">View overview</Link>
        </div>
      ) : (
        <h2 id="marketing-heading" className="visually-hidden">
          Marketing summary
        </h2>
      )}
      <div className={dashboard.grid}>
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className={[dashboard.tile, tile.tone ? dashboard[tile.tone] : undefined].filter(Boolean).join(" ")}>
            <span className={dashboard.tileTop}>
              <Icon name="gauge" />
              {tile.label}
            </span>
            <span className={dashboard.value}>{formatCount(tile.value)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
