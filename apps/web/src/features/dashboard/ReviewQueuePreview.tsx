import { taskPageSchema } from "@crm/contracts/tasks";
import Link from "next/link";
import { dataOrForbidden, serverGet } from "../../lib/server-api";
import { DueDate } from "../tasks/DueDate";
import styles from "./Dashboard.module.css";

const PREVIEW_SIZE = "5";

/** The first few tasks awaiting review, from GET /tasks?status=in_review. No other activity data is invented. */
export async function ReviewQueuePreview() {
  const page = dataOrForbidden(await serverGet("/tasks", taskPageSchema, { status: "in_review", limit: PREVIEW_SIZE }));
  if (page === "forbidden") return null;

  return (
    <div className={styles.preview}>
      {page.items.length === 0 ? (
        <p className={styles.previewEmpty}>Nothing waiting for review.</p>
      ) : (
        page.items.map((task) => (
          <div key={task.id} className={styles.previewItem}>
            <Link href={`/tasks/${task.id}`}>{task.title}</Link>
            <DueDate date={task.dueDate} overdue={task.overdue} />
          </div>
        ))
      )}
    </div>
  );
}
