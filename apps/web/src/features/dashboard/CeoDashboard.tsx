import { approvalPageSchema } from "@crm/contracts/approvals";
import { directoryPageSchema } from "@crm/contracts/organization";
import Link from "next/link";
import { Icon } from "../../components/Icon";
import { NotAllowed } from "../../components/NotAllowed";
import { QualityOverview } from "../quality/QualityOverview";
import { collectPages, dataOrForbidden } from "../../lib/server-api";
import styles from "./Dashboard.module.css";
import { ReviewQueuePreview } from "./ReviewQueuePreview";
import { TaskCountTiles } from "./TaskCountTiles";

const MAX_PAGES = 5;

/** "250+" rather than a wrong number when the count reaches the page limit. */
const shown = (count: number, truncated: boolean) => (truncated ? `${String(count)}+` : String(count));

/** CEO-only operational overview built from existing endpoints. */
export async function CeoDashboard() {
  const [users, pending] = await Promise.all([
    collectPages("/users", directoryPageSchema, {}, MAX_PAGES),
    collectPages("/approvals", approvalPageSchema, { status: "pending" }, MAX_PAGES),
  ]);
  const directory = dataOrForbidden(users);
  const approvals = dataOrForbidden(pending);
  if (directory === "forbidden" || approvals === "forbidden") return <NotAllowed />;

  const active = directory.items.filter((user) => user.status === "active").length;
  const deactivated = directory.items.length - active;

  return (
    <>
      <section className={styles.section} aria-labelledby="work-heading">
        <div className={styles.sectionHeader}>
          <h2 id="work-heading" className={styles.sectionTitle}>
            Work
          </h2>
        </div>
        <TaskCountTiles />
      </section>

      <section className={styles.section} aria-labelledby="org-heading">
        <div className={styles.sectionHeader}>
          <h2 id="org-heading" className={styles.sectionTitle}>
            Organization
          </h2>
        </div>
        <div className={styles.grid}>
          <Link href="/approvals" className={styles.tile}>
            <span className={styles.tileTop}>
              <Icon name="shield" />
              Pending approvals
            </span>
            <span className={styles.value}>{shown(approvals.items.length, approvals.truncated)}</span>
          </Link>
          <Link href="/users" className={styles.tile}>
            <span className={styles.tileTop}>
              <Icon name="users" />
              Active users
            </span>
            <span className={styles.value}>{shown(active, directory.truncated)}</span>
          </Link>
          <Link href="/users" className={styles.tile}>
            <span className={styles.tileTop}>
              <Icon name="users" />
              Deactivated users
            </span>
            <span className={styles.value}>{shown(deactivated, directory.truncated)}</span>
          </Link>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="review-heading">
        <div className={styles.sectionHeader}>
          <h2 id="review-heading" className={styles.sectionTitle}>
            Review queue
          </h2>
          <Link href="/review">View all</Link>
        </div>
        <ReviewQueuePreview />
      </section>

      <QualityOverview canManage previewRows={5} />
    </>
  );
}
