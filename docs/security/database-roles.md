# Database Roles and Grants

The application connects with least-privilege roles. Grants are written explicitly in migrations. A new table has no access until a migration grants it.

## Roles

| Role | Login | Used by | Purpose |
|---|---|---|---|
| `crm_migrator` | yes | migration runner, `bootstrap.ts`, future break-glass commands | Owns the databases and all tables; changes schema |
| `crm_app` | yes | HTTP API (`server.ts`) | Reads and writes business data within column grants |
| `crm_worker` | yes | Worker (`worker.ts`) | Processes outbox events; minimal table access |
| `crm_outbox_owner` | no | Owner of `outbox_schedule_system_event()` | INSERT on `outbox_events`, nothing else |

All roles are created `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`.

Local roles and databases (`crm`, `crm_test_template`) are created by `infra/docker/postgres/init-roles.sh` on first container start. In other environments they are created by an operator following the same definitions. Passwords come from environment variables and are never committed.

`crm_migrator` is granted membership in `crm_outbox_owner` `WITH INHERIT FALSE, SET TRUE`: it can assign that role as the function owner but does not inherit its rights.

## Shared rules

- `PUBLIC` has no access: `REVOKE ALL` on the databases, schema `public`, all tables and all functions. Functions created by future migrations are not executable by `PUBLIC` (default privileges).
- `CONNECT` on the databases only for `crm_app` and `crm_worker`. `USAGE` on schema `public` for `crm_app`, `crm_worker` and `crm_outbox_owner`.
- No access for application roles to schema `drizzle` (migration history).
- **No `DELETE` or `TRUNCATE` for any application role on any table.**
- Records are archived (`archived_at`), not deleted.

## `crm_app` grants (Phase 1)

| Table | Grants |
|---|---|
| `users` | SELECT; INSERT (`email`, `name`, `role`, `password_hash`, `must_change_password`, `created_by`); UPDATE (`name`, `role`, `password_hash`, `must_change_password`, `status`, `deactivated_at`, `failed_login_count`, `locked_until`, `updated_at`) |
| `sessions` | SELECT; INSERT (`user_id`, `token_hash`); UPDATE (`ended_at`, `end_reason`) |
| `attendance_events` | SELECT; INSERT (`user_id`, `session_id`, `kind`, `occurred_at`) |
| `approval_requests` | SELECT; INSERT (`type`, `target_user_id`, `payload`, `reason`, `requested_by`); UPDATE (`status`, `decided_by`, `decided_at`, `decision_note`) |
| `audit_events` | SELECT; INSERT (`actor_type`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `before`, `after`, `request_id`) |
| `outbox_events` | None in Phase 1. INSERT only from Phase 2 |

`crm_app` cannot set `is_super_admin`, `reports_to_user_id`, `reports_to_is_super_admin`, `sessions.created_at` or `sessions.expires_at`, `audit_events.occurred_at`, or any `id`.

## `crm_app` grants (projects and tasks, migration 0007)

| Table | Grants |
|---|---|
| `projects` | SELECT; INSERT (`name`, `description`, `created_by`). No UPDATE: editing and archiving are out of scope |
| `tasks` | SELECT; INSERT (`project_id`, `title`, `description`, `priority`, `due_date`, `assignee_id`, `created_by`); UPDATE (`title`, `description`, `priority`, `due_date`, `assignee_id`, `status`, `completed_at`, `updated_at`) |
| `task_updates` | SELECT; INSERT (`task_id`, `author_id`, `from_status`, `to_status`, `note`) |
| `task_proofs` | SELECT; INSERT (`task_id`, `author_id`, `url`, `note`) |
| `task_reviews` | SELECT; INSERT (`task_id`, `reviewer_id`, `decision`, `note`) |

`crm_app` cannot change a task's `project_id`, `created_by`, `created_at` or `assignee_is_super_admin`. The task history tables (`task_updates`, `task_proofs`, `task_reviews`) are append-only for application roles: no UPDATE or DELETE. `crm_worker` has no access to any of these tables.

## `crm_app` grants (quality, migration 0009)

