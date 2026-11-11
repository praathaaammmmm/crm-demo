import { projectResponseSchema } from "@crm/contracts/projects";
import { defectPageSchema, qaCheckPageSchema } from "@crm/contracts/quality";
import { taskDetailResponseSchema } from "@crm/contracts/tasks";
import { notFound } from "next/navigation";
import { CapNotice } from "../../../../components/CapNotice";
import { NotAllowed } from "../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../components/PageToolbar";
import { TaskQualityPanel } from "../../../../features/quality/TaskQualityPanel";
import styles from "../../../../features/tasks/Rail.module.css";
import { TaskMetaRail } from "../../../../features/tasks/TaskMetaRail";
import { TaskTimeline } from "../../../../features/tasks/TaskTimeline";
import { TaskWorkPanel } from "../../../../features/tasks/TaskWorkPanel";
import {
  canManageTasks,
  canReadAllTasks,
  canReadDirectory,
  canSeeDefects,
} from "../../../../lib/navigation";
import { loadPeople } from "../../../../lib/people";
import { isUuid } from "../../../../lib/search-params";
import { collectPages, dataOrForbidden, serverGet } from "../../../../lib/server-api";
import { requireAppSession } from "../../../../lib/session";
import { canManageQualityFor } from "../../../../lib/defect-actions";
import { taskActionsFor } from "../../../../lib/task-actions";
import { TASK_CAP_NOTICE } from "../../../../lib/task-view";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAppSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  // Hidden or missing tasks become notFound() inside dataOrForbidden.
  const detail = dataOrForbidden(await serverGet(`/tasks/${id}`, taskDetailResponseSchema));
  const crumbs = [{ href: "/tasks", label: canReadAllTasks(user.role) ? "Tasks" : "My tasks" }];
  if (detail === "forbidden") {
    return (
      <>
        <PageToolbar icon="tasks" title="Task" breadcrumbs={crumbs} />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  const { task } = detail;
  const showQuality = canSeeDefects(user.role);
  const [people, project, qaChecks, defects] = await Promise.all([
    loadPeople(user),
    serverGet(`/projects/${task.projectId}`, projectResponseSchema),
    showQuality ? collectPages("/qa-checks", qaCheckPageSchema, { taskId: task.id }) : Promise.resolve(null),
    showQuality ? collectPages("/defects", defectPageSchema, { taskId: task.id }) : Promise.resolve(null),
  ]);
  const hasDirectory = canReadDirectory(user.role);
  // Without directory access, reviewers can only be the CEO/CTO and other authors are previous assignees.
  const actorName = (actorId: string, kind: "update" | "proof" | "review") =>
    actorId === user.id ? "You" : hasDirectory ? people.nameOf(actorId) : kind === "review" ? "CEO/CTO" : "Previous assignee";

  const actions = taskActionsFor({
    role: user.role,
    viewerId: user.id,
    task: { status: task.status, assigneeId: task.assigneeId },
    proofCount: detail.proofs.length,
  });

  return (
    <>
      <PageToolbar icon="tasks" title={task.title} breadcrumbs={crumbs} />
      <PageContent>
        <CapNotice show={people.truncated && hasDirectory} message={TASK_CAP_NOTICE.names} />
        <div className={styles.layout}>
          <TaskWorkPanel
            taskId={task.id}
            description={task.description}
            canPostUpdates={actions.canAddUpdates}
            timeline={<TaskTimeline detail={detail} actorName={actorName} />}
            quality={
              qaChecks?.ok && defects?.ok ? (
                <TaskQualityPanel
                  taskId={task.id}
                  qaChecks={qaChecks.data.items}
                  defects={defects.data.items}
                  canManage={canManageQualityFor({ role: user.role, viewerId: user.id, assigneeId: task.assigneeId })}
                />
              ) : null
            }
          />
          <TaskMetaRail
            task={task}
            actions={actions}
            assigneeName={task.assigneeId === user.id ? "You" : people.nameOf(task.assigneeId)}
            projectName={project.ok ? project.data.project.name : "Project"}
            assignees={canManageTasks(user.role) ? people.assignees : []}
          />
        </div>
      </PageContent>
    </>
  );
}
