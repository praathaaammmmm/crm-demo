import { defectPageSchema } from "@crm/contracts/quality";
import Link from "next/link";
import { Icon } from "../../components/Icon";
import { collectPages } from "../../lib/server-api";
import styles from "../dashboard/Dashboard.module.css";

/** Home tile for assignees: open defects on their own tasks ("250+" when the read limit is reached). */
export async function OpenDefectsTile() {
  const result = await collectPages("/defects", defectPageSchema, { open: "true" });
  if (!result.ok) return null;
  const { items, truncated } = result.data;
  return (
    <div className={styles.grid}>
      <Link href="/defects?open=true" className={[styles.tile, items.length > 0 ? styles.warning : undefined].filter(Boolean).join(" ")}>
        <span className={styles.tileTop}>
          <Icon name="bug" />
          Open defects on your tasks
        </span>
        <span className={styles.value}>{truncated ? `${String(items.length)}+` : String(items.length)}</span>
      </Link>
    </div>
  );
}
