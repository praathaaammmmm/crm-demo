import type { QualitySummary } from "@crm/contracts/quality";
import Link from "next/link";
import { Icon, type IconName } from "../../components/Icon";
import styles from "../dashboard/Dashboard.module.css";

/** Exact, uncapped counts from GET /quality/summary. Never shows a cap notice. */
export function QualityTiles({ counts }: { counts: QualitySummary["counts"] }) {
  const tiles: { label: string; value: number; href: string; icon: IconName; tone?: "danger" | "warning" }[] = [
    { label: "Critical open", value: counts.openCriticalDefects, href: "/defects?severity=critical&open=true", icon: "bug", tone: "danger" },
    { label: "High open", value: counts.openHighDefects, href: "/defects?severity=high&open=true", icon: "bug", tone: "warning" },
    { label: "Failed checks", value: counts.failedQaChecks, href: "/quality", icon: "alert" },
    { label: "Blocked checks", value: counts.blockedQaChecks, href: "/quality", icon: "alert" },
    { label: "Projects not ready", value: counts.projectsNotReady, href: "/quality", icon: "gauge" },
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
