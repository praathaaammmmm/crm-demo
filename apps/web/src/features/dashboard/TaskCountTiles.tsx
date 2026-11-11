import { taskSummarySchema } from "@crm/contracts/tasks";
import Link from "next/link";
import { Icon, type IconName } from "../../components/Icon";
import { NotAllowed } from "../../components/NotAllowed";
import { dataOrForbidden, serverGet } from "../../lib/server-api";
import styles from "./Dashboard.module.css";

/** Exact task counts from GET /tasks/summary; each tile opens the matching filtered view. */
export async function TaskCountTiles() {
  const summary = dataOrForbidden(await serverGet("/tasks/summary", taskSummarySchema));
  if (summary === "forbidden") return <NotAllowed />;

  const tiles: { label: string; value: number; href: string; icon: IconName; tone?: "danger" | "warning" }[] = [
    { label: "Overdue", value: summary.overdue, href: "/tasks?overdue=true", icon: "alert", tone: "danger" },
    { label: "Blocked", value: summary.blocked, href: "/tasks?status=blocked", icon: "alert", tone: "warning" },
    { label: "Pending review", value: summary.pendingReview, href: "/review", icon: "inbox" },
    { label: "Completed", value: summary.completed, href: "/tasks?status=completed", icon: "check" },
  ];

  return (
    <div className={styles.grid}>
      {tiles.map((tile) => (
        <Link
          key={tile.label}
          href={tile.href}
          className={[styles.tile, tile.tone ? styles[tile.tone] : undefined].filter(Boolean).join(" ")}
        >
          <span className={styles.tileTop}>
            <Icon name={tile.icon} />
            {tile.label}
          </span>
          <span className={styles.value}>{String(tile.value)}</span>
        </Link>
      ))}
    </div>
  );
}
