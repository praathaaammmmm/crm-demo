# ADR 0006: Quality Workflow (QA Checks, Defects, Release Readiness)

- Status: Accepted
- Date: 2026-11-11

## Context

VP Engineering & Quality needs to record QA outcomes and manage defects against tasks, and to say whether each project is ready to release. The CEO/CTO needs to see every quality blocker. Assignees must see and respond only to quality items on their own tasks. Every material action must be audited, and the rules must not give anyone more access than their role permits.

## Decision

### Model

- **QA checks** belong to one task. **QA results** are append-only; the check mirrors its newest result (`latest_outcome`, `latest_result_at`) in the same transaction, under a row lock.
- **Defects** belong to one task and may link to the QA check that found them; a composite foreign key guarantees the check is on the same task. **Defect updates** (notes, https evidence, status changes) are append-only.
- **Release readiness** is an append-only log per project. The newest row by `(decided_at, id)` is the current decision. A project with no decision counts as `not_ready` everywhere: lists, blocker calculations and dashboard counts.
- Access to a quality item follows its task's **current** assignee, so reassigning a task moves access, exactly as for tasks.

### Workflow

`DEFECT_WORKFLOW` in `packages/contracts/src/quality.ts` is the single source of the defect status rules, used by the API and the web:

| From | Assignee | VP / CEO |
|---|---|---|
| `open` | `in_progress` | `wont_fix` (note) |
| `in_progress` | `fixed` (note) | `wont_fix` (note) |
| `fixed` | — | `verified`, `open` (reopen, note) |
| `verified`, `wont_fix` | final | final |

The server keeps policy, locking and note enforcement; the database also enforces the note rules.

**Self-QA conflict:** when a quality manager is the current assignee of the linked task, they are treated as an assignee for that task's quality items: they may read them, add notes and evidence, and use assignee defect moves only. Creating QA checks, recording results, creating or editing defects (including severity), verifying, reopening, closing as won't fix, and setting readiness for a project containing their own task are refused with 403. The CEO/CTO, who can never be assigned a task, keeps every action. Reassigning the task restores the manager's actions.

### Readiness gate

`ready` is refused (409) while the project has an open critical or high defect or a QA check whose latest outcome is failed or blocked. The decision is a point-in-time record: blocker counts at decision time are written to the audit event. A blocker raised later does not change past decisions, but the project then appears in the CEO/VP blocker rows until a new decision is made.

### Permissions

- New permissions: `quality:read_all`, `quality:manage` (CEO/CTO, VP) and `quality:read_assigned`, `quality:respond_assigned` (every role with tasks).
- VP Engineering & Quality also gets **read-only** `tasks:read_all` and `projects:read_all`, so quality items can be attached to any task. Task creation, editing, reassignment and review remain CEO/CTO-only.

### Summary counts

`GET /quality/summary` returns exact, uncapped aggregate counts (open critical/high defects, failed/blocked QA checks, projects not ready or at risk). Only the per-project readiness/blocker rows are capped at 250, with `capped: true` and a UI notice.

## Consequences

- VP sees all tasks and projects read-only; the web shows the all-tasks views without create, edit or review controls.
- Quality text (titles, notes, steps, evidence URLs, labels) stays in the quality tables and never enters audit events.
- Two migrations: `0008_quality.sql` (tables and constraints) and `0009_quality_grants.sql` (least-privilege grants; history tables append-only).
- Deleting quality items is not supported; there are no DELETE grants.
