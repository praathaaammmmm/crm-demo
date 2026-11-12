import { orgTimeZone } from "./org-time";

/** Server-only: "12 Nov 2026, 14:05" in the organisation's time zone. */
export function growthTimeFormatter(): (iso: string) => string {
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: orgTimeZone(), dateStyle: "medium", timeStyle: "short" });
  return (iso) => format.format(new Date(iso));
}
