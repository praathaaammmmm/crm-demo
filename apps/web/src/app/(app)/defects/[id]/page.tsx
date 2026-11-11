import { defectDetailResponseSchema } from "@crm/contracts/quality";
import { projectResponseSchema } from "@crm/contracts/projects";
import { taskResponseSchema } from "@crm/contracts/tasks";
import { notFound } from "next/navigation";
import { CapNotice } from "../../../../components/CapNotice";
import { NotAllowed } from "../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../components/PageToolbar";
import { DefectMetaRail } from "../../../../features/quality/DefectMetaRail";
import { DefectResponseComposer } from "../../../../features/quality/DefectResponseComposer";
import { DefectTimeline } from "../../../../features/quality/DefectTimeline";
import styles from "../../../../features/tasks/Rail.module.css";
import { defectActionsFor } from "../../../../lib/defect-actions";
import { canReadDirectory } from "../../../../lib/navigation";
import { loadPeople } from "../../../../lib/people";
import { isUuid } from "../../../../lib/search-params";
import { dataOrForbidden, serverGet } from "../../../../lib/server-api";
import { requireAppSession } from "../../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../../lib/task-view";

export default async function DefectPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAppSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  // Hidden or missing defects become notFound() inside dataOrForbidden.
  const detail = dataOrForbidden(await serverGet(`/defects/${id}`, defectDetailResponseSchema));
  const crumbs = [{ href: "/defects", label: "Defects" }];
  if (detail === "forbidden") {
    return (
      <>
        <PageToolbar icon="bug" title="Defect" breadcrumbs={crumbs} />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  const { defect } = detail;
  // Without directory access, other people on a defect are the quality team.
  const [people, task, project] = await Promise.all([
    loadPeople(user, "Quality team"),
    serverGet(`/tasks/${defect.taskId}`, taskResponseSchema),
    serverGet(`/projects/${defect.projectId}`, projectResponseSchema),
  ]);
  const actions = defectActionsFor({ role: user.role, viewerId: user.id, defect });

  return (
    <>
      <PageToolbar icon="bug" title={defect.title} breadcrumbs={crumbs} />
      <PageContent>
        <CapNotice show={people.truncated && canReadDirectory(user.role)} message={TASK_CAP_NOTICE.names} />
        <div className={styles.layout}>
          <div className={styles.work}>
            <section className={styles.panel} aria-labelledby="steps-heading">
              <h2 id="steps-heading" className={styles.panelTitle}>
                Reproduction steps
              </h2>
              <p className={styles.description}>{defect.reproductionSteps}</p>
            </section>
            <section className={styles.panel} aria-labelledby="activity-heading">
              <h2 id="activity-heading" className={styles.panelTitle}>
                Activity
              </h2>
              {actions.canRespond ? <DefectResponseComposer defectId={defect.id} /> : null}
              <div style={{ marginTop: actions.canRespond ? "var(--space-4)" : 0 }}>
                <DefectTimeline updates={detail.updates} actorName={people.nameOf} />
              </div>
            </section>
          </div>
          <DefectMetaRail
            defect={defect}
            actions={actions}
            assigneeName={people.nameOf(defect.assigneeId)}
            reporterName={people.nameOf(defect.reportedBy)}
            taskTitle={task.ok ? task.data.task.title : "Task"}
            projectName={project.ok ? project.data.project.name : "Project"}
          />
        </div>
      </PageContent>
    </>
  );
}
