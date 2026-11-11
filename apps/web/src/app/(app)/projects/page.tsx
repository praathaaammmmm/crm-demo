import { projectPageSchema } from "@crm/contracts/projects";
import { CapNotice } from "../../../components/CapNotice";
import { EmptyState } from "../../../components/EmptyState";
import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { CreateProjectDialog } from "../../../features/projects/CreateProjectDialog";
import { ProjectTable } from "../../../features/projects/ProjectTable";
import { canCreateProjects, canSeeProjects } from "../../../lib/navigation";
import { collectPages, dataOrForbidden } from "../../../lib/server-api";
import { requireAppSession } from "../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../lib/task-view";

export default async function ProjectsPage() {
  const { user } = await requireAppSession();
  const isCreator = canCreateProjects(user.role);
  const toolbar = <PageToolbar icon="folder" title="Projects" primaryAction={isCreator ? <CreateProjectDialog /> : undefined} />;
  if (!canSeeProjects(user.role)) {
    return (
      <>
        <PageToolbar icon="folder" title="Projects" />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  const page = dataOrForbidden(await collectPages("/projects", projectPageSchema));
  return (
    <>
      {toolbar}
      <PageContent>
        {page === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={page.truncated} message={TASK_CAP_NOTICE.projects} />
            {page.items.length === 0 ? (
              <EmptyState title={isCreator ? "No projects yet" : "No projects with your tasks"}>
                {isCreator ? "Create the first project to start assigning work." : null}
              </EmptyState>
            ) : (
              <ProjectTable projects={page.items} />
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
