/** Server-only: the organisation's time zone for meeting times (ORG_TIMEZONE, the same value the API uses). */
export function orgTimeZone(): string {
  const zone = process.env["ORG_TIMEZONE"];
  if (!zone) throw new Error("ORG_TIMEZONE is not set");
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
  } catch {
    throw new Error("ORG_TIMEZONE is not a valid time zone");
  }
  return zone;
}