| Table | Grants |
|---|---|
| `qa_checks` | SELECT; INSERT (`task_id`, `title`, `created_by`); UPDATE (`latest_outcome`, `latest_result_at`) |
| `qa_results` | SELECT; INSERT (`qa_check_id`, `outcome`, `note`, `evidence_url`, `recorded_by`) |
| `defects` | SELECT; INSERT (`task_id`, `qa_check_id`, `title`, `severity`, `reproduction_steps`, `reported_by`); UPDATE (`title`, `severity`, `reproduction_steps`, `status`, `updated_at`, `resolved_at`) |
| `defect_updates` | SELECT; INSERT (`defect_id`, `author_id`, `note`, `evidence_url`, `from_status`, `to_status`) |
| `release_readiness` | SELECT; INSERT (`project_id`, `label`, `readiness`, `note`, `decided_by`) |

`crm_app` cannot move a QA check or defect to another task, change who reported or created it, or rewrite history: `qa_results`, `defect_updates` and `release_readiness` are append-only (no UPDATE or DELETE). No DELETE or TRUNCATE on any quality table. `crm_worker` has no access.

### Credential hashes

`crm_app` can read `users.password_hash` and `sessions.token_hash` because login and session checks need them. This is accepted for Phase 1 on one condition: **no API response, log line or audit record may contain `password_hash` or `token_hash`**. Response contracts and audit allowlists must exclude them, and tests must assert it.

## `crm_app` grants (meetings, migration 0011)

| Table | Grants |
|---|---|
| `meetings` | SELECT; INSERT (`title`, `description`, `starts_at`, `ends_at`, `location`, `meeting_url`, `project_id`, `task_id`, `organizer_id`); UPDATE (`title`, `description`, `starts_at`, `ends_at`, `location`, `meeting_url`, `project_id`, `task_id`, `status`, `version`, `cancelled_at`, `updated_at`, `responses_reset_at`) |
| `meeting_attendees` | SELECT; INSERT (`meeting_id`, `user_id`); UPDATE (`response`, `responded_at`, `removed_at`, `added_at`) |
| `notifications` | SELECT; UPDATE (`read_at`). No INSERT: only the worker creates notifications |
| `outbox_events` | INSERT (`event_type`, `payload`, `dedupe_key`, `available_at`), limited by a trigger to meeting reminder events. No SELECT or UPDATE |

No DELETE or TRUNCATE on any meeting table.

## `crm_app` grants (Growth, migration 0013)

| Table | Grants |
|---|---|
| `growth_companies` | SELECT; INSERT (`name`, `website_url`, `industry`, `notes`, `owner_id`, `created_by`); UPDATE (`name`, `website_url`, `industry`, `notes`, `archived_at`, `updated_at`) |
| `growth_contacts` | SELECT; INSERT (`company_id`, `full_name`, `role_title`, `email`, `phone`, `linkedin_url`, `website_url`, `do_not_contact`, `owner_id`); UPDATE (`full_name`, `role_title`, `email`, `phone`, `linkedin_url`, `website_url`, `do_not_contact`, `archived_at`, `updated_at`) |

`crm_app` cannot set `owner_is_super_admin` (default `false`) or change `owner_id`, `company_id`, `created_by` or `created_at`. No DELETE or TRUNCATE. `crm_worker` has no access.

## `crm_app` grants (Growth leads, migration 0015)

| Table | Grants |
|---|---|
| `growth_leads` | SELECT; INSERT (`name`, `company_id`, `primary_contact_id`, `source`, `source_detail`, `owner_id`, `priority`, `estimated_value_minor`, `expected_close_on`, `next_follow_up_on`, `created_by`); UPDATE (`name`, `company_id`, `primary_contact_id`, `source`, `source_detail`, `owner_id`, `stage`, `priority`, `estimated_value_minor`, `expected_close_on`, `next_follow_up_on`, `lost_reason`, `lost_note`, `lost_at`, `version`, `updated_at`, `archived_at`) |
| `growth_stage_changes` | SELECT; INSERT (`lead_id`, `from_stage`, `to_stage`, `actor_id`, `note`, `lost_reason`, `stage_revision`) |
| `growth_activities` | SELECT; INSERT (`lead_id`, `company_id`, `contact_id`, `kind`, `direction`, `outcome`, `occurred_at`, `summary`, `proof_url`, `author_id`); UPDATE (`voided_at`, `voided_by`, `void_reason`) |

`crm_app` cannot insert `stage` (always `new`) or write `stage_revision` on leads, `currency`, `owner_is_super_admin`, `created_by` (update) or any `created_at`. No UPDATE on stage history, no DELETE or TRUNCATE on any of the three tables. `crm_worker` has no access.

## `crm_app` grants (Growth proposals, migration 0017)

