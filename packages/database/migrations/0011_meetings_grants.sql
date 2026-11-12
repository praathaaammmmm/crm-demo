-- 0011_meetings_grants: least-privilege access to meetings, attendees, notifications and reminder events.
-- See docs/security/database-roles.md. No DELETE or TRUNCATE for any application role.
REVOKE ALL ON "public"."meetings", "public"."meeting_attendees", "public"."notifications" FROM PUBLIC;
--> statement-breakpoint
-- crm_app
GRANT SELECT ON "public"."meetings" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("title", "description", "starts_at", "ends_at", "location", "meeting_url", "project_id", "task_id", "organizer_id") ON "public"."meetings" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("title", "description", "starts_at", "ends_at", "location", "meeting_url", "project_id", "task_id", "status", "version", "cancelled_at", "updated_at", "responses_reset_at") ON "public"."meetings" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."meeting_attendees" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("meeting_id", "user_id") ON "public"."meeting_attendees" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("response", "responded_at", "removed_at", "added_at") ON "public"."meeting_attendees" TO crm_app;
--> statement-breakpoint
-- Notifications are created only by the worker; the API can read them and mark them read.
GRANT SELECT ON "public"."notifications" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("read_at") ON "public"."notifications" TO crm_app;
--> statement-breakpoint
-- Reminder events only (enforced by outbox_events_app_insert_guard). No SELECT or UPDATE on the outbox.
GRANT INSERT ("event_type", "payload", "dedupe_key", "available_at") ON "public"."outbox_events" TO crm_app;
--> statement-breakpoint
-- crm_worker: reads what the reminder handler checks and inserts notifications. No other writes.
GRANT SELECT ("id", "status", "version", "starts_at") ON "public"."meetings" TO crm_worker;
--> statement-breakpoint
GRANT SELECT ("meeting_id", "user_id", "response", "removed_at") ON "public"."meeting_attendees" TO crm_worker;
--> statement-breakpoint
GRANT SELECT ("id", "status") ON "public"."users" TO crm_worker;
--> statement-breakpoint
GRANT SELECT ("source_event_id", "recipient_id") ON "public"."notifications" TO crm_worker;
--> statement-breakpoint
GRANT INSERT ("recipient_id", "kind", "meeting_id", "meeting_version", "minutes_before", "source_event_id") ON "public"."notifications" TO crm_worker;
