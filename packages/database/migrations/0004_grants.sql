-- 0004_grants: least-privilege access. See docs/security/database-roles.md.
-- No application role receives DELETE or TRUNCATE on any table.

-- Nothing is available to PUBLIC.
REVOKE ALL ON SCHEMA "public" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM PUBLIC;
--> statement-breakpoint
-- Functions created by future migrations are not executable by PUBLIC either.
ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "public" TO crm_app, crm_worker, crm_outbox_owner;
--> statement-breakpoint

-- crm_app (HTTP API)
GRANT SELECT ON "public"."users" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("email", "name", "role", "password_hash", "must_change_password", "created_by") ON "public"."users" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("name", "role", "password_hash", "must_change_password", "status", "deactivated_at", "failed_login_count", "locked_until", "updated_at") ON "public"."users" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."sessions" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("user_id", "token_hash") ON "public"."sessions" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("ended_at", "end_reason") ON "public"."sessions" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."attendance_events" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("user_id", "session_id", "kind", "occurred_at") ON "public"."attendance_events" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."approval_requests" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("type", "target_user_id", "payload", "reason", "requested_by") ON "public"."approval_requests" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("status", "decided_by", "decided_at", "decision_note") ON "public"."approval_requests" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."audit_events" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("actor_type", "actor_user_id", "action", "entity_type", "entity_id", "before", "after", "request_id") ON "public"."audit_events" TO crm_app;
--> statement-breakpoint
-- crm_app has no access to outbox_events in Phase 1 (INSERT only, from Phase 2).

-- crm_worker
GRANT SELECT ON "public"."outbox_events" TO crm_worker;
--> statement-breakpoint
GRANT UPDATE ("status", "attempts", "available_at", "locked_by", "locked_until", "last_error", "processed_at") ON "public"."outbox_events" TO crm_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."outbox_schedule_system_event"(text, timestamptz) TO crm_worker;
--> statement-breakpoint
GRANT SELECT ("id", "user_id", "expires_at", "ended_at") ON "public"."sessions" TO crm_worker;
--> statement-breakpoint
GRANT UPDATE ("ended_at", "end_reason") ON "public"."sessions" TO crm_worker;
--> statement-breakpoint
GRANT INSERT ("user_id", "session_id", "kind", "occurred_at") ON "public"."attendance_events" TO crm_worker;
--> statement-breakpoint

-- crm_outbox_owner (NOLOGIN owner of outbox_schedule_system_event)
GRANT INSERT ON "public"."outbox_events" TO crm_outbox_owner;
