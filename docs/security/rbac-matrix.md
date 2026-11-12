# RBAC Matrix

Roles and their permissions are defined in code in `packages/permissions` ([ADR 0004](../adrs/0004-roles-defined-in-code.md)). This document must match `roles.ts` and `matrix.test.ts`. Any change to either requires updating this file.

## Principles

- **Deny by default.** A role has only the permissions listed here.
- **One Super Admin**: the CEO/CTO (`ceo_cto`). Enforced by the database.
- **Everyone else reports directly to the CEO/CTO** ([ADR 0005](../adrs/0005-direct-report-hierarchy.md)).
- **One role per user**, stored in `users.role`.
- The API always enforces permissions. The UI only uses them to show or hide controls.

## Roles

| Role | Scope |
|---|---|
| `ceo_cto` | Super Admin. Full access; sole approver |
| `cfo` | Finance only |
| `cgo` | Growth and sales only |
| `cmo` | Marketing only |
| `vp_engineering_quality` | Tasks, engineering, QA, testing, incidents, releases |
| `founder` | Assigned work only |
| `employee` | Assigned work only |
| `intern` | Assigned work only |
| `contractor` | Assigned work only |

Area permissions for finance, growth, marketing and engineering arrive with their modules in later phases.

## Phase 1 permissions

| Permission | ceo_cto | cfo | cgo | cmo | vp_eng_quality | founder | employee | intern | contractor |
|---|---|---|---|---|---|---|---|---|---|
| `attendance:read_own` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `attendance:read_all` | ✔ | | | | | | | | |
| `users:create` | ✔ | | | | | | | | |
| `users:read_directory` | ✔ | ✔ | ✔ | ✔ | ✔ | | | | |
| `users:read_email` | ✔ | | | | | | | | |
| `approvals:request_role_change` | ✔ | ✔ | ✔ | ✔ | ✔ | | | | |
| `approvals:request_deactivation` | ✔ | ✔ | ✔ | ✔ | ✔ | | | | |
| `approvals:decide` | ✔ | | | | | | | | |
| `approvals:read_all` | ✔ | | | | | | | | |
| `audit:read` | ✔ | | | | | | | | |

Every authenticated user can also read their own profile (`/auth/me`), change their own password and log out. Requesters can read and cancel their own approval requests.

## Projects and tasks permissions

| Permission | ceo_cto | cfo | cgo | cmo | vp_eng_quality | founder | employee | intern | contractor |
|---|---|---|---|---|---|---|---|---|---|
| `projects:create` | ✔ | | | | | | | | |
| `projects:read_all` | ✔ | | | | ✔ | | | | |
| `projects:read_assigned` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `tasks:create` | ✔ | | | | | | | | |
| `tasks:manage` (edit, reassign) | ✔ | | | | | | | | |
| `tasks:read_all` | ✔ | | | | ✔ | | | | |
| `tasks:review` (approve, request changes, mark complete) | ✔ | | | | | | | | |
| `tasks:read_assigned` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `tasks:update_assigned` (status, notes, proof, submit) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

- The `*_assigned` permissions apply only to tasks whose current assignee is the caller, and to projects containing such a task. Anything else returns 404.
- The CEO/CTO can see every task but cannot act as an assignee; assignee-only actions return 403 for the CEO/CTO.
- The CEO/CTO can never be assigned a task. This is enforced by the API and by the database.
- Task review is a task workflow, not one of the approval-gated actions below.
- VP Engineering & Quality has **read-only** `tasks:read_all` and `projects:read_all` so quality items can be attached to any task. Task creation, editing, reassignment and review (`tasks:create`, `tasks:manage`, `tasks:review`) and `projects:create` stay CEO/CTO-only ([ADR 0006](../adrs/0006-quality-workflow.md)).

## Quality permissions

