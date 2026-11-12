# ADR 0007: Meetings, Responses and In-App Reminders

- Status: Accepted
- Date: 2026-11-11

## Context

The CEO/CTO schedules meetings with team members. Invitees need in-app reminders 10, 5 and 2 minutes before a meeting starts, delivered by the existing transactional outbox ([ADR 0002](0002-transactional-outbox.md)). Rescheduling or cancelling must never deliver a reminder for the old time. The CEO/CTO needs meeting and response summaries without any presence, join or activity tracking ([privacy-and-attendance.md](../security/privacy-and-attendance.md)).

## Decision

### Meetings and attendees

- Only the CEO/CTO organises meetings (`meetings:manage`); a composite foreign key to `users (id, is_super_admin)` enforces it in the database. The organiser is automatically an attendee.
- Attendees are 1–50 active users other than the CEO/CTO. They are never deleted: removal sets `removed_at`, which ends access and future reminders. Re-adding someone restores them as a fresh `pending` attendee.
- Times are entered as wall-clock values in the organisation's time zone (`ORG_TIMEZONE`) and converted to UTC by PostgreSQL. Duration is 5–720 minutes. A meeting cannot start in the past.
- An optional reference names a project, or a task with its project (composite foreign key `tasks (id, project_id)`).

### Responses

Invitees respond `accepted` or `declined` until the meeting ends; cancelled meetings are read-only.

1. A change to `starts_at` or `ends_at` resets every current attendee's response to `pending`, clears `responded_at`, and sets `meetings.responses_reset_at = now()`.
2. Editing only the title, description, location or link keeps responses and leaves `responses_reset_at` unchanged.
3. Replacing attendees keeps retained responses, adds new people as `pending`, and soft-removes the rest. When one edit does both, attendees are replaced first, then responses are reset.

The meeting detail shows a "responses were reset" notice based only on `responses_reset_at`.

### Versions and reminders

- Every edit or cancellation increments `meetings.version`.
- On create and on every edit, in the same transaction, the API inserts one `meetings.reminder_due` outbox event per reminder time still strictly in the future: payload `{meetingId, version, minutesBefore}`, `dedupe_key = meeting:{id}:v{version}:m{offset}`, `available_at = starts_at − offset`. Cancelling inserts none. Older events are never updated (the API has no outbox UPDATE grant).
- A database trigger lets `crm_app` insert only this event type with exactly that payload shape and key format.
- The worker's handler takes a per-meeting **transaction-level advisory lock** in shared mode; the API takes it exclusively when it edits, cancels or records a response. It then cancels the event if the meeting is missing, cancelled, on another version, or already started; otherwise it creates one notification per current, active attendee who has not declined (`ON CONFLICT (source_event_id, recipient_id) DO NOTHING`) and marks the event done, in one transaction.
- Advisory locks replace the `SELECT … FOR SHARE` in the original outbox design: PostgreSQL requires UPDATE privilege for row locks, and the worker has none on `meetings`.
- Notifications store no text; the current title and time are joined in when shown, and only while the recipient may still see the meeting.

### Worker

`apps/api/src/worker.ts` runs as `crm_worker`: it schedules the allowlisted system events every 30 seconds and dispatches due events every 2 seconds (claim with `FOR UPDATE SKIP LOCKED`, 60-second lock, back-off retries, `failed` after `max_attempts`). Handlers: `meetings.reminder_due`, `identity.session_expiry_sweep`, `system.health_check`.

### Summaries and privacy

The CEO/CTO sees exact counts in the organisation's time zone: meetings today and this week, cancelled in the last 7 days, held in the last 30 days, and responses for upcoming meetings. No join, presence, duration or click data is collected. The notification bell reads the unread count every 30 seconds while the tab is visible; nothing about that is recorded.

## Consequences

- Two migrations: `0010_meetings.sql` (tables, constraints, `tasks (id, project_id)` unique, outbox insert guard) and `0011_meetings_grants.sql`.
- Reminders can be up to the dispatcher's poll interval late, and none is ever sent after the meeting starts.
- `crm_worker` gains read access to the meeting columns it checks and INSERT on `notifications`; it has no other new writes.
- Deleting meetings, attendees or notifications is not supported.
