import { projectResponseSchema } from "@crm/contracts/projects";
import { readinessPageSchema } from "@crm/contracts/quality";
import { taskPageSchema, taskStatusSchema } from "@crm/contracts/tasks";
import { notFound } from "next/navigation";
import { CapNotice } from "../../../../components/CapNotice";
import { EmptyState } from "../../../../components/EmptyState";
import { NotAllowed } from "../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../components/PageToolbar";
import styles from "../../../../features/projects/Projects.module.css";
import { ProjectReadinessBar } from "../../../../features/quality/ProjectReadinessBar";
import { CreateTaskDialog } from "../../../../features/tasks/CreateTaskDialog";
import { TaskBoard } from "../../../../features/tasks/TaskBoard";
import { TaskTable } from "../../../../features/tasks/TaskTable";
import { TaskToolbarControls, type TaskFilterState } from "../../../../features/tasks/TaskToolbarControls";
import { canCreateTasks, canManageQuality, canReadAllTasks, canSeeQuality } from "../../../../lib/navigation";
import { loadPeople } from "../../../../lib/people";
import { isUuid, readParam, type SearchParams } from "../../../../lib/search-params";
import { collectPages, dataOrForbidden, serverGet } from "../../../../lib/server-api";
import { requireAppSession } from "../../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../../lib/task-view";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { user } = await requireAppSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const project = dataOrForbidden(await serverGet(`/projects/${id}`, projectResponseSchema));
  if (project === "forbidden") {
    return (
      <>
        <PageToolbar icon="folder" title="Project" breadcrumbs={[{ href: "/projects", label: "Projects" }]} />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  // The CEO gets a board by default; everyone else sees a list of their own tasks in this project.
  const isManager = canReadAllTasks(user.role);
  const query = await searchParams;
  const view: "board" | "list" = isManager && readParam(query, "view") !== "list" ? "board" : "list";
  const status = view === "list" ? taskStatusSchema.safeParse(readParam(query, "status")).data : undefined;
  const state: TaskFilterState = { project: undefined, status, overdue: readParam(query, "overdue") === "true", view };

  const apiParams: Record<string, string> = { projectId: id };
  if (status !== undefined) apiParams["status"] = status;
  if (state.overdue) apiParams["overdue"] = "true";

  const [tasks, people, readiness] = await Promise.all([
    collectPages("/tasks", taskPageSchema, apiParams),
    loadPeople(user),
    canSeeQuality(user.role) ? serverGet(`/projects/${id}/readiness`, readinessPageSchema, { limit: "1" }) : Promise.resolve(null),
  ]);
  const page = dataOrForbidden(tasks);
  const basePath = `/projects/${id}`;
  const canCreate = canCreateTasks(user.role);
  const projectName = project.project.name;

  return (
    <>
      <PageToolbar
        icon="folder"
        title={projectName}
        breadcrumbs={[{ href: "/projects", label: "Projects" }]}
        controls={<TaskToolbarControls basePath={basePath} state={state} showViewSwitch={isManager} />}
        primaryAction={canCreate ? <CreateTaskDialog projectId={id} assignees={people.assignees} /> : undefined}
      />
      <PageContent>
        {project.project.description ? <p className={styles.summary}>{project.project.description}</p> : null}
        {readiness?.ok ? (
          <ProjectReadinessBar
            projectId={id}
            projectName={projectName}
            current={readiness.data.items[0] ?? null}
            canManage={
              // Self-QA conflict: no readiness decisions on a project containing the viewer's own task.
              canManageQuality(user.role) && page !== "forbidden" && !page.items.some((task) => task.assigneeId === user.id)
            }
          />
        ) : null}
        {page === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={page.truncated} message={view === "board" ? TASK_CAP_NOTICE.board : TASK_CAP_NOTICE.list} />
            <CapNotice show={people.truncated} message={canCreate ? TASK_CAP_NOTICE.people : TASK_CAP_NOTICE.names} />
            {view === "board" ? (
              <TaskBoard
                tasks={page.items}
                nameOf={people.nameOf}
                todoAddAction={
                  canCreate ? (
                    <CreateTaskDialog
                      projectId={id}
                      assignees={people.assignees}
                      triggerVariant="ghost"
                      triggerAriaLabel="New task in Todo"
                    />
                  ) : undefined
                }
              />
            ) : page.items.length === 0 ? (
              <EmptyState title="No tasks">{canCreate ? "Create the first task for this project." : null}</EmptyState>
            ) : (
              <TaskTable tasks={page.items} nameOf={people.nameOf} projectNameOf={() => projectName} showProject={false} />
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
