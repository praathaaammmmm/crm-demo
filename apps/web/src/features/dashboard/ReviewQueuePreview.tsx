import { taskPageSchema } from "@crm/contracts/tasks";
import { ActionList } from "../../components/Insights";
import { dataOrForbidden, serverGet } from "../../lib/server-api";
import { DueDate } from "../tasks/DueDate";

const PREVIEW_SIZE = "5";

/** The first few tasks awaiting review, from GET /tasks?status=in_review. No other activity data is invented. */
export async function ReviewQueuePreview() {
  const page = dataOrForbidden(await serverGet("/tasks", taskPageSchema, { status: "in_review", limit: PREVIEW_SIZE }));
  if (page === "forbidden") return null;
  return (
    <ActionList
      label="Tasks awaiting review"
      empty="Nothing waiting for review."
      items={page.items.map((task) => ({
        key: task.id,
        title: task.title,
        href: `/tasks/${task.id}`,
        trailing: <DueDate date={task.dueDate} overdue={task.overdue} />,
        tone: task.overdue ? "danger" : "warning",
      }))}
    />
  );
}
