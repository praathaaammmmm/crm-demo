import { taskPageSchema } from "@crm/contracts/tasks";
import { CapNotice } from "../../../components/CapNotice";
import { EmptyState } from "../../../components/EmptyState";
import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { ReviewActions } from "../../../features/tasks/ReviewActions";
import { TaskTable } from "../../../features/tasks/TaskTable";
import { canReviewTasks } from "../../../lib/navigation";
import { loadPeople, loadProjects } from "../../../lib/people";
import { collectPages, dataOrForbidden } from "../../../lib/server-api";
import { requireAppSession } from "../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../lib/task-view";

export default async function ReviewPage() {
  const { user } = await requireAppSession();
  if (!canReviewTasks(user.role)) {
    return (
      <>
        <PageToolbar icon="inbox" title="Review" />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  const [tasks, people, projects] = await Promise.all([
    collectPages("/tasks", taskPageSchema, { status: "in_review" }),
    loadPeople(user),
    loadProjects(),
  ]);
  const page = dataOrForbidden(tasks);

  return (
    <>
      <PageToolbar icon="inbox" title="Review" />
      <PageContent>
        {page === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={page.truncated} message={TASK_CAP_NOTICE.review} />
            <CapNotice show={people.truncated} message={TASK_CAP_NOTICE.names} />
            {page.items.length === 0 ? (
              <EmptyState title="Nothing waiting for review" />
            ) : (
              <TaskTable
                caption="Tasks awaiting review"
                tasks={page.items}
                nameOf={people.nameOf}
                projectNameOf={projects.nameOf}
                actions={(task) => <ReviewActions taskId={task.id} canReview canMarkComplete />}
              />
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
