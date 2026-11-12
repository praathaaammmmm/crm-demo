# Phase 1: Foundation

Phase 1 delivers the secure foundation every later feature depends on: identity, organisation, permissions, approvals, audit and the background worker.

## Users and roles

- One Super Admin: the CEO/CTO.
- Everyone else reports directly to the CEO/CTO.
- Roles: `ceo_cto`, `cfo`, `cgo`, `cmo`, `vp_engineering_quality`, `founder`, `employee`, `intern`, `contractor`. See [rbac-matrix.md](../security/rbac-matrix.md).

## Requirements

### Setup

- The CEO/CTO account is created once by a command-line bootstrap. It cannot be created through the app.

### Sign-in

- Users sign in with email and password.
- Sessions last 12 hours.
- New users must change their temporary password on first sign-in.
- Users can change their password and sign out.
- Five failed attempts lock the account for 15 minutes.

### User management (CEO/CTO)

- Create a user with name, email, role and a temporary password.
- See the user directory with emails.
- Change a user's role or deactivate a user. These execute immediately when the CEO/CTO does them, and are recorded as approved requests.

### Approvals

- CFO, CGO, CMO and VP Engineering & Quality can request a role change or deactivation for another user, with a reason.
- They cannot target themselves or the CEO/CTO.
- The CEO/CTO sees pending requests and approves or rejects them. Rejection requires a note.
- Requesters can see and cancel their own pending requests.
- Approved changes take effect immediately and sign the affected user out.

### Audit (CEO/CTO)

- View the audit log, filtered by entity, actor and date range.
- Audit events cannot be edited or deleted by anyone through the app.

### Attendance

- Every user can see their own daily attendance (present or absent).
- The CEO/CTO can see all users' attendance for a day.
- Only sign-in and sign-out/session-end times are recorded. See [privacy-and-attendance.md](../security/privacy-and-attendance.md).

### Quality (Slice 4)

Added after the original Phase 1 scope. See [ADR 0006](../adrs/0006-quality-workflow.md).

- VP Engineering & Quality and the CEO/CTO add QA checks to tasks and record append-only results (passed, failed, blocked; failed and blocked need a note; optional https evidence).
- They report defects on tasks with a severity (critical, high, medium, low) and reproduction steps, optionally linked to the QA check that found them.
- The assignee of the linked task starts and fixes defects (a fix needs a note) and adds notes and https evidence. Managers verify or reopen fixes and can close unfixed defects as won't fix (with a note). A manager assigned to a task acts only as its assignee for that task's quality items and cannot set readiness for its project; the CEO/CTO can.
- Release readiness is an append-only decision per project (not ready, at risk, ready); the latest decision is current, and a project with no decision counts as not ready. Ready is refused while the project has open critical/high defects or failed/blocked QA checks.
- The CEO/CTO and VP see exact counts of open critical/high defects and failed/blocked checks, and per-project readiness and blockers (rows capped at 250 with a notice).
- Assignees see and respond only to quality items on their current tasks.

### Meetings (Slice 5)

Added after the original Phase 1 scope. See [ADR 0007](../adrs/0007-meetings-and-reminders.md).

- The CEO/CTO schedules, edits and cancels meetings with a title, description, start time and duration (in the organisation's time zone), attendees, an optional location and https meeting link, and an optional project or task reference.
- Invitees see only their own meetings in an Agenda or Week view, and accept or decline. Changing a meeting's time resets every response to pending; other edits keep responses.
- Invitees who have not declined get in-app reminders 10, 5 and 2 minutes before the start. Rescheduled or cancelled meetings never send reminders for the old time.
- The CEO/CTO's dashboard shows meeting and response counts. No presence or join tracking.

### Background worker

- Ends expired sessions and records their end time.
- Delivers meeting reminders through the outbox (Slice 5).
- Runs a health check every 5 minutes and logs warnings for failed or stuck background events.

## Screens

| Path | Who |
|---|---|
| `/login` | Everyone |
| `/change-password` | Signed-in users |
| `/` | Signed-in users: links to the pages they may access |
| `/users` | CEO/CTO and approval requesters |
| `/approvals` | CEO/CTO and approval requesters |
| `/audit` | CEO/CTO |
| `/attendance` | Everyone (own); CEO/CTO (all) |
| `/quality` | CEO/CTO and VP Engineering & Quality |
| `/meetings`, `/meetings/[id]` | Everyone (own invitations); CEO/CTO (all) |
| `/notifications` | Everyone (own) |
| `/defects`, `/defects/[id]` | Everyone with tasks (own task defects); CEO/CTO and VP (all) |

## Acceptance criteria

- Every requirement above is covered by integration or end-to-end tests ([overview](../architecture/overview.md)).
- Database tests prove the grants, the audit immutability, the single Super Admin and the reporting-line rule.
- An employee cannot open user, approval or audit pages, and their API calls return `403` ([API conventions](../api/conventions.md)).
- A requester cannot see or act on another user's approval request; those calls return `404`.

## Out of scope for Phase 1

- Two-factor authentication
- Password reset by email; any email or messaging
- Notifications
- Projects, tasks, meetings, clients, CRM pipeline, marketing, finance, engineering, automations
- Integrations and AI
- User reactivation, approval expiry
- In-app view of failed background events
- Audit hash chain
- Super Admin transfer and Super Admin password recovery
- Retention periods and cleanup jobs for outbox events, sessions and attendance
- Deployment
