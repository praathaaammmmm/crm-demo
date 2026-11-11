# Privacy and Attendance

Work is measured by assigned tasks, updates, proof of work, reviews and approvals. The CRM does not monitor people.

## What attendance records

Table `attendance_events`, one row per event:

| Kind | Recorded when | `occurred_at` |
|---|---|---|
| `login` | Successful login | Session creation time |
| `session_end` | Logout, expiry, or revocation | Logout time, the session's configured expiry time, or revocation time |

Unique on `(session_id, kind)`, so each session has at most one of each. Application roles can insert but never change or delete these rows.

## Daily attendance

A user is **present** on a day if they have at least one `login` event on that calendar day in the organisation's time zone (`ORG_TIMEZONE`). Otherwise they are **absent**.

- A session that started the previous day and continues past midnight does not count as a login for the new day.
- Endpoints:
  - `GET /api/v1/attendance/me?from&to`: own days, at most 92 days per request
  - `GET /api/v1/attendance?date`: all users for one day, Super Admin only

## What is never recorded

- Total time in the app or session duration statistics
- Idle time, last-seen time or "online" status
- Mouse, keyboard or other input activity
- Screenshots or screen recordings
- Browsing activity, page views or click tracking
- Location, device fingerprints, IP history or user-agent history
- Any other surveillance-style productivity metric

The session check on each request writes nothing. Sessions expire at a fixed time, so no activity data is needed.

## Other personal data rules

- Email addresses are visible only to the Super Admin.
- Audit events never contain email addresses, names, passwords, hashes or tokens ([audit-policy.md](audit-policy.md)).
- Logs never contain request bodies, cookies or passwords.
- Outbox payloads contain only IDs and versions.

## Changing these rules

Any new data collection about people requires explicit user approval and an update to this document. Proposals that track activity, time-in-app or behaviour will be rejected under [AGENTS.md](../../AGENTS.md).

## Not yet decided

- Retention periods for `attendance_events` and `sessions` are undecided future policy decisions.
- No cleanup job exists or will be implemented until a retention policy is approved. Removing rows is a deletion and needs explicit approval.
