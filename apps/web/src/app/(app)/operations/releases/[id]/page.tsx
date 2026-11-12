import { releaseDetailResponseSchema } from "@crm/contracts/operations";
import { notFound } from "next/navigation";
import { ActionForm } from "../../../../../components/ActionForm";
import { NotAllowed } from "../../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../../components/PageToolbar";
import { Pill } from "../../../../../components/Pill";
import styles from "../../../../../components/RecordPage.module.css";
import { growthTimeFormatter } from "../../../../../lib/growth-view";
import { canApproveOperations, canManageOperations, canSeeOperations } from "../../../../../lib/navigation";
import { ENVIRONMENT_LABELS, releaseActions, RELEASE_STATUS_LABELS } from "../../../../../lib/operations-view";
import { loadPeople } from "../../../../../lib/people";
import { isUuid } from "../../../../../lib/search-params";
import { dataOrForbidden, serverGet } from "../../../../../lib/server-api";
import { requireAppSession } from "../../../../../lib/session";

export default async function ReleasePage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAppSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = canSeeOperations(user.role) ? dataOrForbidden(await serverGet(`/operations/releases/${id}`, releaseDetailResponseSchema)) : "forbidden";
  if (detail === "forbidden") {
    return (
      <>
        <PageToolbar icon="list" title="Release" />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }
  const { release, checklist, decisions } = detail;
  const people = await loadPeople(user);
  const at = growthTimeFormatter();
  const manager = canManageOperations(user.role);
  const draft = release.status === "draft";
  const actions = releaseActions(release.environment, release.status, { manage: manager, approve: canApproveOperations(user.role) });
  const complete = checklist.length > 0 && checklist.every((item) => item.done);

  return (
    <>
      <PageToolbar icon="list" title={`${release.name} (${release.versionLabel})`} breadcrumbs={[{ href: "/operations/releases", label: "Releases" }]} />
      <PageContent>
        {actions.length > 0 || (manager && draft) ? (
          <div className={styles.actions}>
            {actions.map((action) => (
              <ActionForm
                key={action.to}
                label={action.label}
                title={`${action.label}?`}
                confirm={action.label}
                variant={action.danger ? "danger" : action.to === "approved" || action.to === "deployed" ? "primary" : "secondary"}
                path={`/operations/releases/${id}/decisions`}
                fixed={{ to: action.to }}
                fields={[{ name: "note", label: action.to === "rolled_back" ? "Rollback record" : "Note", kind: "textarea", required: action.needsNote, maxLength: 2000 }]}
              />
            ))}
            {manager && draft ? (
              <>
                <ActionForm label="Add checklist item" title="Add checklist item" confirm="Add" path={`/operations/releases/${id}/checklist`} fields={[{ name: "label", label: "Item", kind: "text", required: true, maxLength: 200 }]} />
                <ActionForm
                  label="Edit release"
                  title="Edit release"
                  confirm="Save"
                  method="PATCH"
                  path={`/operations/releases/${id}`}
                  fields={[
                    { name: "name", label: "Name", kind: "text", required: true, maxLength: 200, defaultValue: release.name },
                    { name: "versionLabel", label: "Version", kind: "text", required: true, maxLength: 64, defaultValue: release.versionLabel },
                    { name: "plannedFor", label: "Planned for", kind: "date", empty: "null", defaultValue: release.plannedFor ?? "" },
                    { name: "notes", label: "Notes", kind: "textarea", empty: "null", maxLength: 2000, defaultValue: release.notes ?? "" },
                  ]}
                />
              </>
            ) : null}
          </div>
        ) : null}
        {draft && !complete ? <p className={styles.muted}>Tick every checklist item before the release can leave draft.</p> : null}

        <dl className={styles.meta}>
          <dt>Environment</dt>
          <dd>{ENVIRONMENT_LABELS[release.environment]}</dd>
          <dt>Status</dt>
          <dd>
            <Pill>{RELEASE_STATUS_LABELS[release.status]}</Pill>
          </dd>
          <dt>Planned for</dt>
          <dd>{release.plannedFor ?? "—"}</dd>
          <dt>Notes</dt>
          <dd className={styles.prose}>{release.notes ?? "—"}</dd>
        </dl>

        <section className={styles.section} aria-labelledby="checklist-heading">
          <h2 id="checklist-heading" className={styles.sectionTitle}>
            {`Checklist (${String(release.checklistDone)}/${String(release.checklistTotal)})`}
          </h2>
          {checklist.length === 0 ? (
            <p className={styles.muted}>No checklist items yet.</p>
          ) : (
            <ul className={styles.history} aria-label="Release checklist">
              {checklist.map((item) => (
                <li key={item.id}>
                  <strong>{item.done ? `✓ ${item.label}` : `○ ${item.label}`}</strong>
                  {item.done && item.doneBy && item.doneAt ? <span className={styles.muted}>{` · ${people.nameOf(item.doneBy)} · ${at(item.doneAt)}`}</span> : null}
                  {manager && draft ? (
                    <>
                      {" "}
                      <ActionForm
                        label={item.done ? `Untick ${item.label}` : `Tick ${item.label}`}
                        title={item.done ? "Mark as not done?" : "Mark as done?"}
                        confirm="Confirm"
                        path={`/operations/checklist-items/${item.id}`}
                        fixed={{ done: !item.done }}
                      />
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby="decisions-heading">
          <h2 id="decisions-heading" className={styles.sectionTitle}>
            Decisions and outcomes
          </h2>
          {decisions.length === 0 ? (
            <p className={styles.muted}>No decisions recorded yet.</p>
          ) : (
            <ol className={styles.history} aria-label="Release decisions">
              {decisions.map((decision) => (
                <li key={decision.id}>
                  <strong>{`${RELEASE_STATUS_LABELS[decision.fromStatus]} → ${RELEASE_STATUS_LABELS[decision.toStatus]}`}</strong>
                  <span className={styles.muted}>{` · ${people.nameOf(decision.actorId)} · ${at(decision.createdAt)}`}</span>
                  {decision.note ? <div className={styles.prose}>{decision.note}</div> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </PageContent>
    </>
  );
}
