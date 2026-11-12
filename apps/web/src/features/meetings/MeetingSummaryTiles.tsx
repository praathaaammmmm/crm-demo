import type { MeetingSummary } from "@crm/contracts/meetings";
import Link from "next/link";
import { Icon } from "../../components/Icon";
import styles from "../dashboard/Dashboard.module.css";

/** Exact counts from GET /meetings/summary. Responses only: no presence or join data exists. */
export function MeetingSummaryTiles({ counts }: { counts: MeetingSummary["counts"] }) {
  const tiles = [
    { label: "Meetings today", value: counts.today, href: "/meetings" },
    { label: "This week", value: counts.thisWeek, href: "/meetings?view=week" },
    { label: "Awaiting responses", value: counts.upcomingPending, href: "/meetings" },
    { label: "Cancelled (7 days)", value: counts.cancelledLast7Days, href: "/meetings?status=cancelled" },
  ];
  return (
    <div className={styles.grid}>
      {tiles.map((tile) => (
        <Link key={tile.label} href={tile.href} className={styles.tile}>
          <span className={styles.tileTop}>
            <Icon name="calendar" />
            {tile.label}
          </span>
          <span className={styles.value}>{String(tile.value)}</span>
        </Link>
      ))}
    </div>
  );
}
