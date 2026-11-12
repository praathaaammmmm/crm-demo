import { z } from "zod";
import { leadSourceSchema, lostReasonSchema, openStageSchema } from "./growth-leads.js";

/** Approved Phase 4A.4 reporting rules (ADR 0010). */
/** Stale = last touch more than this many days ago: exactly 14 days is not stale, 15 or more is. */
export const GROWTH_STALE_DAYS = 14;
export const REPORT_DEFAULT_DAYS = 90;
export const REPORT_MAX_DAYS = 366;
/** Named companies in the company breakdown; the rest are folded into one "other" row. */
export const REPORT_TOP_COMPANIES = 10;

/** Funnel stages: new is counted by creation, every other stage (lost included) by stage entry. */
export const FUNNEL_STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"] as const;

const isoDate = z.iso.date();

/** "YYYY-MM-DD" shifted by whole days (calendar arithmetic, no time zone). */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Days from `from` to `to`, both included. */
export const daysInclusive = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export const growthReportQuerySchema = z
  .strictObject({ from: isoDate.optional(), to: isoDate.optional() })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    message: "The start date must be on or before the end date",
    path: ["from"],
  });
export type GrowthReportQuery = z.infer<typeof growthReportQuerySchema>;

export interface ReportRange {
  from: string;
  to: string;
}

/**
 * Applies the defaults (to = today, from = 90 days ending at to) and the limits (no future dates, at most
 * 366 days). `today` is the organisation's date. Shared by the API and the web filter.
 */
export function resolveReportRange(query: GrowthReportQuery, today: string): { ok: true; range: ReportRange } | { ok: false; message: string } {
  const to = query.to ?? today;
  const from = query.from ?? addDays(to, -(REPORT_DEFAULT_DAYS - 1));
  if (to > today) return { ok: false, message: "The end date cannot be in the future" };
  if (from > to) return { ok: false, message: "The start date must be on or before the end date" };
  if (daysInclusive(from, to) > REPORT_MAX_DAYS) return { ok: false, message: `Choose a range of at most ${String(REPORT_MAX_DAYS)} days` };
  return { ok: true, range: { from, to } };
}

const count = z.int().nonnegative();
const minor = z.int().nonnegative();

/** Live (non-archived open leads) and historical (closed in range, archived included) outcome columns. */
const outcomeColumns = {
  openCount: count,
  openValueMinor: minor,
  wonCount: count,
  wonAmountMinor: minor,
  lostCount: count,
};

export const growthOverviewSchema = z.strictObject({
  currency: z.literal("INR"),
  today: isoDate,
  range: z.strictObject({ from: isoDate, to: isoDate }),
  staleDays: z.literal(GROWTH_STALE_DAYS),
  pipeline: z.strictObject({
    openCount: count,
    openValueMinor: minor,
    unvaluedCount: count,
    overdueCount: count,
    staleCount: count,
  }),
  stages: z.array(z.strictObject({ stage: openStageSchema, count, valueMinor: minor })),
  funnel: z.array(z.strictObject({ stage: z.enum(FUNNEL_STAGES), entered: count })),
  closed: z.strictObject({
    wonCount: count,
    wonAmountMinor: minor,
    lostCount: count,
    winRate: z.number().min(0).max(1).nullable(),
    lostReasons: z.array(z.strictObject({ reason: lostReasonSchema, count })),
  }),
  proposals: z.strictObject({ pendingApproval: count, acceptancePending: count }),
  bySource: z.array(z.strictObject({ source: leadSourceSchema, ...outcomeColumns })),
  byOwner: z.array(z.strictObject({ ownerId: z.uuid(), ownerFlagged: z.boolean(), ...outcomeColumns })),
  byCompany: z.array(
    z.strictObject({
      kind: z.enum(["company", "none", "other"]),
      companyId: z.uuid().nullable(),
      name: z.string().nullable(),
      ...outcomeColumns,
    }),
  ),
});
export type GrowthOverview = z.infer<typeof growthOverviewSchema>;
export type OutcomeRow = Pick<GrowthOverview["bySource"][number], keyof typeof outcomeColumns>;
