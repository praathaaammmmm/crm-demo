import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./db.js";
import { createSuperAdmin, pgErrorCode } from "./helpers.js";

/** Each statement must be refused by grants (42501) when run as crm_app. */
const REFUSED_FOR_APP: [string, SQL][] = [
  ["update users.email", sql`UPDATE users SET email = 'changed@example.test'`],
  ["update users.reports_to_user_id", sql`UPDATE users SET reports_to_user_id = NULL`],
  ["update users.is_super_admin", sql`UPDATE users SET is_super_admin = false`],
  ["update approval type", sql`UPDATE approval_requests SET type = 'user.deactivate'`],
  ["update approval target", sql`UPDATE approval_requests SET target_user_id = NULL`],
  ["update approval payload", sql`UPDATE approval_requests SET payload = '{}'::jsonb`],
  ["update approval reason", sql`UPDATE approval_requests SET reason = 'changed'`],
  ["update approval requester", sql`UPDATE approval_requests SET requested_by = NULL`],
  ["update approval requested_at", sql`UPDATE approval_requests SET requested_at = now()`],
  ["delete users", sql`DELETE FROM users`],
  ["delete approval_requests", sql`DELETE FROM approval_requests`],
  ["delete sessions", sql`DELETE FROM sessions`],
  ["update audit_events", sql`UPDATE audit_events SET action = 'x.y'`],
  ["delete audit_events", sql`DELETE FROM audit_events`],
  ["truncate audit_events", sql`TRUNCATE audit_events`],
  ["update attendance_events", sql`UPDATE attendance_events SET kind = 'login'`],
  ["delete attendance_events", sql`DELETE FROM attendance_events`],
  ["truncate attendance_events", sql`TRUNCATE attendance_events`],
  ["read outbox_events", sql`SELECT count(*) FROM outbox_events`],
  // Slice 3: projects and tasks.
  ["update projects", sql`UPDATE projects SET name = 'changed'`],
  ["delete projects", sql`DELETE FROM projects`],
  ["update tasks.project_id", sql`UPDATE tasks SET project_id = NULL`],
  ["update tasks.created_by", sql`UPDATE tasks SET created_by = NULL`],
  ["update tasks.assignee_is_super_admin", sql`UPDATE tasks SET assignee_is_super_admin = true`],
  ["update tasks.created_at", sql`UPDATE tasks SET created_at = now()`],
  ["delete tasks", sql`DELETE FROM tasks`],
  ["truncate tasks", sql`TRUNCATE tasks`],
  ["update task_updates", sql`UPDATE task_updates SET note = 'changed'`],
  ["delete task_updates", sql`DELETE FROM task_updates`],
  ["update task_proofs", sql`UPDATE task_proofs SET url = NULL`],
  ["delete task_proofs", sql`DELETE FROM task_proofs`],
  ["update task_reviews", sql`UPDATE task_reviews SET note = 'changed'`],
  ["delete task_reviews", sql`DELETE FROM task_reviews`],
  // Slice 4: quality.
  ["update qa_checks.task_id", sql`UPDATE qa_checks SET task_id = NULL`],
  ["update qa_checks.title", sql`UPDATE qa_checks SET title = 'changed'`],
  ["delete qa_checks", sql`DELETE FROM qa_checks`],
  ["truncate qa_checks", sql`TRUNCATE qa_checks`],
  ["update qa_results", sql`UPDATE qa_results SET note = 'changed'`],
  ["delete qa_results", sql`DELETE FROM qa_results`],
  ["update defects.task_id", sql`UPDATE defects SET task_id = NULL`],
  ["update defects.reported_by", sql`UPDATE defects SET reported_by = NULL`],
  ["update defects.qa_check_id", sql`UPDATE defects SET qa_check_id = NULL`],
  ["delete defects", sql`DELETE FROM defects`],
  ["truncate defects", sql`TRUNCATE defects`],
  ["update defect_updates", sql`UPDATE defect_updates SET note = 'changed'`],
  ["delete defect_updates", sql`DELETE FROM defect_updates`],
  ["update release_readiness", sql`UPDATE release_readiness SET readiness = 'ready'`],
  ["delete release_readiness", sql`DELETE FROM release_readiness`],
  ["truncate release_readiness", sql`TRUNCATE release_readiness`],
  // Slice 5: meetings, attendees, notifications and the outbox.
  ["update meetings.created_at", sql`UPDATE meetings SET created_at = now()`],
  ["update meetings.organizer_id", sql`UPDATE meetings SET organizer_id = NULL`],
  ["update meetings.organizer_is_super_admin", sql`UPDATE meetings SET organizer_is_super_admin = false`],
  ["delete meetings", sql`DELETE FROM meetings`],
  ["truncate meetings", sql`TRUNCATE meetings`],
  ["update meeting_attendees.meeting_id", sql`UPDATE meeting_attendees SET meeting_id = NULL`],
  ["update meeting_attendees.user_id", sql`UPDATE meeting_attendees SET user_id = NULL`],
  ["delete meeting_attendees", sql`DELETE FROM meeting_attendees`],
  ["insert notifications", sql`INSERT INTO notifications (recipient_id, kind, meeting_id, meeting_version, minutes_before, source_event_id) VALUES (gen_random_uuid(), 'meeting_reminder', gen_random_uuid(), 1, 2, gen_random_uuid())`],
  ["update notifications.recipient_id", sql`UPDATE notifications SET recipient_id = NULL`],
  ["delete notifications", sql`DELETE FROM notifications`],
  ["update outbox_events", sql`UPDATE outbox_events SET status = 'done'`],
  ["delete outbox_events", sql`DELETE FROM outbox_events`],
  // Phase 4A.1: growth companies and contacts.
  ["insert growth_companies.owner_is_super_admin", sql`INSERT INTO growth_companies (name, owner_id, created_by, owner_is_super_admin) VALUES ('X', gen_random_uuid(), gen_random_uuid(), false)`],
  ["update growth_companies.owner_id", sql`UPDATE growth_companies SET owner_id = NULL`],
  ["update growth_companies.owner_is_super_admin", sql`UPDATE growth_companies SET owner_is_super_admin = false`],
  ["update growth_companies.created_by", sql`UPDATE growth_companies SET created_by = NULL`],
  ["update growth_companies.created_at", sql`UPDATE growth_companies SET created_at = now()`],
  ["delete growth_companies", sql`DELETE FROM growth_companies`],
  ["truncate growth_companies", sql`TRUNCATE growth_companies`],
  ["insert growth_contacts.owner_is_super_admin", sql`INSERT INTO growth_contacts (company_id, full_name, email, owner_id, owner_is_super_admin) VALUES (gen_random_uuid(), 'X', 'x@example.test', gen_random_uuid(), false)`],
  ["update growth_contacts.owner_id", sql`UPDATE growth_contacts SET owner_id = NULL`],
  ["update growth_contacts.owner_is_super_admin", sql`UPDATE growth_contacts SET owner_is_super_admin = false`],
  ["update growth_contacts.company_id", sql`UPDATE growth_contacts SET company_id = NULL`],
  ["update growth_contacts.created_at", sql`UPDATE growth_contacts SET created_at = now()`],
  ["delete growth_contacts", sql`DELETE FROM growth_contacts`],
  ["truncate growth_contacts", sql`TRUNCATE growth_contacts`],
  // Phase 4A.2: leads, stage history and activities.
  ["insert growth_leads.stage", sql`INSERT INTO growth_leads (name, source, owner_id, created_by, stage) VALUES ('X', 'other', gen_random_uuid(), gen_random_uuid(), 'new')`],
  ["insert growth_leads.stage_revision", sql`INSERT INTO growth_leads (name, source, owner_id, created_by, stage_revision) VALUES ('X', 'other', gen_random_uuid(), gen_random_uuid(), 0)`],
  ["update growth_leads.stage_revision", sql`UPDATE growth_leads SET stage_revision = 0`],
  ["update growth_leads.owner_is_super_admin", sql`UPDATE growth_leads SET owner_is_super_admin = false`],
  ["update growth_leads.currency", sql`UPDATE growth_leads SET currency = 'INR'`],
  ["update growth_leads.created_by", sql`UPDATE growth_leads SET created_by = NULL`],
  ["update growth_leads.created_at", sql`UPDATE growth_leads SET created_at = now()`],
  ["delete growth_leads", sql`DELETE FROM growth_leads`],
  ["truncate growth_leads", sql`TRUNCATE growth_leads`],
  ["insert growth_stage_changes.created_at", sql`INSERT INTO growth_stage_changes (lead_id, from_stage, to_stage, actor_id, stage_revision, created_at) VALUES (gen_random_uuid(), 'new', 'contacted', gen_random_uuid(), 1, now())`],
  ["update growth_stage_changes", sql`UPDATE growth_stage_changes SET note = 'x'`],
  ["delete growth_stage_changes", sql`DELETE FROM growth_stage_changes`],
  ["truncate growth_stage_changes", sql`TRUNCATE growth_stage_changes`],
  ["update growth_activities.summary", sql`UPDATE growth_activities SET summary = 'x'`],
  ["update growth_activities.contact_id", sql`UPDATE growth_activities SET contact_id = NULL`],
  ["delete growth_activities", sql`DELETE FROM growth_activities`],
  ["truncate growth_activities", sql`TRUNCATE growth_activities`],
  // Phase 4A.3: proposal cache and append-only workflow records.
  ["insert growth_proposals", sql`INSERT INTO growth_proposals (id, lead_id, created_by) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid())`],
  ["update growth_proposals", sql`UPDATE growth_proposals SET status = 'approved'`],
  ["delete growth_proposals", sql`DELETE FROM growth_proposals`],
  ["truncate growth_proposals", sql`TRUNCATE growth_proposals`],
  ["insert growth_proposal_versions.version_no", sql`INSERT INTO growth_proposal_versions (proposal_id, lead_id, version_no, document_url, amount_minor, valid_until, summary, created_by) VALUES (gen_random_uuid(), gen_random_uuid(), 1, 'https://example.test/p', 1, current_date, 'P', gen_random_uuid())`],
  ["update growth_proposal_versions", sql`UPDATE growth_proposal_versions SET summary = 'changed'`],
  ["delete growth_proposal_versions", sql`DELETE FROM growth_proposal_versions`],
  ["truncate growth_proposal_versions", sql`TRUNCATE growth_proposal_versions`],
  ["insert growth_proposal_events.seq", sql`INSERT INTO growth_proposal_events (proposal_id, version_id, seq, from_status, to_status, actor_id) VALUES (gen_random_uuid(), gen_random_uuid(), 1, 'draft', 'pending_approval', gen_random_uuid())`],
  ["update growth_proposal_events", sql`UPDATE growth_proposal_events SET note = 'changed'`],
  ["delete growth_proposal_events", sql`DELETE FROM growth_proposal_events`],
  ["truncate growth_proposal_events", sql`TRUNCATE growth_proposal_events`],
  ["insert growth_proposal_acceptances.late", sql`INSERT INTO growth_proposal_acceptances (proposal_id, version_id, lead_id, method, evidence_url, accepted_on, late, needs_confirmation, recorded_by) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'signed_document', 'https://example.test/e', current_date, false, false, gen_random_uuid())`],
  ["update growth_proposal_acceptances", sql`UPDATE growth_proposal_acceptances SET note = 'changed'`],
  ["delete growth_proposal_acceptances", sql`DELETE FROM growth_proposal_acceptances`],
  ["truncate growth_proposal_acceptances", sql`TRUNCATE growth_proposal_acceptances`],
  ["insert growth_proposal_confirmations.proposal_id", sql`INSERT INTO growth_proposal_confirmations (acceptance_id, proposal_id, version_id, decision, actor_id) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'confirmed', gen_random_uuid())`],
  ["update growth_proposal_confirmations", sql`UPDATE growth_proposal_confirmations SET note = 'changed'`],
  ["delete growth_proposal_confirmations", sql`DELETE FROM growth_proposal_confirmations`],
  ["truncate growth_proposal_confirmations", sql`TRUNCATE growth_proposal_confirmations`],
];

