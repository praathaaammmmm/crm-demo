import { meetingDetailResponseSchema } from "@crm/contracts/meetings";
import { projectResponseSchema } from "@crm/contracts/projects";
import { taskPageSchema, taskResponseSchema } from "@crm/contracts/tasks";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "../../../../components/Avatar";
import { CapNotice } from "../../../../components/CapNotice";
import { NotAllowed } from "../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../components/PageToolbar";
import { MeetingFormDrawer } from "../../../../features/meetings/MeetingFormDrawer";
import { ResponsePill } from "../../../../features/meetings/MeetingPills";
import { MeetingRail } from "../../../../features/meetings/MeetingRail";
import styles from "../../../../features/meetings/Meetings.module.css";
import rail from "../../../../features/tasks/Rail.module.css";
import { meetingActionsFor } from "../../../../lib/meeting-actions";
import { toLocalInput } from "../../../../lib/meeting-view";
import { canManageMeetings, canReadDirectory } from "../../../../lib/navigation";
import { orgTimeZone } from "../../../../lib/org-time";
import { loadPeople, loadProjects } from "../../../../lib/people";
import { isUuid } from "../../../../lib/search-params";
import { collectPages, dataOrForbidden, serverGet } from "../../../../lib/server-api";
import { requireAppSession } from "../../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../../lib/task-view";

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAppSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  // Meetings the viewer is not invited to become notFound() inside dataOrForbidden.
  const detail = dataOrForbidden(await serverGet(`/meetings/${id}`, meetingDetailResponseSchema));
  const crumbs = [{ href: "/meetings", label: "Meetings" }];
  if (detail === "forbidden") {
    return (
      <>
        <PageToolbar icon="calendar" title="Meeting" breadcrumbs={crumbs} />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  const { meeting, attendees } = detail;
  const timeZone = orgTimeZone();
  const isManager = canManageMeetings(user.role);
  const [people, project, task, projects, tasks] = await Promise.all([
    loadPeople(user, "Team member"),
    meeting.projectId ? serverGet(`/projects/${meeting.projectId}`, projectResponseSchema) : Promise.resolve(null),
    meeting.taskId ? serverGet(`/tasks/${meeting.taskId}`, taskResponseSchema) : Promise.resolve(null),
    isManager ? loadProjects() : Promise.resolve(null),
    isManager ? collectPages("/tasks", taskPageSchema) : Promise.resolve(null),
  ]);
  const actions = meetingActionsFor({ role: user.role, meeting });

  // A reference is a link only when the viewer may open it; otherwise it is named generically.
  const reference = task?.ok ? (
    <Link href={`/tasks/${task.data.task.id}`}>{task.data.task.title}</Link>
  ) : project?.ok ? (
    <Link href={`/projects/${project.data.project.id}`}>{project.data.project.name}</Link>
  ) : meeting.projectId ? (
    "Linked item"
  ) : null;

  const editAction =
    isManager && projects ? (
      <MeetingFormDrawer
        people={people.assignees}
        projects={projects.list}
        tasks={tasks?.ok ? tasks.data.items.map((t) => ({ id: t.id, title: t.title, projectId: t.projectId })) : []}
        defaultStart={toLocalInput(meeting.startsAt, timeZone)}
        initial={{
          meeting,
          startsAtLocal: toLocalInput(meeting.startsAt, timeZone),
          durationMinutes: Math.round((Date.parse(meeting.endsAt) - Date.parse(meeting.startsAt)) / 60_000),
          attendeeIds: attendees.map((attendee) => attendee.userId).filter((userId) => userId !== meeting.organizerId),
        }}
      />
    ) : null;

  return (
    <>
      <PageToolbar icon="calendar" title={meeting.title} breadcrumbs={crumbs} />
      <PageContent>
        <CapNotice show={people.truncated && canReadDirectory(user.role)} message={TASK_CAP_NOTICE.names} />
        <div className={rail.layout}>
          <div className={rail.work}>
            <section className={rail.panel} aria-labelledby="description-heading">
              <h2 id="description-heading" className={rail.panelTitle}>
                Description
              </h2>
              {meeting.description.length > 0 ? (
                <p className={rail.description}>{meeting.description}</p>
              ) : (
                <p className={rail.muted}>No description.</p>
              )}
            </section>
            <section className={rail.panel} aria-labelledby="attendees-heading">
              <h2 id="attendees-heading" className={rail.panelTitle}>
                Attendees ({String(attendees.length)})
              </h2>
              <ul className={styles.attendees} aria-label="Attendees">
                {attendees.map((attendee) => {
                  const name = attendee.userId === meeting.organizerId && attendee.userId !== user.id ? "CEO/CTO" : people.nameOf(attendee.userId);
                  return (
                    <li key={attendee.userId} className={styles.attendee}>
                      <span className={styles.person}>
                        <Avatar name={name} size="xs" />
                        {name}
                        {attendee.userId === meeting.organizerId ? <span className={rail.muted}>(organiser)</span> : null}
                      </span>
                      <ResponsePill response={attendee.response} />
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
          <MeetingRail
            meeting={meeting}
            actions={actions}
            timeZone={timeZone}
            organizerName={meeting.organizerId === user.id ? "You" : "CEO/CTO"}
            reference={reference}
            editAction={editAction}
          />
        </div>
      </PageContent>
    </>
  );
}
