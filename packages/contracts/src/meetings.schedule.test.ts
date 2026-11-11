import { describe, expect, it } from "vitest";
import {
  createMeetingRequestSchema,
  localDateTimeSchema,
  meetingListQuerySchema,
  reminderTimes,
  REMINDER_OFFSETS,
  updateMeetingRequestSchema,
} from "./meetings.js";
import { reminderState } from "./notifications.js";

const ATTENDEE = "11111111-1111-7111-8111-111111111111";
const START = new Date("2026-11-20T10:00:00.000Z");

describe("reminderTimes", () => {
  it("uses 10, 5 and 2 minutes before the start", () => {
    expect([...REMINDER_OFFSETS]).toEqual([10, 5, 2]);
    expect(reminderTimes(START, new Date("2026-11-20T09:00:00.000Z")).map((r) => [r.minutesBefore, r.at.toISOString()])).toEqual([
      [10, "2026-11-20T09:50:00.000Z"],
      [5, "2026-11-20T09:55:00.000Z"],
      [2, "2026-11-20T09:58:00.000Z"],
    ]);
  });

  it("skips reminder times that are not strictly in the future", () => {
    expect(reminderTimes(START, new Date("2026-11-20T09:54:00.000Z")).map((r) => r.minutesBefore)).toEqual([5, 2]);
    expect(reminderTimes(START, new Date("2026-11-20T09:55:00.000Z")).map((r) => r.minutesBefore)).toEqual([2]);
    expect(reminderTimes(START, new Date("2026-11-20T09:59:00.000Z"))).toEqual([]);
  });
});

describe("meeting request contracts", () => {
  const base = { title: "Planning", startsAtLocal: "2026-11-20T15:30", durationMinutes: 30, attendeeIds: [ATTENDEE] };

  it("accepts only real wall-clock date-times without seconds or offsets", () => {
    expect(localDateTimeSchema.safeParse("2026-11-20T15:30").success).toBe(true);
    for (const bad of ["2026-02-30T10:00", "2026-11-20T24:00", "2026-11-20T15:30:00", "2026-11-20T15:30Z", "tomorrow"]) {
      expect(localDateTimeSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("bounds duration, requires unique attendees and https links", () => {
    expect(createMeetingRequestSchema.safeParse(base).success).toBe(true);
    expect(createMeetingRequestSchema.safeParse({ ...base, durationMinutes: 4 }).success).toBe(false);
    expect(createMeetingRequestSchema.safeParse({ ...base, durationMinutes: 721 }).success).toBe(false);
    expect(createMeetingRequestSchema.safeParse({ ...base, attendeeIds: [] }).success).toBe(false);
    expect(createMeetingRequestSchema.safeParse({ ...base, attendeeIds: [ATTENDEE, ATTENDEE] }).success).toBe(false);
    expect(createMeetingRequestSchema.safeParse({ ...base, meetingUrl: "http://example.test/call" }).success).toBe(false);
    expect(createMeetingRequestSchema.safeParse({ ...base, meetingUrl: "https://example.test/call" }).success).toBe(true);
  });

  it("requires a project with a task reference, and at least one field to update", () => {
    expect(createMeetingRequestSchema.safeParse({ ...base, taskId: ATTENDEE }).success).toBe(false);
    expect(updateMeetingRequestSchema.safeParse({}).success).toBe(false);
    expect(updateMeetingRequestSchema.safeParse({ location: null }).success).toBe(true);
  });

  it("limits list ranges to 62 days", () => {
    const from = "2026-11-01T00:00:00.000Z";
    expect(meetingListQuerySchema.safeParse({ from, to: "2027-01-02T00:00:00.000Z" }).success).toBe(true);
    expect(meetingListQuerySchema.safeParse({ from, to: "2027-01-03T00:00:00.001Z" }).success).toBe(false);
    expect(meetingListQuerySchema.safeParse({ from, to: from }).success).toBe(false);
  });
});

describe("reminderState", () => {
  const meeting = { title: "x", startsAt: START.toISOString(), status: "scheduled" as const, version: 2 };
  it("marks reminders for older versions as rescheduled and cancelled meetings as cancelled", () => {
    expect(reminderState({ meetingVersion: 2, meeting })).toBe("current");
    expect(reminderState({ meetingVersion: 1, meeting })).toBe("rescheduled");
    expect(reminderState({ meetingVersion: 2, meeting: { ...meeting, status: "cancelled" } })).toBe("cancelled");
    expect(reminderState({ meetingVersion: 2, meeting: null })).toBe("unavailable");
  });
});
