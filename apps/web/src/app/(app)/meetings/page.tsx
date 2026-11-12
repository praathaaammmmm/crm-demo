import { meetingPageSchema } from "@crm/contracts/meetings";
import { taskPageSchema } from "@crm/contracts/tasks";
import { CapNotice } from "../../../components/CapNotice";
import { EmptyState } from "../../../components/EmptyState";
import { NotAllowed } from "../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../components/PageToolbar";
import { MeetingAgenda } from "../../../features/meetings/MeetingAgenda";
import { MeetingFormDrawer } from "../../../features/meetings/MeetingFormDrawer";
import { MeetingToolbarControls, type MeetingFilterState } from "../../../features/meetings/MeetingToolbarControls";
import { MeetingWeek } from "../../../features/meetings/MeetingWeek";
import { addDays, dayRangeUtc, localDateKey, toLocalInput, weekStart } from "../../../lib/meeting-view";
import { canManageMeetings, canSeeMeetings } from "../../../lib/navigation";
import { orgTimeZone } from "../../../lib/org-time";
import { loadPeople, loadProjects } from "../../../lib/people";
import { readParam, type SearchParams } from "../../../lib/search-params";
import { collectPages, dataOrForbidden } from "../../../lib/server-api";
import { requireAppSession } from "../../../lib/session";
import { TASK_CAP_NOTICE } from "../../../lib/task-view";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_MS = 60 * 60 * 1000;

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user } = await requireAppSession();
  if (!canSeeMeetings(user.role)) {
    return (
      <>
        <PageToolbar icon="calendar" title="Meetings" />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }

  const timeZone = orgTimeZone();
  const query = await searchParams;
  const today = localDateKey(Date.now(), timeZone);
  const thisWeek = weekStart(today);
  const requestedWeek = readParam(query, "week");
  const state: MeetingFilterState = {
    view: readParam(query, "view") === "week" ? "week" : "agenda",
    week: requestedWeek !== undefined && DAY_KEY.test(requestedWeek) ? weekStart(requestedWeek) : thisWeek,
    status: readParam(query, "status") === "cancelled" ? "cancelled" : "scheduled",
  };

  // Week: every meeting in the shown week. Agenda: upcoming meetings for 60 days, or cancelled ones around today.
  const range =
    state.view === "week"
      ? dayRangeUtc(state.week, 7, timeZone)
      : state.status === "scheduled"
        ? dayRangeUtc(today, 60, timeZone)
        : dayRangeUtc(addDays(today, -30), 60, timeZone);
  const params: Record<string, string> = { from: range.from, to: range.to };
  if (state.view === "agenda") params["status"] = state.status;

  const isManager = canManageMeetings(user.role);
  const [meetings, people, projects, tasks] = await Promise.all([
    collectPages("/meetings", meetingPageSchema, params),
    isManager ? loadPeople(user) : Promise.resolve(null),
    isManager ? loadProjects() : Promise.resolve(null),
    isManager ? collectPages("/tasks", taskPageSchema) : Promise.resolve(null),
  ]);
  const page = dataOrForbidden(meetings);
  // Agenda "upcoming" hides meetings that have already ended today.
  const items =
    page === "forbidden" ? [] : state.view === "agenda" && state.status === "scheduled" ? page.items.filter((m) => Date.parse(m.endsAt) > Date.now()) : page.items;
  const nextHour = Math.ceil(Date.now() / HOUR_MS) * HOUR_MS;

  return (
    <>
      <PageToolbar
        icon="calendar"
        title="Meetings"
        controls={<MeetingToolbarControls state={state} thisWeek={thisWeek} />}
        primaryAction={
          isManager && people && projects ? (
            <MeetingFormDrawer
              people={people.assignees}
              projects={projects.list}
              tasks={tasks?.ok ? tasks.data.items.map((task) => ({ id: task.id, title: task.title, projectId: task.projectId })) : []}
              defaultStart={toLocalInput(nextHour, timeZone)}
            />
          ) : undefined
        }
      />
      <PageContent>
        {page === "forbidden" ? (
          <NotAllowed />
        ) : (
          <>
            <CapNotice show={page.truncated} message={TASK_CAP_NOTICE.meetings} />
            <CapNotice show={people?.truncated ?? false} message={TASK_CAP_NOTICE.people} />
            {state.view === "week" ? (
              <MeetingWeek meetings={items} timeZone={timeZone} start={state.week} />
            ) : items.length === 0 ? (
              <EmptyState title={state.status === "cancelled" ? "No cancelled meetings" : "No upcoming meetings"}>
                {isManager && state.status === "scheduled" ? "Schedule a meeting to invite your team." : null}
              </EmptyState>
            ) : (
              <MeetingAgenda meetings={items} timeZone={timeZone} />
            )}
          </>
        )}
      </PageContent>
    </>
  );
}
