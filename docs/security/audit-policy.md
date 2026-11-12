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
| `user.access_reset` | `user` | CEO/CTO resets a user's access: new temporary password, sessions ended, deactivated user restored (records role, status, `mustChangePassword` and `sessionsRevoked` only) |
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

## Meeting audit actions

| Action | Actor | When | Recorded |
|---|---|---|---|
| `meeting.created` | `user` (CEO) | A meeting is scheduled | `after { startsAt, endsAt, version, attendeeCount, projectId, taskId }` |
| `meeting.updated` | `user` (CEO) | A meeting is edited | `before { startsAt, endsAt, version }`, `after { startsAt, endsAt, version, timeChanged, responsesReset, responsesResetAt, attendeesAdded, attendeesRemoved, attendeesRetained, titleChanged, descriptionChanged, locationChanged, meetingUrlChanged }` |
| `meeting.cancelled` | `user` (CEO) | A meeting is cancelled | `before { status, version }`, `after { status, version }` |
| `meeting.responded` | `user` (attendee) | Accept or decline | `before { response }`, `after { response, version }` |

Meeting titles, descriptions, locations and links are never recorded. Reading notifications is not audited.

## Growth audit actions (Phase 4A.1–4A.3)

| Action | Actor | Recorded |
|---|---|---|
| `growth.company_created` | `user` (CGO) | `after { archived: false }` |
| `growth.company_updated` | `user` (CGO) | `after { nameChanged, websiteUrlChanged, industryChanged, notesChanged }` |
| `growth.company_archived` | `user` (CGO) | `before { archived: false }`, `after { archived: true }` |
| `growth.contact_created` | `user` (CGO) | `after { companyId, doNotContact, archived: false }` |
| `growth.contact_updated` | `user` (CGO) | `before { doNotContact }`, `after { companyId, doNotContact, fullNameChanged, roleTitleChanged, emailChanged, phoneChanged, linkedinUrlChanged, websiteUrlChanged }` |
| `growth.contact_archived` | `user` (CGO) | `before { archived: false }`, `after { companyId, archived: true }` |

| `growth.lead_created` | `user` (CGO) | `after { companyId, primaryContactId, ownerId, source, priority, stage, estimatedValueMinor, currency, expectedCloseOn, nextFollowUpOn }` |
| `growth.lead_updated` | `user` (CGO) | `before` the same fields; `after` the same fields plus `nameChanged`, `sourceDetailChanged`, `version` |
| `growth.lead_stage_changed` | `user` (CGO) | `before { stage, lostReason }`, `after { stage, lostReason, stageRevision }` |
| `growth.lead_reopened` | `user` (CEO/CTO) | `before { stage, lostReason }`, `after { stage, lostReason: null, stageRevision }` |
| `growth.lead_reassigned` | `user` (CEO/CTO) | `before { ownerId }`, `after { ownerId }` |
| `growth.lead_archived` | `user` (CGO) | `before { archived: false, stage }`, `after { archived: true }` |
| `growth.activity_logged` | `user` (CGO) | `after { leadId, companyId, contactId, kind, direction, outcome, hasProof, followUpChanged }` |
| `growth.activity_voided` | `user` (CGO) | `after { voided: true }` |
| `growth.proposal_version_created` | `user` (CGO) | `after { versionNo }` |
| `growth.proposal_submitted` | `user` (CGO) | `after { versionNo, status }` |
| `growth.proposal_approved` / `growth.proposal_rejected` | `user` (CEO/CTO) | `after { versionNo, status }` |
| `growth.proposal_sent` / `growth.proposal_withdrawn` | `user` (CGO) | `after { versionNo, status }` |
| `growth.proposal_acceptance_recorded` | `user` (CGO) | `after { versionNo, method }` |
| `growth.proposal_confirmation_decided` | `user` (CEO/CTO) | `after { versionNo, decision }` |
| `growth.lead_marked_won` | `user` (CGO) | `after { versionNo }` |

Company names, contact names, emails, phones, links, notes and industry text are never recorded. Lead names, source details, stage and lost notes, activity summaries, proof links and void reasons are never recorded either. Proposal document links, summaries, acceptance evidence links, and proposal, acceptance, confirmation, rejection, withdrawal or refusal notes are never recorded.

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

## Marketing audit actions (Phase 4B)

Never recorded: campaign names and objectives, content titles and briefs, proof links, asset labels and URLs.

| Action | Actor | Recorded fields |
|---|---|---|
| `marketing.campaign_created` | `user` (CMO) | `after { status, startsOn, endsOn }` |
| `marketing.campaign_updated` | `user` (CMO) | `before { startsOn, endsOn }`, `after { startsOn, endsOn, nameChanged, objectiveChanged, startsOnChanged, endsOnChanged }` |
| `marketing.campaign_status_changed` | `user` (CMO) | `before { status }`, `after { status }` |
| `marketing.content_created` | `user` (CMO) | `after { status, channel, campaignId, plannedFor }` |
| `marketing.content_updated` | `user` (CMO) | `before` the same fields; `after` the same fields plus `titleChanged`, `campaignIdChanged`, `plannedForChanged`, `briefChanged` |
| `marketing.content_status_changed` | `user` (CMO) | `before { status }`, `after { status, proofRecorded }` |
| `marketing.content_outcome_recorded` | `user` (CMO) | `before`/`after { reach, engagements, clicks }` |
| `marketing.asset_added` / `marketing.asset_removed` | `user` (CMO) | `after { contentId, kind }` / `after { contentId, removed: true }` |

## Operations audit actions (Phase 4C)

Never recorded: incident titles, summaries, notes, resolutions and post-incident notes; release names, notes and checklist labels; automation purposes and triggers; run error summaries.

| Action | Actor | Recorded fields |
|---|---|---|
| `operations.incident_created` | `user` (VP) | `after { severity, status, ownerId }` |
| `operations.incident_updated` | `user` (VP) | `before { severity, ownerId }`, `after { severity, ownerId, titleChanged, severityChanged, ownerIdChanged, summaryChanged }` |
| `operations.incident_status_changed` | `user` (VP) | `before { status }`, `after { status, noteAdded }` |
| `operations.incident_note_added` / `operations.incident_post_note_added` | `user` (VP) | `after { status }` / `after { postIncidentNote: true }` |
| `operations.release_created` / `operations.release_updated` | `user` (VP) | `after { environment, status, plannedFor }` / changed-field flags |
| `operations.release_checklist_item_added` / `_changed` | `user` (VP) | `after { releaseId }` / `before { done }`, `after { releaseId, done }` |
| `operations.release_status_changed` | `user` (VP or CEO/CTO) | `before { status }`, `after { status, environment, noteAdded }` |
| `operations.automation_created` / `_updated` | `user` (VP) | `after { status }` / changed-field flags |
| `operations.automation_status_changed` | `user` (VP or CEO/CTO) | `before { status }`, `after { status, noteAdded }` |
| `operations.automation_run_recorded` | `user` (VP) | `after { automationId, outcome }` |