| Table | Grants |
|---|---|
| `growth_proposals` | SELECT only; cache INSERT/UPDATE is trigger-only |
| `growth_proposal_versions` | SELECT; INSERT (`proposal_id`, `lead_id`, `document_url`, `amount_minor`, `valid_until`, `summary`, `created_by`) |
| `growth_proposal_events` | SELECT; INSERT (`proposal_id`, `version_id`, `from_status`, `to_status`, `actor_id`, `note`) |
| `growth_proposal_acceptances` | SELECT; INSERT (`proposal_id`, `version_id`, `lead_id`, `method`, `evidence_url`, `note`, `accepted_on`, `recorded_by`) |
| `growth_proposal_confirmations` | SELECT; INSERT (`acceptance_id`, `decision`, `note`, `actor_id`) |

`crm_app` has no proposal-table UPDATE, DELETE or TRUNCATE grants. It cannot supply proposal cache fields, version number/currency, event sequence, derived acceptance fields, confirmation proposal/version fields or timestamp columns. `crm_worker` has no proposal-table access.

## `crm_worker` grants (Phase 1)

| Object | Grants |
|---|---|
| `outbox_events` | SELECT; UPDATE (`status`, `attempts`, `available_at`, `locked_by`, `locked_until`, `last_error`, `processed_at`) |
| `outbox_schedule_system_event(text, timestamptz)` | EXECUTE |
| `sessions` | SELECT (`id`, `user_id`, `expires_at`, `ended_at`); UPDATE (`ended_at`, `end_reason`) |
| `attendance_events` | INSERT (`user_id`, `session_id`, `kind`, `occurred_at`) |
| Everything else | None |

From migration 0011 the worker also has SELECT on `meetings` (`id`, `status`, `version`, `starts_at`), `meeting_attendees` (`meeting_id`, `user_id`, `response`, `removed_at`), `users` (`id`, `status`) and `notifications` (`source_event_id`, `recipient_id`), and INSERT on `notifications` (`recipient_id`, `kind`, `meeting_id`, `meeting_version`, `minutes_before`, `source_event_id`).

The worker has no write access to business tables beyond ending sessions, recording attendance and creating notifications. Future handlers get new grants only through a reviewed, approved migration.

## Database-enforced invariants

