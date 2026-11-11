# ADR 0002: Transactional Outbox for Background Work

- Status: Accepted
- Date: 2026-11-11

## Context

Business changes must reliably trigger background work: session-expiry recording, health checks, and later meeting reminders and notifications. A job queued outside the business transaction can be lost (commit succeeds, queueing fails) or orphaned (queueing succeeds, commit fails).

The earlier proposal assumed pg-boss could enqueue inside the application's transaction. That was not verified, and pg-boss would add a dependency and a second source of job state.

## Decision

- Use an `outbox_events` table in PostgreSQL.
- Business change, audit event and outbox event are written in one transaction.
- The worker claims events after commit with `FOR UPDATE SKIP LOCKED` and a 60-second lock, retries with exponential back-off, and marks events `failed` after `max_attempts` (5).
- Handlers are idempotent and update the event status in the same transaction as their own writes.
- `crm_app` may only insert events. It never updates existing rows.
- Stale events (e.g. reminders for a rescheduled meeting) are detected by the worker through versioned payloads and marked `cancelled`.
- The worker schedules recurring system events only through `outbox_schedule_system_event()`, a `SECURITY DEFINER` function with a fixed allowlist. It has no direct INSERT grant.
- pg-boss is not used.

Full design: [outbox.md](../architecture/outbox.md).

## Consequences

- No lost or orphaned jobs; no extra infrastructure (no Redis).
- Delivery is at least once, so every handler must be idempotent.
- Polling every 2 seconds adds small, constant database load.
- Throughput is lower than a dedicated queue, which is sufficient for reminders and notifications.
- Retention of processed rows needs a later decision.

## Alternatives rejected

- **pg-boss:** extra dependency; in-transaction enqueueing unverified; duplicates job state.
- **BullMQ with Redis:** extra infrastructure; cannot join the database transaction.
- **Forwarding outbox events into pg-boss:** two sources of job state for no current benefit.