| Permission | ceo_cto | cfo | cgo | cmo | vp_eng_quality | founder | employee | intern | contractor |
|---|---|---|---|---|---|---|---|---|---|
| `quality:read_all` (all QA checks, defects, summary, readiness history) | ✔ | | | | ✔ | | | | |
| `quality:manage` (checks, results, defects, verify/reopen/won't fix, readiness) | ✔ | | | | ✔ | | | | |
| `quality:read_assigned` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `quality:respond_assigned` (start/fix defects, notes, evidence) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

- The `*_assigned` quality permissions apply only to QA checks and defects on tasks whose **current** assignee is the caller. Reassigning a task moves access. Anything else returns 404.
- **Self-QA conflict:** when a quality manager (VP) is the current assignee of the linked task, they are treated as an assignee for that task's quality items. They may read them, add notes and evidence, and use assignee defect moves only. Creating QA checks, recording QA results, creating or editing defects (including severity), verifying, reopening, closing as won't fix, and setting readiness for a project containing their own task all return 403. The CEO/CTO, who can never be assigned a task, can do all of these.
- Defect status moves follow `DEFECT_WORKFLOW` in `packages/contracts/src/quality.ts`.

## Meetings and notifications permissions

| Permission | ceo_cto | cfo | cgo | cmo | vp_eng_quality | founder | employee | intern | contractor |
|---|---|---|---|---|---|---|---|---|---|
| `meetings:manage` (schedule, edit, cancel) | ✔ | | | | | | | | |
| `meetings:read_all` (every meeting, summary) | ✔ | | | | | | | | |
| `meetings:read_invited` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `meetings:respond` (accept or decline) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `notifications:read_own` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

- `meetings:read_invited` and `meetings:respond` apply only to meetings where the caller is a current (not removed) attendee. Anything else returns 404; the CEO/CTO gets 403 on responding to a meeting they do not attend.
- Notifications are visible only to their recipient; anyone else's return 404.

## Growth permissions (Phase 4A.1–4A.4)

| Permission | ceo_cto | cfo | cgo | cmo | vp_eng_quality | founder | employee | intern | contractor |
|---|---|---|---|---|---|---|---|---|---|
| `growth:read_all` (companies, leads, the `/growth` overview report and the stale filter, 4A.4) | ✔ | | ✔ | | | | | | |
| `growth:read_contacts` (contact personal data) | ✔ | | ✔ | | | | | | |
| `growth:manage` (create, edit, archive companies, contacts and leads; move stages; log and void activities) | | | ✔ | | | | | | |
| `growth:reassign` (change a lead's owner, 4A.2) | ✔ | | | | | | | | |
| `growth:reopen` (reopen a lost lead, 4A.2) | ✔ | | | | | | | | |
| `growth:approve_proposals` (approve/reject proposals; confirm/refuse qualifying acceptances) | ✔ | | | | | | | | |

- The CEO/CTO is read-only for ordinary Growth operations but is the sole proposal approver (`growth:approve_proposals`); it never gets `growth:manage` ([ADR 0009](../adrs/0009-growth-proposals.md)).
- The CGO alone operates proposal versions, submit/send/withdraw, acceptance recording and explicit mark-won. CEO/CTO alone approves, rejects, confirms and refuses. Every other role receives 403.
- The overview report (`GET /growth/reports/overview`) needs only `growth:read_all`: it returns no contact data. It is read-only and not audited ([ADR 0010](../adrs/0010-growth-reporting.md)).
- Reading activities needs both `growth:read_all` and `growth:read_contacts`.
- Growth records can only be assigned to an active CGO (database trigger) and never to the CEO/CTO (composite foreign key).
- Status codes: missing permission 403 (checked first), malformed or unknown id 404, invalid body 400, conflicts (archived records, duplicates) 409.

## Marketing and Operations permissions (Phases 4B and 4C)

| Permission | ceo_cto | cfo | cgo | cmo | vp_eng_quality | founder | employee | intern | contractor |
|---|---|---|---|---|---|---|---|---|---|
| `marketing:read_all` (campaigns, content, asset links, outcomes, dashboard) | ✔ | | | ✔ | | | | | |
| `marketing:manage` (every Marketing write) | | | | ✔ | | | | | |
| `operations:read_all` (incidents, releases, automations, runs, dashboard) | ✔ | | | | ✔ | | | | |
| `operations:manage` (every Operations write except approvals) | | | | | ✔ | | | | |
| `operations:approve` (approve/reject production releases; approve automation go-live or send it back) | ✔ | | | | | | | | |

- The CEO/CTO never holds `marketing:manage` or `operations:manage` ([ADR 0011](../adrs/0011-marketing.md), [ADR 0012](../adrs/0012-engineering-operations.md)).
- Release and automation steps check the step's actor: approval steps need `operations:approve`, every other step `operations:manage`.

## Actions requiring CEO approval

Defined in `packages/permissions/src/approvals.ts`.

| Action | Phase |
|---|---|
| `user.role_change` | 1 |
| `user.deactivate` | 1 |
| Client deletion (archiving) | Later |
| Sensitive deployment actions | Later |
| Workflow and automation changes | Later |
| Enabling or reconfiguring an integration | Later |

When the CEO/CTO performs one of these actions, the request is created and approved in the same transaction and fully audited.

## Rules that are not role-based

- No role can grant Super Admin. Only the one-time bootstrap command can set it. Super Admin transfer is not supported in Phase 1.
- No user can be made another user's manager.
- A request cannot target the requester or the Super Admin.
- Task assignees, and project roles added later (lead, reviewer), are not managers and grant no access to a person's data.
