-- 0005_scheduler_execute_grants: only crm_worker may execute outbox_schedule_system_event.
-- PUBLIC's default EXECUTE was granted by the function owner (crm_outbox_owner), so only the owner can revoke it
-- and grant the replacement. crm_migrator can SET ROLE to crm_outbox_owner but does not inherit its rights.
SET ROLE crm_outbox_owner;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."outbox_schedule_system_event"(text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."outbox_schedule_system_event"(text, timestamptz) TO crm_worker;
--> statement-breakpoint
RESET ROLE;
