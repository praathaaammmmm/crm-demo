import { describe, expect, it } from "vitest";
import { meetingActionsFor } from "./meeting-actions";

const NOW = Date.parse("2026-11-20T10:00:00.000Z");
const upcoming = { status: "scheduled" as const, endsAt: "2026-11-20T12:00:00.000Z", viewerResponse: "pending" as const, responsesResetAt: null };

describe("meetingActionsFor", () => {
  it("lets the CEO edit and cancel scheduled meetings that have not ended", () => {
    expect(meetingActionsFor({ role: "ceo_cto", meeting: upcoming, now: NOW })).toMatchObject({ canEdit: true, canCancel: true, canRespond: true });
    expect(meetingActionsFor({ role: "ceo_cto", meeting: { ...upcoming, status: "cancelled" }, now: NOW })).toMatchObject({
      canEdit: false,
      canCancel: false,
      readOnly: true,
    });
  });

  it("lets invitees respond only while scheduled and not ended; never to edit", () => {
    expect(meetingActionsFor({ role: "employee", meeting: upcoming, now: NOW })).toMatchObject({ canEdit: false, canCancel: false, canRespond: true });
    expect(meetingActionsFor({ role: "employee", meeting: { ...upcoming, endsAt: "2026-11-20T09:00:00.000Z" }, now: NOW })).toMatchObject({
      canRespond: false,
      ended: true,
    });
    expect(meetingActionsFor({ role: "employee", meeting: { ...upcoming, status: "cancelled" }, now: NOW }).canRespond).toBe(false);
    expect(meetingActionsFor({ role: "cfo", meeting: { ...upcoming, viewerResponse: null }, now: NOW }).canRespond).toBe(false);
  });

  it("shows the reset notice only when responsesResetAt is set on a scheduled meeting", () => {
    const reset = { ...upcoming, responsesResetAt: "2026-11-20T09:30:00.000Z" };
    expect(meetingActionsFor({ role: "employee", meeting: upcoming, now: NOW }).showResetNotice).toBe(false);
    expect(meetingActionsFor({ role: "employee", meeting: reset, now: NOW }).showResetNotice).toBe(true);
    expect(meetingActionsFor({ role: "employee", meeting: { ...reset, status: "cancelled" }, now: NOW }).showResetNotice).toBe(false);
  });
});
