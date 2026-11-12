import {
  reminderTimes,
  type CreateMeetingRequest,
  type MeetingListQuery,
  type RespondRequest,
  type UpdateMeetingRequest,
} from "@crm/contracts/meetings";
import type { Database } from "@crm/database/client";
import type { AuthSession, Ctx, Executor, Tx } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { recordAudit } from "../audit/index.js";
import { projectExists } from "../projects/index.js";
import { MEETING_AUDIT, meetingTimes } from "./meetings.audit.js";
import * as policy from "./meetings.policy.js";
import * as repo from "./meetings.repository.js";
import type { MeetingRow } from "./meetings.repository.js";

type User = AuthSession["user"];

export interface MeetingDeps {
  db: Database;
  /** Wall-clock meeting times are entered and summarised in this time zone. */
  orgTimezone: string;
}

const MINUTE_MS = 60_000;

/** Every attendee must be an active team member other than the CEO/CTO (the organiser attends automatically). */
async function assertAttendees(db: Executor, ids: readonly string[]): Promise<void> {
  if ((await repo.activeNonAdminUserIds(db, ids)).length !== ids.length) {
    throw errors.validation("Attendees must be active team members other than the CEO/CTO");
  }
}

/** A referenced project must exist; a referenced task must belong to it. */
async function assertReference(db: Executor, projectId: string | null, taskId: string | null): Promise<void> {
  if (taskId !== null && projectId === null) throw errors.validation("A task reference needs its project");
  if (projectId !== null && !(await projectExists(db, projectId))) throw errors.validation("The project does not exist");
  if (taskId !== null && projectId !== null && !(await repo.taskInProject(db, taskId, projectId))) {
    throw errors.validation("The task does not belong to the project");
  }
}

function assertFutureStart(startsAt: Date): void {
  if (startsAt.getTime() <= Date.now()) throw errors.validation("A meeting cannot start in the past");
}

const assertChangeable = (meeting: MeetingRow) => {
  if (meeting.status === "cancelled") throw errors.conflict("A cancelled meeting cannot be changed");
  if (meeting.endsAt.getTime() <= Date.now()) throw errors.conflict("A meeting that has ended cannot be changed");
};

async function reload(tx: Tx, id: string, viewerId: string): Promise<MeetingRow> {
  const meeting = await repo.findMeeting(tx, id, viewerId);
  if (!meeting) throw new Error("Meeting not found after change");
  return meeting;
}

async function lockExisting(tx: Tx, id: string, viewerId: string): Promise<MeetingRow> {
  await repo.lockMeetingKey(tx, id);
  const meeting = await repo.lockMeeting(tx, id, viewerId);
  if (!meeting) throw errors.notFound();
  return meeting;
}

/** CEO only. The organiser is added as an attendee; reminders for times still ahead are queued. */
export async function createMeeting(deps: MeetingDeps, ctx: Ctx, user: User, input: CreateMeetingRequest): Promise<MeetingRow> {
  policy.assertCanManage(user);
  await assertAttendees(deps.db, input.attendeeIds);
  await assertReference(deps.db, input.projectId ?? null, input.taskId ?? null);
  const startsAt = await repo.localToUtc(deps.db, input.startsAtLocal, deps.orgTimezone);
  assertFutureStart(startsAt);
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * MINUTE_MS);

  return deps.db.transaction(async (tx) => {
    const id = await repo.insertMeeting(tx, {
      title: input.title,
      description: input.description,
      startsAt,
      endsAt,
      location: input.location ?? null,
      meetingUrl: input.meetingUrl ?? null,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      organizerId: user.id,
    });
    await repo.addAttendees(tx, id, [user.id, ...input.attendeeIds]);
    await repo.insertReminders(tx, id, 1, reminderTimes(startsAt, new Date()));
    const created = await reload(tx, id, user.id);
    await recordAudit(tx, ctx, {
      action: MEETING_AUDIT.created,
      entityType: "meeting",
      entityId: id,
      after: {
        ...meetingTimes(created),
        attendeeCount: input.attendeeIds.length + 1,
        projectId: created.projectId,
        taskId: created.taskId,
      },
    });
    return created;
  });
}

/**
 * CEO only, for scheduled meetings that have not ended. Rules (docs/adrs/0007-meetings-and-reminders.md):
 * attendee replacement keeps retained responses, adds new people as pending and soft-removes the rest;
 * a time change then resets every current response to pending and stamps responses_reset_at. Every edit
 * bumps the version and queues reminders for it; older reminder events become stale.
 */
