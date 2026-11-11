import { defectPageSchema, defectSeveritySchema, defectStatusSchema } from "@crm/contracts/quality";
import { taskPageSchema } from "@crm/contracts/tasks";
import { CapNotice } from "../../../components/CapNotice";
import { EmptyState } from "../../../components/EmptyState";
import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { DefectFilters, type DefectFilterState } from "../../../features/quality/DefectFilters";
import { DefectTable } from "../../../features/quality/DefectTable";
import { ReportDefectDialog } from "../../../features/quality/ReportDefectDialog";
import { canManageQuality, canSeeDefects, canSeeQuality } from "../../../lib/navigation";
import { loadPeople, loadProjects } from "../../../lib/people";
import { isUuid, readParam, type SearchParams } from "../../../lib/search-params";
import { collectPages, dataOrForbidden } from "../../../lib/server-api";
import { requireAppSession } from "../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../lib/task-view";

export default async function DefectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  if (!canSeeDefects(user.role)) {
    return (
      <>
        <PageToolbar icon="bug" title="Defects" />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  const query = await searchParams;
  const projectParam = readParam(query, "project");
  const state: DefectFilterState = {
    project: isUuid(projectParam) ? projectParam : undefined,
    severity: defectSeveritySchema.safeParse(readParam(query, "severity")).data,
    status: defectStatusSchema.safeParse(readParam(query, "status")).data,
    open: readParam(query, "open") === "true",
  };
  const apiParams: Record<string, string> = {};
  if (state.project !== undefined) apiParams["projectId"] = state.project;
  if (state.severity !== undefined) apiParams["severity"] = state.severity;
  if (state.status !== undefined) apiParams["status"] = state.status;
  if (state.open) apiParams["open"] = "true";

  const isManager = canManageQuality(user.role);
  const [defects, people, projects, tasks] = await Promise.all([
    collectPages("/defects", defectPageSchema, apiParams),
    loadPeople(user, "Team member"),
    loadProjects(),
    isManager ? collectPages("/tasks", taskPageSchema) : Promise.resolve(null),
  ]);
  const page = dataOrForbidden(defects);
  // Self-QA conflict: a manager cannot report defects on their own tasks.
  const taskOptions = tasks?.ok
    ? tasks.data.items.filter((task) => task.assigneeId !== user.id).map((task) => ({ id: task.id, title: task.title }))
    : [];
  const filtered = state.project !== undefined || state.severity !== undefined || state.status !== undefined || state.open;

  return (
    <>
      <PageToolbar
        icon="bug"
        title="Defects"
        controls={<DefectFilters state={state} projects={projects.list} />}
        primaryAction={isManager ? <ReportDefectDialog tasks={taskOptions} /> : undefined}
      />
      <PageContent>
        {page === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={page.truncated} message={TASK_CAP_NOTICE.defects} />
            <CapNotice show={projects.truncated} message={TASK_CAP_NOTICE.projectOptions} />
            <CapNotice show={people.truncated} message={TASK_CAP_NOTICE.names} />
            <CapNotice show={tasks?.ok === true && tasks.data.truncated} message={TASK_CAP_NOTICE.taskOptions} />
            {page.items.length === 0 ? (
              <EmptyState title="No defects">{filtered ? "No defects match these filters." : null}</EmptyState>
            ) : (
              <DefectTable
                defects={page.items}
                nameOf={people.nameOf}
                projectNameOf={projects.nameOf}
                showAssignee={canSeeQuality(user.role)}
              />
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
