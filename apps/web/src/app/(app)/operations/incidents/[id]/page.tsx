import { incidentDetailResponseSchema, INCIDENT_SEVERITIES } from "@crm/contracts/operations";
import { notFound } from "next/navigation";
import { ActionForm } from "../../../../../components/ActionForm";
import { NotAllowed } from "../../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../../components/PageToolbar";
import { Pill } from "../../../../../components/Pill";
import styles from "../../../../../components/RecordPage.module.css";
import { growthTimeFormatter } from "../../../../../lib/growth-view";
import { canManageOperations, canSeeOperations } from "../../../../../lib/navigation";
import { incidentMoveTargets, INCIDENT_STATUS_LABELS, SEVERITY_LABELS } from "../../../../../lib/operations-view";
import { loadPeople } from "../../../../../lib/people";
import { isUuid } from "../../../../../lib/search-params";
import { dataOrForbidden, serverGet } from "../../../../../lib/server-api";
import { requireAppSession } from "../../../../../lib/session";

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAppSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = canSeeOperations(user.role) ? dataOrForbidden(await serverGet(`/operations/incidents/${id}`, incidentDetailResponseSchema)) : "forbidden";
  if (detail === "forbidden") {
    return (
      <>
        <PageToolbar icon="alert" title="Incident" />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }
  const { incident, timeline } = detail;
  const people = await loadPeople(user);
  const at = growthTimeFormatter();
  const manager = canManageOperations(user.role);
  const resolved = incident.status === "resolved";
  const base = `/operations/incidents/${id}`;

  return (
    <>
      <PageToolbar icon="alert" title={incident.title} breadcrumbs={[{ href: "/operations/incidents", label: "Incidents" }]} />
      <PageContent>
        {manager ? (
          <div className={styles.actions}>
            {incidentMoveTargets(incident.status).map((to) => (
              <ActionForm
                key={to}
                label={`Mark ${INCIDENT_STATUS_LABELS[to].toLowerCase()}`}
                title={`Mark ${INCIDENT_STATUS_LABELS[to].toLowerCase()}`}
                confirm="Confirm"
                path={`${base}/status`}
                fixed={{ to }}
                fields={[{ name: "note", label: "Note", kind: "textarea", maxLength: 2000 }]}
              />
            ))}
            {!resolved ? (
              <>
                <ActionForm
                  label="Resolve"
                  title="Resolve incident"
                  confirm="Resolve"
                  variant="primary"
                  path={`${base}/status`}
                  fixed={{ to: "resolved" }}
                  fields={[
                    { name: "resolution", label: "Resolution", kind: "textarea", required: true, maxLength: 2000 },
                    { name: "note", label: "Timeline note", kind: "textarea", maxLength: 2000 },
                  ]}
                />
                <ActionForm label="Add note" title="Add a timeline note" confirm="Add note" path={`${base}/notes`} fields={[{ name: "note", label: "Note", kind: "textarea", required: true, maxLength: 2000 }]} />
                <ActionForm
                  label="Edit incident"
                  title="Edit incident"
                  confirm="Save"
                  method="PATCH"
                  path={base}
                  fields={[
                    { name: "title", label: "Title", kind: "text", required: true, maxLength: 200, defaultValue: incident.title },
                    {
                      name: "severity",
                      label: "Severity",
                      kind: "select",
                      required: true,
                      defaultValue: incident.severity,
                      options: INCIDENT_SEVERITIES.map((value) => ({ value, label: SEVERITY_LABELS[value] })),
                    },
                    {
                      name: "ownerId",
                      label: "Owner",
                      kind: "select",
                      required: true,
                      defaultValue: incident.ownerId,
                      options: [
                        { value: incident.ownerId, label: people.nameOf(incident.ownerId) },
                        ...people.assignees.filter((p) => p.id !== incident.ownerId).map((p) => ({ value: p.id, label: p.name })),
                      ],
                    },
                    { name: "summary", label: "Summary", kind: "textarea", empty: "null", maxLength: 2000, defaultValue: incident.summary ?? "" },
                  ]}
                />
              </>
            ) : incident.postIncidentNote === null ? (
              <ActionForm
                label="Add post-incident note"
                title="Post-incident note"
                confirm="Save note"
                variant="primary"
                path={`${base}/post-incident`}
                fields={[{ name: "note", label: "What we learned and will change", kind: "textarea", required: true, maxLength: 5000, hint: "Written once." }]}
              />
            ) : null}
          </div>
        ) : null}

        <dl className={styles.meta}>
          <dt>Severity</dt>
          <dd>
            <Pill>{SEVERITY_LABELS[incident.severity]}</Pill>
          </dd>
          <dt>Status</dt>
          <dd>{INCIDENT_STATUS_LABELS[incident.status]}</dd>
          <dt>Owner</dt>
          <dd>{people.nameOf(incident.ownerId)}</dd>
          <dt>Started</dt>
          <dd>{at(incident.startedAt)}</dd>
          <dt>Resolved</dt>
          <dd>{incident.resolvedAt ? at(incident.resolvedAt) : "—"}</dd>
          <dt>Summary</dt>
          <dd className={styles.prose}>{incident.summary ?? "—"}</dd>
          <dt>Resolution</dt>
          <dd className={styles.prose}>{incident.resolution ?? "—"}</dd>
          <dt>Post-incident note</dt>
          <dd className={styles.prose}>{incident.postIncidentNote ?? "—"}</dd>
        </dl>

        <section className={styles.section} aria-labelledby="timeline-heading">
          <h2 id="timeline-heading" className={styles.sectionTitle}>
            Timeline
          </h2>
          {timeline.length === 0 ? (
            <p className={styles.muted}>No updates yet.</p>
          ) : (
            <ol className={styles.history} aria-label="Incident timeline">
              {timeline.map((entry) => (
                <li key={entry.id}>
                  <strong>
                    {entry.kind === "status" && entry.fromStatus && entry.toStatus
                      ? `${INCIDENT_STATUS_LABELS[entry.fromStatus]} → ${INCIDENT_STATUS_LABELS[entry.toStatus]}`
                      : "Note"}
                  </strong>
                  <span className={styles.muted}>{` · ${people.nameOf(entry.actorId)} · ${at(entry.createdAt)}`}</span>
                  {entry.note ? <div className={styles.prose}>{entry.note}</div> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </PageContent>
    </>
  );
}
