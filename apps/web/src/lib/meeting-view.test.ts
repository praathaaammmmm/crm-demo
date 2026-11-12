import { describe, expect, it } from "vitest";
import {
  addDays,
  dayRangeUtc,
  groupAgenda,
  localDateKey,
  localToUtc,
  timeRangeLabel,
  toLocalInput,
  weekCells,
  weekStart,
} from "./meeting-view";

const KOLKATA = "Asia/Kolkata";
const NEW_YORK = "America/New_York";

describe("meeting-view", () => {
  it("converts between UTC instants and local wall-clock times", () => {
    expect(localToUtc("2026-11-20T10:00", KOLKATA)).toBe("2026-11-20T04:30:00.000Z");
    expect(toLocalInput("2026-11-20T04:30:00.000Z", KOLKATA)).toBe("2026-11-20T10:00");
    // Across a daylight-saving change (New York leaves DST on 2026-11-01).
    expect(localToUtc("2026-11-01T12:00", NEW_YORK)).toBe("2026-11-01T17:00:00.000Z");
    expect(localToUtc("2026-10-31T12:00", NEW_YORK)).toBe("2026-10-31T16:00:00.000Z");
  });

  it("puts late-evening UTC meetings on the next local day", () => {
    expect(localDateKey("2026-11-20T19:00:00.000Z", KOLKATA)).toBe("2026-11-21");
    expect(localDateKey("2026-11-20T18:29:00.000Z", KOLKATA)).toBe("2026-11-20");
  });

  it("starts weeks on Monday and covers whole local days", () => {
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // Sunday → Monday
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(dayRangeUtc("2026-11-16", 7, KOLKATA)).toEqual({ from: "2026-11-15T18:30:00.000Z", to: "2026-11-22T18:30:00.000Z" });
  });

  it("groups the agenda by local day and fills week cells in API order", () => {
    const meetings = [
      { id: "a", startsAt: "2026-11-16T04:30:00.000Z" },
      { id: "b", startsAt: "2026-11-16T09:00:00.000Z" },
      { id: "c", startsAt: "2026-11-16T19:00:00.000Z" },
    ];
    expect(groupAgenda(meetings, KOLKATA).map((g) => [g.day, g.meetings.map((m) => m.id)])).toEqual([
      ["2026-11-16", ["a", "b"]],
      ["2026-11-17", ["c"]],
    ]);
    const cells = weekCells(meetings, "2026-11-16", KOLKATA);
    expect(cells).toHaveLength(7);
    expect(cells[0]?.meetings.map((m) => m.id)).toEqual(["a", "b"]);
    expect(cells[1]?.meetings.map((m) => m.id)).toEqual(["c"]);
  });

  it("labels time ranges in the organisation's time zone", () => {
    expect(timeRangeLabel("2026-11-20T04:30:00.000Z", "2026-11-20T05:00:00.000Z", KOLKATA)).toBe("Fri 20 Nov, 10:00–10:30");
  });
});
