export const MEETING_AUDIT = {
  created: "meeting.created",
  updated: "meeting.updated",
  cancelled: "meeting.cancelled",
  responded: "meeting.responded",
} as const;

/**
 * Allowlisted meeting fields for audit snapshots (docs/security/audit-policy.md). Times, versions, counts,
 * ids and change flags only: titles, descriptions, locations and meeting links are never recorded.
 */
export function meetingTimes(meeting: { startsAt: Date; endsAt: Date; version: number }): Record<string, unknown> {
  return { startsAt: meeting.startsAt.toISOString(), endsAt: meeting.endsAt.toISOString(), version: meeting.version };
}