| Invariant | Mechanism |
|---|---|
| Audit events cannot change | Triggers on `audit_events` raise an error on `UPDATE`, `DELETE`, `TRUNCATE` for every role, including the owner |
| At most one Super Admin | Unique index on `users (is_super_admin) WHERE is_super_admin` |
| Super Admin is the `ceo_cto` role | `CHECK (is_super_admin = (role = 'ceo_cto'))` |
| Super Admin cannot be deactivated | `CHECK (NOT (is_super_admin AND status = 'deactivated'))` |
| Everyone else reports directly to the Super Admin | `MATCH FULL` composite foreign key, `CHECK`s and a `BEFORE INSERT` trigger ([ADR 0005](../adrs/0005-direct-report-hierarchy.md)) |
| No Super Admin transfer in Phase 1 | The constraints above block it; no transfer procedure exists ([break-glass runbook](../runbooks/super-admin-break-glass.md)) |
| Sessions last exactly 12 hours | `created_at` and `expires_at` set by database defaults; `CHECK (expires_at = created_at + interval '12 hours')`; no app grant on either column |
| Expired sessions end at their expiry time | `CHECK (end_reason IS DISTINCT FROM 'expired' OR ended_at = expires_at)` |
| Attendance belongs to the session's user | Composite foreign key `(session_id, user_id) → sessions (id, user_id)`; one `login` and one `session_end` per session |
| Approval decisions are consistent | `CHECK`s tie `decided_at`, `decided_by` and `decision_note` to `status`; a request cannot target its requester; one pending request per type and target |
| Outbox rows follow allowed status changes | Triggers on `outbox_events`: allowed transitions, final states, immutable columns, no reclaim before the lock expires, attempts never decrease (see [outbox.md](../architecture/outbox.md)) |
| Worker can only schedule allowlisted system events | `SECURITY DEFINER` function with fixed allowlist; no direct INSERT grant |
| Scheduler EXECUTE is limited to the worker | `crm_worker` is the only application runtime role with a direct EXECUTE grant on `outbox_schedule_system_event()`, granted by the owner `crm_outbox_owner` (migration 0005). `PUBLIC`'s default EXECUTE is revoked, and `crm_app` has no EXECUTE permission. The function owner, `crm_outbox_owner`, retains inherent owner privileges; `crm_migrator` may `SET ROLE` to that owner solely for approved migrations |
| Audit time cannot be forged | `occurred_at` is set by the database; `crm_app` has no grant on it |
| The CEO/CTO is never a task assignee | Composite foreign key `tasks (assignee_id, assignee_is_super_admin) → users (id, is_super_admin)` with `CHECK (assignee_is_super_admin = false)`; `crm_app` has no grant on `assignee_is_super_admin` |
| `completed_at` matches the completed status | `CHECK ((status = 'completed') = (completed_at IS NOT NULL))` |
| Proof links are https only | `CHECK` on `task_proofs.url`: `https://` followed by a host, at most 2,000 characters; a proof needs a URL or a note |
| Requesting changes needs a note | `CHECK (decision <> 'changes_requested' OR note IS NOT NULL)` on `task_reviews` |
| Task history cannot be rewritten by the app | `task_updates`, `task_proofs`, `task_reviews`: SELECT and INSERT only for `crm_app` |
| A defect's QA check is on the same task | Composite foreign key `defects (qa_check_id, task_id) → qa_checks (id, task_id)` |
| `resolved_at` matches final defect statuses | `CHECK ((status IN ('verified', 'wont_fix')) = (resolved_at IS NOT NULL))` |
| QA and defect notes where required | `CHECK`s: failed/blocked QA results need a note; moves to `fixed`, `wont_fix` and reopening `fixed → open` need a note; readiness other than `ready` needs a note |
| Evidence links are https only | `CHECK` on `qa_results.evidence_url` and `defect_updates.evidence_url`, same rule as proof links |
| A QA check's latest outcome and time are set together | `CHECK ((latest_outcome IS NULL) = (latest_result_at IS NULL))` |
| Only the CEO/CTO organises meetings | Composite foreign key `meetings (organizer_id, organizer_is_super_admin) → users (id, is_super_admin)` with `CHECK (organizer_is_super_admin = true)` |
| A meeting's task belongs to its project | Composite foreign key `meetings (task_id, project_id) → tasks (id, project_id)` |
| Meeting times and links are valid | `CHECK`s: `ends_at > starts_at`, at most 12 hours, https-only link, `cancelled_at` set exactly when cancelled, `responses_reset_at >= created_at` |
| Attendee responses are consistent | `CHECK ((response = 'pending') = (responded_at IS NULL))` |
| One notification per reminder event and recipient | `UNIQUE (source_event_id, recipient_id)`; `minutes_before IN (10, 5, 2)` |
| The API can only enqueue meeting reminders | `BEFORE INSERT` trigger `outbox_events_app_insert_guard` for `crm_app` |
| Growth owners are active CGOs, never the CEO/CTO | Trigger `growth_owner_guard()` on insert or owner change; `MATCH FULL` composite foreign key `(owner_id, owner_is_super_admin) → users (id, is_super_admin)` with `CHECK (owner_is_super_admin = false)` |
| Every lead stage change has exactly one matching history row | Trigger `growth_leads_stage_revision()`, insert guard `growth_stage_changes_insert_guard()`, `UNIQUE (lead_id, stage_revision)`, deferred constraint trigger `growth_leads_stage_history_required` |
| Stage history is append-only; activities are never deleted and voided once | `growth_append_only_guard()` on UPDATE/DELETE/TRUNCATE of `growth_stage_changes` and DELETE/TRUNCATE of `growth_activities`; `growth_activities_void_guard()` |
| Activity links agree; outbound needs a reachable contact | `CHECK (direction = 'inbound' OR contact_id IS NOT NULL)`; trigger `growth_activities_link_guard()` (reads the contact `FOR SHARE`) |
| Archived Growth records are read-only | Triggers `growth_companies_archived_guard()` and `growth_contacts_parent_guard()` (the latter reads the parent company `FOR SHARE`) |
| Growth names cannot be bypassed by spacing or case | `CHECK`s require normalised names; unique `lower(name)` among non-archived companies; unique `(company_id, lower(email))` among non-archived contacts |
| Every contact can be reached | `CHECK (num_nonnulls(email, phone, linkedin_url, website_url) >= 1)` |
| Proposal histories cannot be rewritten | `growth_proposal_versions`, `growth_proposal_events`, `growth_proposal_acceptances` and `growth_proposal_confirmations` have append-only triggers for every role; no application DELETE or TRUNCATE grants |
| Proposal cache follows immutable events only | `growth_proposals_write_guard()` requires nested trigger execution (`pg_trigger_depth() > 1`); a deferred cache check matches its status, current version and sequence to the latest event |
| Won lead data is complete and final | `growth_leads_won_fields`, `growth_leads_won_before()` and stage-history/won-event deferred checks derive snapshot values from the current accepted version and freeze the won lead |
| Quality history cannot be rewritten by the app | `qa_results`, `defect_updates`, `release_readiness`: SELECT and INSERT only for `crm_app` |

