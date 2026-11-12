import { describe, expect, it } from "vitest";
import { barPercent, formatPercent, overviewHref, rangePresets, readReportRange } from "./growth-report-view";

describe("growth report view", () => {
  it("formats the win rate and shows a dash when nothing closed", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1 / 3)).toBe("33%");
    expect(formatPercent(1)).toBe("100%");
  });

  it("scales bars against the largest value", () => {
    expect(barPercent(0, 0)).toBe(0);
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(10, 10)).toBe(100);
  });

  it("reads the range from the URL: empty or repeated values are ignored, malformed values are errors", () => {
    expect(readReportRange({})).toEqual({ ok: true, query: {} });
    expect(readReportRange({ from: "", to: "2026-03-31" })).toEqual({ ok: true, query: { to: "2026-03-31" } });
    expect(readReportRange({ from: ["2026-01-01", "2026-02-01"] })).toEqual({ ok: true, query: {} });
    expect(readReportRange({ from: "2026-13-01" })).toEqual({ ok: false, message: "Enter dates as YYYY-MM-DD" });
    expect(readReportRange({ from: "2026-03-01", to: "2026-02-01" })).toEqual({ ok: false, message: "The start date must be on or before the end date" });
  });

  it("builds overview links and presets ending today", () => {
    expect(overviewHref()).toBe("/growth");
    expect(overviewHref({ from: "2026-01-01", to: "2026-01-31" })).toBe("/growth?from=2026-01-01&to=2026-01-31");
    expect(rangePresets("2026-11-12")).toEqual([
      { label: "Last 30 days", from: "2026-10-14", to: "2026-11-12" },
      { label: "Last 90 days", from: "2026-08-15", to: "2026-11-12" },
      { label: "Quarter to date", from: "2026-10-01", to: "2026-11-12" },
    ]);
    expect(rangePresets("2026-03-31")[2]).toEqual({ label: "Quarter to date", from: "2026-01-01", to: "2026-03-31" });
  });
});
