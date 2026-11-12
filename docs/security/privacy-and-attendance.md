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

## Meetings

- Meeting "attendance" means an invitee's response only: pending, accepted or declined. Nothing records whether or when anyone joined, how long they stayed, or what they clicked.
- The CEO/CTO's meeting summary counts responses and meeting statuses only.
- The notification bell reads the unread count every 30 seconds while the tab is visible. The request is not logged as activity and nothing about it is stored.

## Growth contacts

- Growth contacts are personal data about people outside the organisation. Only the CGO and the CEO/CTO can see them.
- Fields are minimal: name, role, email, phone, LinkedIn and website. Nothing is imported or scraped, and there is no export.
- Contact details never appear in audit events or logs.
- Activities record outreach the CGO did manually; the CRM never sends messages, imports inboxes or tracks opens. Activity summaries and proof links are visible only to the CGO and the CEO/CTO and never appear in audit events or logs.
- **O1 retention and redaction policy:** a policy for Growth data is an open decision and must be made before production use. It covers contact data, activity summaries and proof links, proposal document links, acceptance evidence links, and proposal, acceptance and confirmation notes. No deletion, cleanup, anonymisation, redaction job or export is implemented until that policy is explicitly approved.

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

## Growth deployment gate

- **O10:** no Growth migration is applied to Neon before Neon verification passes. This includes proposal migrations 0016 and 0017; local test-template verification does not authorise a Neon migration.