## Migrations

Phase 1 is **SQL-first**: the reviewed SQL files are the source of truth, applied only by `packages/database/src/migrate.ts` as `crm_migrator`. Phase 1 does not include `drizzle-kit`; migrations are never generated from code and no Drizzle snapshots exist. See [overview.md](../architecture/overview.md#database-migrations).

| # | File | Content |
|---|---|---|
| 0000 | `core_tables.sql` | Enums, tables, constraints, indexes |
| 0001 | `users_hierarchy.sql` | Reporting-line trigger |
| 0002 | `audit_append_only.sql` | Audit immutability triggers |
| 0003 | `outbox_guard_and_scheduler.sql` | Outbox triggers and scheduling function |
| 0004 | `grants.sql` | Revokes and grants listed above |
| 0005 | `scheduler_execute_grants.sql` | Acting as the function owner `crm_outbox_owner`: revokes `PUBLIC` EXECUTE on the scheduler and grants EXECUTE to `crm_worker` only |
| 0006 | `projects_tasks.sql` | Task enums; `projects`, `tasks`, `task_updates`, `task_proofs`, `task_reviews` with constraints and indexes |
| 0007 | `projects_tasks_grants.sql` | Revokes from `PUBLIC`; `crm_app` grants for projects and tasks listed above |
| 0008 | `quality.sql` | Quality enums; `qa_checks`, `qa_results`, `defects`, `defect_updates`, `release_readiness` with constraints and indexes |
| 0009 | `quality_grants.sql` | Revokes from `PUBLIC`; `crm_app` grants for quality tables listed above |
| 0010 | `meetings.sql` | Meeting enums; `meetings`, `meeting_attendees`, `notifications`; `tasks (id, project_id)` unique; `crm_app` outbox insert guard |
| 0011 | `meetings_grants.sql` | Revokes from `PUBLIC`; `crm_app` and `crm_worker` grants for meetings listed above |
| 0012 | `growth_companies.sql` | `growth_companies`, `growth_contacts`; owner guard and archive guard triggers |
| 0013 | `growth_companies_grants.sql` | Revokes from `PUBLIC`; `crm_app` grants for Growth listed above |
| 0014 | `growth_leads.sql` | Lead, stage-history and activity enums and tables; stage-revision, link, state, append-only, void and deferred history-completeness triggers |
| 0015 | `growth_leads_grants.sql` | Revokes from `PUBLIC`; `crm_app` grants for leads listed above |
| 0016 | `growth_proposals.sql` | Proposal cache, immutable versions/events/acceptance/confirmation workflow and won-lead guards |
| 0017 | `growth_proposals_grants.sql` | Revokes from `PUBLIC`; least-privilege proposal grants |
| 0018 | `marketing.sql` | Marketing enums; `marketing_campaigns`, `marketing_content`, `marketing_asset_links`; status, finality, add-only link and no-delete triggers |
| 0019 | `marketing_grants.sql` | Revokes from `PUBLIC`; `crm_app` SELECT and column-limited INSERT/UPDATE for Marketing; no DELETE; `crm_worker` nothing |
| 0020 | `operations.sql` | Operations enums; incidents and their timeline, releases with checklist items and decisions, automations with changes and runs; transition, checklist-completeness, append-only and no-delete triggers |
| 0021 | `operations_grants.sql` | Revokes from `PUBLIC`; `crm_app` SELECT and column-limited INSERT/UPDATE (history tables INSERT only); no DELETE; `crm_worker` nothing |

A function's default `PUBLIC` EXECUTE is granted by its owner, and only the grantor can revoke it. Because the scheduler is owned by `crm_outbox_owner`, its grants are changed with `SET ROLE crm_outbox_owner` inside the migration; `REVOKE ... FROM PUBLIC` run as `crm_migrator` has no effect on it.

Destructive migrations require explicit user approval.

## Tests

`apps/api/test/db-permissions.test.ts` and `apps/api/test/audit-immutability.test.ts` connect as the real roles and verify each grant and each refusal. `apps/api/test/tasks-constraints.test.ts` verifies the project and task constraints, and `apps/api/test/quality-constraints.test.ts` verifies the quality constraints.
