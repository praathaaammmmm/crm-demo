import type { LEAD_SOURCES, LOST_REASONS } from "@crm/contracts/growth-leads";
import { addDays, growthReportQuerySchema, type GrowthReportQuery, type ReportRange } from "@crm/contracts/growth-reports";
import { hrefWith, readParam, type SearchParams } from "./search-params";

/** Labels shared by the lead forms and the Growth overview. */
export const SOURCE_LABELS: Record<(typeof LEAD_SOURCES)[number], string> = {
  linkedin: "LinkedIn",
  referral: "Referral",
  inbound_email: "Inbound email",
  website: "Website",
  event: "Event",
  cold_outreach: "Cold outreach",
  partner: "Partner",
  other: "Other",
};

export const LOST_LABELS: Record<(typeof LOST_REASONS)[number], string> = {
  no_budget: "No budget",
  chose_competitor: "Chose a competitor",
  no_response: "No response",
  not_a_fit: "Not a fit",
  timing: "Timing",
  price: "Price",
  other: "Other",
};

/** "42%", or "—" when nothing closed in the range. */
export const formatPercent = (rate: number | null): string => (rate === null ? "—" : `${String(Math.round(rate * 100))}%`);

/** Bar width as a whole percentage of the largest value; 0 when everything is 0. */
export const barPercent = (value: number, max: number): number => (max <= 0 ? 0 : Math.round((value / max) * 100));

/** Range params from the URL: the parsed query, or an error message for malformed input. */
export function readReportRange(params: SearchParams): { ok: true; query: GrowthReportQuery } | { ok: false; message: string } {
  const raw: Record<string, string> = {};
  for (const key of ["from", "to"] as const) {
    const value = readParam(params, key);
    if (value !== undefined && value.length > 0) raw[key] = value;
  }
  const parsed = growthReportQuerySchema.safeParse(raw);
  if (parsed.success) return { ok: true, query: parsed.data };
  return { ok: false, message: parsed.error.issues[0]?.message.startsWith("The start") ? "The start date must be on or before the end date" : "Enter dates as YYYY-MM-DD" };
}

export const overviewHref = (range: Partial<ReportRange> = {}): string => hrefWith("/growth", { from: range.from, to: range.to });

/** Preset ranges ending on the organisation's today. */
export function rangePresets(today: string): { label: string; from: string; to: string }[] {
  const quarterMonth = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
  return [
    { label: "Last 30 days", from: addDays(today, -29), to: today },
    { label: "Last 90 days", from: addDays(today, -89), to: today },
    { label: "Quarter to date", from: `${today.slice(0, 4)}-${String(quarterMonth).padStart(2, "0")}-01`, to: today },
  ];
}
