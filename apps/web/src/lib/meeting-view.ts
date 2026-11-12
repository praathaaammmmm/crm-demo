/**
 * Pure helpers for showing meetings in the organisation's time zone. Dates are "YYYY-MM-DD" keys and
 * wall-clock times "YYYY-MM-DDTHH:MM"; instants are ISO strings from the API. Order within every group
 * is the API's order; nothing is re-sorted here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function parts(iso: string | number, timeZone: string): Record<string, string> {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  return Object.fromEntries(formatted.map((part) => [part.type, part.value]));
}

/** The local calendar day of an instant. */
export function localDateKey(iso: string | number, timeZone: string): string {
  const p = parts(iso, timeZone);
  return `${p["year"] ?? ""}-${p["month"] ?? ""}-${p["day"] ?? ""}`;
}

/** The local wall-clock time of an instant, as used by <input type="datetime-local">. */
export function toLocalInput(iso: string | number, timeZone: string): string {
  const p = parts(iso, timeZone);
  return `${localDateKey(iso, timeZone)}T${p["hour"] ?? ""}:${p["minute"] ?? ""}`;
}

/** "15:30" in the organisation's time zone. */
export function localTime(iso: string, timeZone: string): string {
  return toLocalInput(iso, timeZone).slice(11);
}

const keyToUtcMidnight = (key: string) => Date.parse(`${key}T00:00:00Z`);

export function addDays(key: string, days: number): string {
  return new Date(keyToUtcMidnight(key) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week containing the given day. */
export function weekStart(key: string): string {
  const weekday = new Date(keyToUtcMidnight(key)).getUTCDay(); // 0 = Sunday
  return addDays(key, -((weekday + 6) % 7));
}

export const weekDays = (start: string): string[] => Array.from({ length: 7 }, (_, index) => addDays(start, index));

/**
 * The UTC instant of a local wall-clock time. Corrects the zone offset twice, so it is exact across
 * daylight-saving changes (an hour that does not exist resolves forward).
 */
export function localToUtc(local: string, timeZone: string): string {
  const wanted = Date.parse(`${local}:00Z`);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const seen = Date.parse(`${toLocalInput(guess, timeZone)}:00Z`);
    guess += wanted - seen;
  }
  return new Date(guess).toISOString();
}

/** [from, to) in UTC covering whole local days, for API list requests. */
export function dayRangeUtc(firstDay: string, days: number, timeZone: string): { from: string; to: string } {
  return { from: localToUtc(`${firstDay}T00:00`, timeZone), to: localToUtc(`${addDays(firstDay, days)}T00:00`, timeZone) };
}

/** "Fri 20 Nov" for a day key. */
export function dayLabel(key: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(
    new Date(keyToUtcMidnight(key)),
  );
}

/** "Fri 20 Nov, 15:30–16:00" in the organisation's time zone (the end shows its own date when it differs). */
export function timeRangeLabel(startsAt: string, endsAt: string, timeZone: string): string {
  const startDay = localDateKey(startsAt, timeZone);
  const endDay = localDateKey(endsAt, timeZone);
  const end = endDay === startDay ? localTime(endsAt, timeZone) : `${dayLabel(endDay)}, ${localTime(endsAt, timeZone)}`;
  return `${dayLabel(startDay)}, ${localTime(startsAt, timeZone)}–${end}`;
}

/** Agenda: consecutive groups by local start day, in API order. */
export function groupAgenda<T extends { startsAt: string }>(meetings: readonly T[], timeZone: string): { day: string; meetings: T[] }[] {
  const groups: { day: string; meetings: T[] }[] = [];
  for (const meeting of meetings) {
    const day = localDateKey(meeting.startsAt, timeZone);
    const last = groups.at(-1);
    if (last?.day === day) last.meetings.push(meeting);
    else groups.push({ day, meetings: [meeting] });
  }
  return groups;
}

/** Week grid: one cell per local day of the week; a meeting appears on the day it starts. */
export function weekCells<T extends { startsAt: string }>(
  meetings: readonly T[],
  start: string,
  timeZone: string,
): { day: string; meetings: T[] }[] {
  return weekDays(start).map((day) => ({ day, meetings: meetings.filter((meeting) => localDateKey(meeting.startsAt, timeZone) === day) }));
}
