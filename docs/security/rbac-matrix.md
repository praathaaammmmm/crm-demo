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