/** Each statement must be refused by grants (42501) when run as crm_worker. */
const REFUSED_FOR_WORKER: [string, SQL][] = [
  ["update meetings", sql`UPDATE meetings SET version = version + 1`],
  ["update meetings.responses_reset_at", sql`UPDATE meetings SET responses_reset_at = now()`],
  ["read meetings.title", sql`SELECT title FROM meetings`],
  ["update meeting_attendees", sql`UPDATE meeting_attendees SET response = 'pending'`],
  ["update notifications", sql`UPDATE notifications SET read_at = now()`],
  ["delete notifications", sql`DELETE FROM notifications`],
  ["read users.email", sql`SELECT email FROM users`],
  ["read growth_companies", sql`SELECT count(*) FROM growth_companies`],
  ["read growth_contacts", sql`SELECT count(*) FROM growth_contacts`],
  ["read growth_leads", sql`SELECT count(*) FROM growth_leads`],
  ["read growth_stage_changes", sql`SELECT count(*) FROM growth_stage_changes`],
  ["read growth_activities", sql`SELECT count(*) FROM growth_activities`],
  ["read growth_proposals", sql`SELECT count(*) FROM growth_proposals`],
  ["read growth_proposal_versions", sql`SELECT count(*) FROM growth_proposal_versions`],
  ["read growth_proposal_events", sql`SELECT count(*) FROM growth_proposal_events`],
  ["read growth_proposal_acceptances", sql`SELECT count(*) FROM growth_proposal_acceptances`],
  ["read growth_proposal_confirmations", sql`SELECT count(*) FROM growth_proposal_confirmations`],
];

describe("database: crm_app least privilege", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await createSuperAdmin(db.migrator);
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });

  it.each(REFUSED_FOR_APP)("refuses: %s", async (_label, statement) => {
    expect(await pgErrorCode(db.app.execute(statement))).toBe("42501");
  });

  it.each(REFUSED_FOR_WORKER)("refuses worker: %s", async (_label, statement) => {
    expect(await pgErrorCode(db.worker.execute(statement))).toBe("42501");
  });
});
