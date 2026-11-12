import { automationAcceptsRuns, automationDetailResponseSchema, automationEditable, RUN_OUTCOMES, type AutomationRun } from "@crm/contracts/operations";
import { notFound } from "next/navigation";
import { ActionForm } from "../../../../../components/ActionForm";
import { DataTable } from "../../../../../components/DataTable";
import { NotAllowed } from "../../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../../components/PageToolbar";
import { Pill } from "../../../../../components/Pill";
import styles from "../../../../../components/RecordPage.module.css";
import { growthTimeFormatter } from "../../../../../lib/growth-view";
import { canApproveOperations, canManageOperations, canSeeOperations } from "../../../../../lib/navigation";
import { automationActions, AUTOMATION_STATUS_LABELS, HEALTH_LABELS } from "../../../../../lib/operations-view";
import { loadPeople } from "../../../../../lib/people";
import { isUuid } from "../../../../../lib/search-params";
import { dataOrForbidden, serverGet } from "../../../../../lib/server-api";
import { requireAppSession } from "../../../../../lib/session";

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAppSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = canSeeOperations(user.role) ? dataOrForbidden(await serverGet(`/operations/automations/${id}`, automationDetailResponseSchema)) : "forbidden";
  if (detail === "forbidden") {
    return (
      <>
        <PageToolbar icon="board" title="Automation" />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }
  const { automation, runs, changes } = detail;
  const people = await loadPeople(user);
  const at = growthTimeFormatter();
  const manager = canManageOperations(user.role);
  const actions = automationActions(automation.status, { manage: manager, approve: canApproveOperations(user.role) });

  return (
    <>
      <PageToolbar icon="board" title={automation.name} breadcrumbs={[{ href: "/operations/automations", label: "Automations" }]} />
      <PageContent>
        <div className={styles.actions}>
          {actions.map((action) => (
            <ActionForm
              key={action.to}
              label={action.label}
              title={`${action.label}?`}
              confirm={action.label}
              variant={action.danger ? "danger" : action.to === "live" ? "primary" : "secondary"}
              path={`/operations/automations/${id}/status`}
              fixed={{ to: action.to }}
              fields={[{ name: "note", label: "Note", kind: "textarea", required: action.needsNote, maxLength: 1000 }]}
            />
          ))}
          {manager && automationAcceptsRuns(automation.status) ? (
            <ActionForm
              label="Record run"
              title="Record a run"
              confirm="Record run"
              path={`/operations/automations/${id}/runs`}
              fields={[
                { name: "startedAt", label: "Started at", kind: "datetime", required: true },
                { name: "finishedAt", label: "Finished at", kind: "datetime", required: true },
                { name: "outcome", label: "Outcome", kind: "select", required: true, options: RUN_OUTCOMES.map((value) => ({ value, label: value === "failed" ? "Failed" : "Succeeded" })) },
                {
                  name: "errorSummary",
                  label: "Error summary",
                  kind: "text",
                  maxLength: 300,
                  hint: "Failed runs only. One short line: no links, secrets or stack traces.",
                },
              ]}
            />
          ) : null}
          {manager && automationEditable(automation.status) ? (
            <ActionForm
              label="Edit automation"
              title="Edit automation"
              confirm="Save"
              method="PATCH"
              path={`/operations/automations/${id}`}
              fields={[
                { name: "name", label: "Name", kind: "text", required: true, maxLength: 200, defaultValue: automation.name },
                { name: "purpose", label: "Purpose", kind: "textarea", required: true, maxLength: 1000, defaultValue: automation.purpose },
                { name: "trigger", label: "Trigger or schedule", kind: "text", required: true, maxLength: 200, defaultValue: automation.trigger },
              ]}
            />
          ) : null}
        </div>

        <dl className={styles.meta}>
          <dt>Status</dt>
          <dd>
            <Pill>{AUTOMATION_STATUS_LABELS[automation.status]}</Pill>
          </dd>
          <dt>Health</dt>
          <dd>{HEALTH_LABELS[automation.health]}</dd>
          <dt>Last run</dt>
          <dd>{automation.lastRunAt ? at(automation.lastRunAt) : "—"}</dd>
          <dt>Failures (30 days)</dt>
          <dd>{String(automation.failuresLast30Days)}</dd>
          <dt>Trigger</dt>
          <dd>{automation.trigger}</dd>
          <dt>Purpose</dt>
          <dd className={styles.prose}>{automation.purpose}</dd>
        </dl>

        <section className={styles.section} aria-labelledby="runs-heading">
          <h2 id="runs-heading" className={styles.sectionTitle}>
            Recent runs
          </h2>
          {runs.length === 0 ? (
            <p className={styles.muted}>No runs recorded.</p>
          ) : (
            <DataTable<AutomationRun>
              caption="Recent runs"
              rowKey={(row) => row.id}
              rows={runs}
              columns={[
                { key: "finished", header: "Finished", render: (row) => at(row.finishedAt) },
                { key: "outcome", header: "Outcome", render: (row) => <Pill>{row.outcome === "failed" ? "Failed" : "Succeeded"}</Pill> },
                { key: "error", header: "Error summary", render: (row) => row.errorSummary ?? "—" },
                { key: "by", header: "Recorded by", render: (row) => people.nameOf(row.recordedBy) },
              ]}
            />
          )}
        </section>

        <section className={styles.section} aria-labelledby="changes-heading">
          <h2 id="changes-heading" className={styles.sectionTitle}>
            Lifecycle
          </h2>
          {changes.length === 0 ? (
            <p className={styles.muted}>No lifecycle changes yet.</p>
          ) : (
            <ol className={styles.history} aria-label="Automation lifecycle">
              {changes.map((change) => (
                <li key={change.id}>
                  <strong>{`${AUTOMATION_STATUS_LABELS[change.fromStatus]} → ${AUTOMATION_STATUS_LABELS[change.toStatus]}`}</strong>
                  <span className={styles.muted}>{` · ${people.nameOf(change.actorId)} · ${at(change.createdAt)}`}</span>
                  {change.note ? <div className={styles.prose}>{change.note}</div> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </PageContent>
    </>
  );
}
