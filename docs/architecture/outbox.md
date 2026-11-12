# Transactional Outbox

Background work (session-expiry sweeps, health checks, and later meeting reminders and notifications) is driven by an `outbox_events` table. The decision is recorded in [ADR 0002](../adrs/0002-transactional-outbox.md).

## Guarantees

- A business change, its audit event and its outbox event commit in **one transaction**. If any part fails, none of them exist.
- The worker processes events **after commit**, at least once.
- Every handler is **idempotent**: running it twice has the same effect as running it once.

## Table: `outbox_events`

| Column | Purpose |
|---|---|
| `id` uuid | Event identity; also the idempotency key for external calls |
| `event_type` text | e.g. `identity.session_expiry_sweep` |
| `payload` jsonb | IDs and versions only. Never secrets or private data. Handlers reload current data |
| `dedupe_key` text, unique | Prevents duplicate events |
| `status` | `pending`, `processing`, `done`, `cancelled`, `failed` |
| `available_at` | Earliest processing time (delays and retry back-off) |
| `attempts`, `max_attempts` | Retry control (default max 5) |
| `locked_by`, `locked_until` | Claim held by one worker for a limited time |
| `last_error` | Error code and message, max 500 characters, no payload data |
| `created_at`, `processed_at` | Timing |

## Who may write

| Role | Rights |
|---|---|
| `crm_app` (API) | INSERT (`event_type`, `payload`, `dedupe_key`, `available_at`) only, from migration 0011. A trigger allows only `meetings.reminder_due` events with the exact payload and key format |
| `crm_worker` | SELECT; UPDATE of `status`, `attempts`, `available_at`, `locked_by`, `locked_until`, `last_error`, `processed_at` only |
| `crm_outbox_owner` (NOLOGIN) | INSERT, used only inside `outbox_schedule_system_event()` |
| Everyone | No DELETE, no TRUNCATE |

The API never updates existing outbox rows.

## Database triggers

- Allowed status changes:
  - `pending → processing`
  - `processing → done | cancelled | failed | pending | processing` (the last is a reclaim after an expired lock)
- `done`, `cancelled` and `failed` are final.
- `event_type`, `payload`, `dedupe_key` and `created_at` can never change.
- `DELETE` and `TRUNCATE` raise an error.

## Worker loop

**Scheduler** (every 30 seconds): for each scheduled type, compute `slot = floor(now / interval) × interval` and call `outbox_schedule_system_event(type, slot)`.

**Dispatcher** (every 2 seconds, up to 10 events per batch):

1. **Claim** in a short transaction:
   ```sql
   UPDATE outbox_events
   SET status = 'processing', locked_by = $worker, locked_until = now() + interval '60 seconds',
       attempts = attempts + 1
   WHERE id IN (
     SELECT id FROM outbox_events
     WHERE (status = 'pending' AND available_at <= now())
        OR (status = 'processing' AND locked_until < now())
     ORDER BY available_at
     FOR UPDATE SKIP LOCKED
     LIMIT 10)
   ```
2. **Process** each event in its own transaction. The handler returns `done` or `cancelled`, and the event status is updated in the **same transaction** as the handler's writes.
3. **On error**, in a separate update:
   - if `attempts < max_attempts`: `status = 'pending'`, `available_at = now() + min(10 s × 2^attempts, 10 min)`
   - otherwise: `status = 'failed'`
4. **On SIGTERM**: stop claiming and finish events in progress. Events from a crashed worker are reclaimed when their lock expires.

Handlers that call external services (future) make the call outside the database transaction and pass `outbox_events.id` as the idempotency key.

## Scheduling recurring system events

The worker cannot insert into `outbox_events` directly. It calls one restricted function:

```
outbox_schedule_system_event(p_event_type text, p_slot timestamptz) RETURNS void
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp     -- all names schema-qualified
  OWNER crm_outbox_owner
  EXECUTE revoked from PUBLIC, granted to crm_worker only
```

The function:

1. Accepts only allowlisted types:
   - `identity.session_expiry_sweep`, every 5 minutes
   - `system.health_check`, every 5 minutes
2. Rejects a slot that is not aligned to the type's interval, or is more than one interval away from `now()`.
3. Builds the row itself: `payload = '{}'`, `dedupe_key = '<type>:<slot ISO 8601>'`, `available_at = p_slot`.
4. Inserts with `ON CONFLICT (dedupe_key) DO NOTHING`, so several workers cannot create duplicates.
5. Returns nothing.

Adding a scheduled type requires a reviewed migration that changes the allowlist. If handlers later need to publish follow-up events, each gets its own allowlisted function with separate approval.

## Phase 1 handlers

### `identity.session_expiry_sweep`

Ends expired sessions and records the session end at the **configured expiry time**, not the time the sweep runs:

```sql
WITH due AS (SELECT id FROM sessions
             WHERE ended_at IS NULL AND expires_at <= now()
             ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED),
ended AS (UPDATE sessions s SET ended_at = s.expires_at, end_reason = 'expired'
          FROM due WHERE s.id = due.id
          RETURNING s.id, s.user_id, s.expires_at)
INSERT INTO attendance_events (session_id, user_id, kind, occurred_at)
SELECT id, user_id, 'session_end', expires_at FROM ended
ON CONFLICT (session_id, kind) DO NOTHING;
```

Running it again changes nothing.

### `system.health_check`

- Checks the database connection.
- Counts events overdue by more than 10 minutes and `failed` events from the last 24 hours.
- Logs at `warn` level when either count is above zero. In Phase 1, this log is how the Super Admin sees failed events.
- Writes nothing except its own event status.

## Meeting reminders (implemented in Slice 5)

See [ADR 0007](../adrs/0007-meetings-and-reminders.md). Worker entry point: `apps/api/src/worker.ts`; dispatcher, scheduler and health check in `apps/api/src/platform/worker/`.

| Action | In one API transaction | Existing reminder rows |
|---|---|---|
| Create (version 1) | Insert meeting and attendees, audit, insert one `meetings.reminder_due` event per reminder time still strictly in the future | — |
| Edit (version n → n+1) | Update meeting, attendees and responses, audit, insert events for version n+1 | Not touched |
| Cancel (version n → n+1) | Set `status = cancelled`, audit. No new events | Not touched |

Each event: payload `{meetingId, version, minutesBefore}` (10, 5 or 2), `dedupe_key = meeting:{id}:v{version}:m{minutesBefore}`, `available_at = starts_at − minutesBefore`.

When the worker processes a reminder:

```
BEGIN
  SELECT pg_advisory_xact_lock_shared(hashtextextended('meeting:' || $meetingId, 0))
  SELECT status, version, starts_at <= now() FROM meetings WHERE id = $meetingId
  IF meeting missing OR cancelled OR version <> payload.version OR already started:
      mark the event 'cancelled'
  ELSE:
      insert one notification per current (not removed), active attendee who has not declined
        ON CONFLICT (source_event_id, recipient_id) DO NOTHING
      mark the event 'done'
COMMIT
```

The API takes the same advisory lock exclusively whenever it edits, cancels or records a response, so a concurrent change is either finished and seen, or waits. This replaces the `FOR SHARE` row lock in the earlier design, because PostgreSQL requires UPDATE privilege for row locks and `crm_worker` has none on `meetings`.

## Not yet decided

- Retention of `done`, `cancelled` and `failed` rows is an undecided future policy decision. Phase 1 volume is about 576 rows per day.
- No cleanup job exists or will be implemented until a retention policy is approved. Removing rows is a deletion and needs explicit approval.
