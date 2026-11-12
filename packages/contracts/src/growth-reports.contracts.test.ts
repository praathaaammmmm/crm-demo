import { describe, expect, it } from "vitest";
import { leadListQuerySchema } from "./growth-leads.js";
import { addDays, daysInclusive, growthOverviewSchema, growthReportQuerySchema, resolveReportRange } from "./growth-reports.js";

const TODAY = "2026-11-12";

describe("growth report query", () => {
  it("accepts optional ISO dates and rejects malformed dates, unknown keys and from > to", () => {
    expect(growthReportQuerySchema.safeParse({}).success).toBe(true);
    expect(growthReportQuerySchema.safeParse({ from: "2026-01-01", to: "2026-01-31" }).success).toBe(true);
    expect(growthReportQuerySchema.safeParse({ from: "2026-13-01" }).success).toBe(false);
    expect(growthReportQuerySchema.safeParse({ to: "12/11/2026" }).success).toBe(false);
    expect(growthReportQuerySchema.safeParse({ owner: "x" }).success).toBe(false);
    expect(growthReportQuerySchema.safeParse({ from: "2026-02-01", to: "2026-01-31" }).success).toBe(false);
  });

  it("date helpers do calendar arithmetic across months and leap days", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysInclusive("2026-01-01", "2026-01-01")).toBe(1);
    expect(daysInclusive("2026-01-01", "2026-12-31")).toBe(365);
  });

  it("resolves the 90-day default, refuses future dates and ranges over 366 days", () => {
    expect(resolveReportRange({}, TODAY)).toEqual({ ok: true, range: { from: "2026-08-15", to: TODAY } });
    expect(resolveReportRange({ to: "2026-03-31" }, TODAY)).toEqual({ ok: true, range: { from: "2026-01-01", to: "2026-03-31" } });
    expect(resolveReportRange({ from: "2026-11-01" }, TODAY)).toEqual({ ok: true, range: { from: "2026-11-01", to: TODAY } });
    expect(resolveReportRange({ to: "2026-11-13" }, TODAY).ok).toBe(false);
    expect(resolveReportRange({ from: "2026-11-13" }, TODAY).ok).toBe(false);
    expect(resolveReportRange({ from: addDays(TODAY, -365), to: TODAY }, TODAY).ok).toBe(true);
    expect(resolveReportRange({ from: addDays(TODAY, -366), to: TODAY }, TODAY).ok).toBe(false);
  });

  it("the lead list accepts the stale filter", () => {
    expect(leadListQuerySchema.safeParse({ stale: "true" }).success).toBe(true);
    expect(leadListQuerySchema.safeParse({ stale: "yes" }).success).toBe(false);
  });
});

describe("growth overview response", () => {
  const empty = {
    currency: "INR",
    today: TODAY,
    range: { from: "2026-08-15", to: TODAY },
    staleDays: 14,
    pipeline: { openCount: 0, openValueMinor: 0, unvaluedCount: 0, overdueCount: 0, staleCount: 0 },
    stages: [],
    funnel: [],
    closed: { wonCount: 0, wonAmountMinor: 0, lostCount: 0, winRate: null, lostReasons: [] },
    proposals: { pendingApproval: 0, acceptancePending: 0 },
    bySource: [],
    byOwner: [],
    byCompany: [],
  };

  it("accepts an empty overview and rejects extra fields, so contact data cannot leak through", () => {
    expect(growthOverviewSchema.safeParse(empty).success).toBe(true);
    expect(growthOverviewSchema.safeParse({ ...empty, contacts: [] }).success).toBe(false);
    const leaky = { ...empty, byOwner: [{ ownerId: "0190a000-0000-7000-8000-000000000001", ownerFlagged: false, openCount: 0, openValueMinor: 0, wonCount: 0, wonAmountMinor: 0, lostCount: 0, email: "x@example.test" }] };
    expect(growthOverviewSchema.safeParse(leaky).success).toBe(false);
    expect(growthOverviewSchema.safeParse({ ...empty, closed: { ...empty.closed, winRate: 1.5 } }).success).toBe(false);
  });
});
