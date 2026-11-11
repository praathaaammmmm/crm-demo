import { taskPageSchema, taskStatusSchema } from "@crm/contracts/tasks";
import { CapNotice } from "../../../components/CapNotice";
import { EmptyState } from "../../../components/EmptyState";
import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { CreateTaskDialog } from "../../../features/tasks/CreateTaskDialog";
import { MyTasksList } from "../../../features/tasks/MyTasksList";
import { TaskBoard } from "../../../features/tasks/TaskBoard";
import { TaskTable } from "../../../features/tasks/TaskTable";
import { TaskToolbarControls, type TaskFilterState } from "../../../features/tasks/TaskToolbarControls";
import { canCreateTasks, canReadAllTasks, canSeeTasks } from "../../../lib/navigation";
import { loadPeople, loadProjects } from "../../../lib/people";
import { isUuid, readParam, type SearchParams } from "../../../lib/search-params";
import { collectPages, dataOrForbidden } from "../../../lib/server-api";
import { requireAppSession } from "../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../lib/task-view";

export default async function TasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  const isManager = canReadAllTasks(user.role);
  const title = isManager ? "Tasks" : "My tasks";
  if (!canSeeTasks(user.role)) {
    return (
      <>
        <PageToolbar icon="tasks" title={title} />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  const query = await searchParams;
  // The CEO can switch to a board; the default for everyone is a list.
  const view: "board" | "list" = isManager && readParam(query, "view") === "board" ? "board" : "list";
  const projectParam = readParam(query, "project");
  const state: TaskFilterState = {
    project: isUuid(projectParam) ? projectParam : undefined,
    status: view === "list" ? taskStatusSchema.safeParse(readParam(query, "status")).data : undefined,
    overdue: readParam(query, "overdue") === "true",
    view,
  };

  const apiParams: Record<string, string> = {};
  if (state.project !== undefined) apiParams["projectId"] = state.project;
  if (state.status !== undefined) apiParams["status"] = state.status;
  if (state.overdue) apiParams["overdue"] = "true";

  const [tasks, people, projects] = await Promise.all([
    collectPages("/tasks", taskPageSchema, apiParams),
    loadPeople(user),
    loadProjects(),
  ]);
  const page = dataOrForbidden(tasks);
  const canCreate = canCreateTasks(user.role);
  const filtered = state.project !== undefined || state.status !== undefined || state.overdue;

  return (
    <>
      <PageToolbar
        icon="tasks"
        title={title}
        controls={<TaskToolbarControls basePath="/tasks" state={state} projects={projects.list} showViewSwitch={isManager} />}
        primaryAction={
          canCreate ? <CreateTaskDialog projects={projects.list} assignees={people.assignees} /> : undefined
        }
      />
      <PageContent>
        {page === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={page.truncated} message={view === "board" ? TASK_CAP_NOTICE.board : TASK_CAP_NOTICE.list} />
            <CapNotice show={projects.truncated} message={TASK_CAP_NOTICE.projectOptions} />
            <CapNotice show={people.truncated} message={canCreate ? TASK_CAP_NOTICE.people : TASK_CAP_NOTICE.names} />
            {view === "board" ? (
              <TaskBoard tasks={page.items} nameOf={people.nameOf} />
            ) : !isManager && !filtered ? (
              <MyTasksList tasks={page.items} projectNameOf={projects.nameOf} />
            ) : page.items.length === 0 ? (
              <EmptyState title="No tasks">{filtered ? "No tasks match these filters." : null}</EmptyState>
            ) : (
              <TaskTable
                tasks={page.items}
                nameOf={people.nameOf}
                projectNameOf={projects.nameOf}
                showAssignee={isManager}
              />
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
