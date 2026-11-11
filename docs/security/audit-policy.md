# Audit Policy

Every sensitive change creates an append-only audit event in the same database transaction as the change.

## What is recorded

Table `audit_events`:

| Column | Content |
|---|---|
| `id` | uuidv7 |
| `occurred_at` | Set by the database (`now()`); cannot be supplied by the application |
| `actor_type` | `user`, `system` (worker), `bootstrap` (one-time setup and future break-glass commands), `anonymous` (unauthenticated login attempts) |
| `actor_user_id` | The acting user, when there is one |
| `action` | e.g. `user.role_changed` |
| `entity_type`, `entity_id` | What was changed |
| `before`, `after` | Allowlisted fields only |
| `request_id` | Correlates with logs |

Project and client context columns are added in Phase 2 through an expand migration, when those tables exist.

## How events are written

```
audit.service.record(tx, ctx, { action, entityType, entityId, before?, after? })
```

- Requires a transaction by its type signature. It cannot be called outside one.
- If the audit insert fails, the whole change rolls back.
- `before` and `after` must come from the module's `*.audit.ts` snapshot function, which copies only allowlisted fields.
- The actor and `request_id` are taken from `ctx`.

## Field allowlists (Phase 1)

| Entity | Fields recorded |
|---|---|
| `user` | `role`, `status` |
| `approval_request` | `type`, `status`, `target_user_id`, payload fields defined by the request type (e.g. `newRole`) |
| `project` | Nothing beyond the entity id |
| `task` | `assigneeId`, `priority`, `dueDate`, `status`; `projectId` on creation; `titleChanged` / `descriptionChanged` flags on edits; ids of added notes and proofs; review `decision` |
| `qa_check` | `taskId`, `projectId`; result `outcome`, `resultId`, `hasEvidence` |
| `defect` | `taskId`, `projectId`, `qaCheckId`, `severity`, `status`; `titleChanged` / `reproductionChanged` flags on edits; `updateId`, `hasNote`, `hasEvidence` on responses |
| `project` (readiness) | `projectId`, `decisionId`, `readiness`, blocker counts at decision time |

Never recorded: passwords, password hashes, session tokens or hashes, email addresses, names, cookies, request bodies, project names or descriptions, task titles or descriptions, progress notes, review notes, proof notes or proof URLs, QA check titles, QA result notes, defect titles, reproduction steps, defect notes, evidence URLs, readiness labels or readiness notes. That text lives only in the module's own append-only history tables.

## Phase 1 audit actions

| Action | Actor | When |
|---|---|---|
| `system.super_admin_bootstrapped` | `bootstrap` | Bootstrap command creates the CEO/CTO |
| `user.created` | `user` | Super Admin creates a user |
| `user.role_changed` | `user` | Approved role change executes (includes `sessionsRevoked` count) |
| `user.deactivated` | `user` | Approved deactivation executes |
| `user.password_changed` | `user` | A user changes their password |
| `user.account_locked` | `anonymous` | Fifth failed login locks the account |
| `approval.requested` | `user` | Approval request created |
| `approval.approved` | `user` | Super Admin approves |
| `approval.rejected` | `user` | Super Admin rejects |
| `approval.cancelled` | `user` | Requester cancels |

Logins and logouts are recorded in `attendance_events` (append-only for application roles), not in the audit log.

## Projects and tasks audit actions

| Action | Actor | When | Recorded |
|---|---|---|---|
| `project.created` | `user` (CEO) | A project is created | entity id only |
| `task.created` | `user` (CEO) | A task is created | `after { assigneeId, priority, dueDate, status, projectId }` |
| `task.updated` | `user` (CEO) | A task is edited or reassigned | `before` / `after { assigneeId, priority, dueDate, status }` plus `titleChanged`, `descriptionChanged` |
| `task.status_changed` | `user` (assignee) | Direct status change | `before { status }`, `after { status }` |
| `task.progress_noted` | `user` (assignee) | Progress note added | `after { updateId }` |
| `task.proof_added` | `user` (assignee) | Proof of work added | `after { proofId }` |
| `task.submitted` | `user` (assignee) | Work submitted for review | `before { status }`, `after { status: in_review }` |
| `task.reviewed` | `user` (CEO) | Approve or request changes | `after { decision, status }` |
| `task.completed` | `user` (CEO) | Marked complete directly | `before { status }`, `after { status: completed }` |

## Quality audit actions

| Action | Actor | When | Recorded |
|---|---|---|---|
| `qa_check.created` | `user` (VP or CEO) | A QA check is added to a task | `after { taskId, projectId }` |
| `qa_check.result_recorded` | `user` (VP or CEO) | A QA result is appended | `before { outcome }`, `after { taskId, projectId, outcome, resultId, hasEvidence }` |
| `defect.created` | `user` (VP or CEO) | A defect is reported | `after { taskId, projectId, severity, status, qaCheckId }` |
| `defect.updated` | `user` (VP or CEO) | Title, severity or steps edited | `before { severity }`, `after { taskId, projectId, severity, titleChanged, reproductionChanged }` |
| `defect.status_changed` | `user` (assignee, VP or CEO) | A workflow move | `before { status }`, `after { taskId, projectId, status, severity }` |
| `defect.responded` | `user` (assignee, VP or CEO) | A note and/or evidence link | `after { taskId, projectId, updateId, hasNote, hasEvidence }` |
| `release.readiness_set` | `user` (VP or CEO) | A readiness decision is appended (entity `project`) | `after { projectId, decisionId, readiness, openBlockingDefects, failedOrBlockedQaChecks }` |

Each future module documents its audit actions here when it is added.

## Protection

- **Database triggers** reject `UPDATE`, `DELETE` and `TRUNCATE` on `audit_events` for every role, including the table owner.
- **Grants:** `crm_app` has only SELECT and INSERT. `crm_worker` has no access in Phase 1.
- **Application:** there is no route to edit or delete audit events.
- **Reading:** `GET /api/v1/audit-events`, Super Admin only.

A hash chain (`prev_hash`) for detecting tampering by someone with full database access is deferred to a later phase.

## Logs are not audit

Application logs (pino) are for operations. They redact `cookie`, `authorization`, `set-cookie` headers and all password fields, and never include request bodies. Logs must not be used as an audit trail.

## Tests

- `apps/api/test/audit-immutability.test.ts`: changes are rejected for `crm_app` and for the owner `crm_migrator`.
- Each module's integration tests assert the expected audit rows.
- `modules/audit/audit.test.ts`: allowlists exclude private fields; only the Super Admin can read; no mutation routes exist.
