import { z } from "zod";
import { nextCursorSchema, paginationQuerySchema } from "./common.js";

export const MEETING_STATES = ["scheduled", "cancelled"] as const;
export const MEETING_RESPONSES = ["pending", "accepted", "declined"] as const;
/** In-app reminders, in minutes before the start. */
export const REMINDER_OFFSETS = [10, 5, 2] as const;

export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 720;
export const MAX_ATTENDEES = 50;
/** Longest range one list request may cover. */
export const MAX_RANGE_DAYS = 62;

export const meetingStateSchema = z.enum(MEETING_STATES);
export const meetingResponseSchema = z.enum(MEETING_RESPONSES);
export type MeetingState = z.infer<typeof meetingStateSchema>;
export type MeetingResponse = z.infer<typeof meetingResponseSchema>;
export type ReminderOffset = (typeof REMINDER_OFFSETS)[number];

const MINUTE_MS = 60_000;

/**
 * Reminder times for a meeting, newest offset last. Offsets whose time is not strictly after `now`
 * are skipped: nothing is ever sent late.
 */
export function reminderTimes(startsAt: Date, now: Date): { minutesBefore: ReminderOffset; at: Date }[] {
  return REMINDER_OFFSETS.map((minutesBefore) => ({ minutesBefore, at: new Date(startsAt.getTime() - minutesBefore * MINUTE_MS) })).filter(
    (reminder) => reminder.at.getTime() > now.getTime(),
  );
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** A wall-clock date and time ("YYYY-MM-DDTHH:MM") in the organisation's time zone. The API converts it. */
export const localDateTimeSchema = z.string().refine((value) => {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return false;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && h < 24 && mi < 60;
}, "Use YYYY-MM-DDTHH:MM");

const title = z.string().trim().min(1).max(200);
const description = z.string().trim().max(5000);
const location = z.string().trim().min(1).max(500);
/** A syntactically valid https:// URL; stored and returned only, never fetched by the server. */
const meetingUrl = z.url({ protocol: /^https$/ }).max(2000);
const duration = z.int().min(MIN_DURATION_MINUTES).max(MAX_DURATION_MINUTES);
const attendeeIds = z
  .array(z.uuid())
  .min(1)
  .max(MAX_ATTENDEES)
  .refine((ids) => new Set(ids).size === ids.length, "Attendees must be unique");

export const createMeetingRequestSchema = z
  .strictObject({
    title,
    description: description.default(""),
    startsAtLocal: localDateTimeSchema,
    durationMinutes: duration,
    location: location.optional(),
    meetingUrl: meetingUrl.optional(),
    projectId: z.uuid().optional(),
    taskId: z.uuid().optional(),
    attendeeIds,
  })
  .refine((value) => value.taskId === undefined || value.projectId !== undefined, {
    message: "A task reference needs its project",
    path: ["projectId"],
  });
export type CreateMeetingRequest = z.infer<typeof createMeetingRequestSchema>;

/** Partial edit. `null` clears an optional field; `attendeeIds` replaces the whole list. */
export const updateMeetingRequestSchema = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
    startsAtLocal: localDateTimeSchema.optional(),
    durationMinutes: duration.optional(),
    location: location.nullable().optional(),
    meetingUrl: meetingUrl.nullable().optional(),
    projectId: z.uuid().nullable().optional(),
    taskId: z.uuid().nullable().optional(),
    attendeeIds: attendeeIds.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: "Nothing to update" });
export type UpdateMeetingRequest = z.infer<typeof updateMeetingRequestSchema>;

export const respondRequestSchema = z.strictObject({ response: z.enum(["accepted", "declined"]) });
export type RespondRequest = z.infer<typeof respondRequestSchema>;

export const meetingListQuerySchema = paginationQuerySchema
  .extend({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    status: meetingStateSchema.optional(),
  })
  .refine(
    (value) => {
      const span = Date.parse(value.to) - Date.parse(value.from);
      return span > 0 && span <= MAX_RANGE_DAYS * 24 * 60 * MINUTE_MS;
    },
    { message: `The range must be positive and at most ${String(MAX_RANGE_DAYS)} days` },
  );
export type MeetingListQuery = z.infer<typeof meetingListQuerySchema>;

export const meetingSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  location: z.string().nullable(),
  meetingUrl: z.string().nullable(),
  projectId: z.uuid().nullable(),
  taskId: z.uuid().nullable(),
  status: meetingStateSchema,
  version: z.int().min(1),
  organizerId: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  cancelledAt: z.iso.datetime().nullable(),
  /** Set when a time change reset every current attendee's response to pending. */
  responsesResetAt: z.iso.datetime().nullable(),
  /** The viewer's own response, or null when the viewer is not a current attendee. */
  viewerResponse: meetingResponseSchema.nullable(),
});
export type Meeting = z.infer<typeof meetingSchema>;

export const attendeeSchema = z.strictObject({
  userId: z.uuid(),
  response: meetingResponseSchema,
  respondedAt: z.iso.datetime().nullable(),
});
export type Attendee = z.infer<typeof attendeeSchema>;

export const meetingResponseBodySchema = z.strictObject({ meeting: meetingSchema });
export const meetingDetailResponseSchema = z.strictObject({ meeting: meetingSchema, attendees: z.array(attendeeSchema) });
export type MeetingDetail = z.infer<typeof meetingDetailResponseSchema>;
export const meetingPageSchema = z.strictObject({ items: z.array(meetingSchema), nextCursor: nextCursorSchema });

const count = z.int().nonnegative();

/** Exact counts in the organisation's time zone. No presence, join or duration data exists. */
export const meetingSummarySchema = z.strictObject({
  counts: z.strictObject({
    today: count,
    thisWeek: count,
    cancelledLast7Days: count,
    heldLast30Days: count,
    upcomingAccepted: count,
    upcomingDeclined: count,
    upcomingPending: count,
  }),
  next: z.array(meetingSchema).max(5),
});
export type MeetingSummary = z.infer<typeof meetingSummarySchema>;

export const idParamsSchema = z.strictObject({ id: z.uuid() });