export async function updateMeeting(
  deps: MeetingDeps,
  ctx: Ctx,
  user: User,
  id: string,
  input: UpdateMeetingRequest,
): Promise<MeetingRow> {
  policy.assertCanManage(user);
  if (input.attendeeIds !== undefined) await assertAttendees(deps.db, input.attendeeIds);
  const newStart = input.startsAtLocal === undefined ? undefined : await repo.localToUtc(deps.db, input.startsAtLocal, deps.orgTimezone);

  return deps.db.transaction(async (tx) => {
    const before = await lockExisting(tx, id, user.id);
    assertChangeable(before);

    // Times: keep the current duration when only the start moves, and the current start when only the duration changes.
    const startsAt = newStart ?? before.startsAt;
    const durationMs =
      input.durationMinutes === undefined ? before.endsAt.getTime() - before.startsAt.getTime() : input.durationMinutes * MINUTE_MS;
    const endsAt = new Date(startsAt.getTime() + durationMs);
    const timeChanged = startsAt.getTime() !== before.startsAt.getTime() || endsAt.getTime() !== before.endsAt.getTime();
    if (newStart !== undefined && timeChanged) assertFutureStart(startsAt);

    const projectId = input.projectId === undefined ? before.projectId : input.projectId;
    const taskId = input.taskId === undefined ? (input.projectId === null ? null : before.taskId) : input.taskId;
    if (input.projectId !== undefined || input.taskId !== undefined) await assertReference(tx, projectId, taskId);

    // Rule 3: replace attendees (the organiser always stays).
    let added: string[] = [];
    let removed: string[] = [];
    let retained = 0;
    if (input.attendeeIds !== undefined) {
      const current = (await repo.currentAttendees(tx, id)).map((attendee) => attendee.userId).filter((userId) => userId !== before.organizerId);
      const wanted = new Set(input.attendeeIds);
      added = input.attendeeIds.filter((userId) => !current.includes(userId));
      removed = current.filter((userId) => !wanted.has(userId));
      retained = current.length - removed.length;
      await repo.removeAttendees(tx, id, removed);
      await repo.addAttendees(tx, id, added);
    }

    await repo.updateMeeting(
      tx,
      id,
      {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.location === undefined ? {} : { location: input.location }),
        ...(input.meetingUrl === undefined ? {} : { meetingUrl: input.meetingUrl }),
        ...(input.projectId === undefined && input.taskId === undefined ? {} : { projectId, taskId }),
        ...(timeChanged ? { startsAt, endsAt } : {}),
      },
      timeChanged,
    );
    // Rule 1: a time change resets every current response; rule 2: other edits keep them.
    const responsesReset = timeChanged ? await repo.resetResponses(tx, id) : 0;

    const after = await reload(tx, id, user.id);
    await repo.insertReminders(tx, id, after.version, reminderTimes(after.startsAt, new Date()));
    await recordAudit(tx, ctx, {
      action: MEETING_AUDIT.updated,
      entityType: "meeting",
      entityId: id,
      before: meetingTimes(before),
      after: {
        ...meetingTimes(after),
        timeChanged,
        responsesReset,
        responsesResetAt: timeChanged && after.responsesResetAt ? after.responsesResetAt.toISOString() : null,
        attendeesAdded: added,
        attendeesRemoved: removed,
        attendeesRetained: retained,
        titleChanged: before.title !== after.title,
        descriptionChanged: before.description !== after.description,
        locationChanged: before.location !== after.location,
        meetingUrlChanged: before.meetingUrl !== after.meetingUrl,
      },
    });
    return after;
  });
}

/** CEO only. No new reminders: pending ones become stale because the version changes. */
export async function cancelMeeting(deps: MeetingDeps, ctx: Ctx, user: User, id: string): Promise<MeetingRow> {
  policy.assertCanManage(user);
  return deps.db.transaction(async (tx) => {
    const before = await lockExisting(tx, id, user.id);
    assertChangeable(before);
    await repo.cancelMeeting(tx, id);
    const after = await reload(tx, id, user.id);
    await recordAudit(tx, ctx, {
      action: MEETING_AUDIT.cancelled,
      entityType: "meeting",
      entityId: id,
      before: { status: before.status, version: before.version },
      after: { status: after.status, version: after.version },
    });
    return after;
  });
}

/** Current attendees only, while the meeting is scheduled and has not ended. */
export async function respond(deps: MeetingDeps, ctx: Ctx, user: User, id: string, input: RespondRequest): Promise<MeetingRow> {
  return deps.db.transaction(async (tx) => {
    const meeting = await lockExisting(tx, id, user.id);
    policy.assertCanRespond(user, meeting.viewerResponse !== null);
    assertChangeable(meeting);
    await repo.setResponse(tx, id, user.id, input.response);
    await recordAudit(tx, ctx, {
      action: MEETING_AUDIT.responded,
      entityType: "meeting",
      entityId: id,
      before: { response: meeting.viewerResponse },
      after: { response: input.response, version: meeting.version },
    });
    return reload(tx, id, user.id);
  });
}

export async function getMeeting(deps: MeetingDeps, user: User, id: string) {
  const meeting = await repo.findMeeting(deps.db, id, user.id);
  if (!meeting) throw errors.notFound();
  policy.assertCanView(user, meeting.viewerResponse !== null);
  return { meeting, attendees: await repo.currentAttendees(deps.db, id) };
}

export async function listMeetings(deps: MeetingDeps, user: User, query: MeetingListQuery) {
  const scope = policy.readScope(user);
  const rows = await repo.listMeetings(deps.db, {
    viewerId: user.id,
    invitedOnly: scope === "invited",
    from: query.from,
    to: query.to,
    status: query.status,
    cursor: query.cursor,
    limit: query.limit,
  });
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > query.limit && last ? last.id : null };
}

/** CEO only: exact counts and the next five meetings. */
export async function meetingSummary(deps: MeetingDeps, user: User) {
  policy.assertCanReadAll(user);
  const [counts, next] = await Promise.all([repo.summaryCounts(deps.db, deps.orgTimezone), repo.nextMeetings(deps.db, user.id, 5)]);
  return { counts, next };
}
