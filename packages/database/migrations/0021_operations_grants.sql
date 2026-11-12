-- 0021_operations_grants: least-privilege access to Engineering Operations tables. See docs/security/database-roles.md.
-- No DELETE or TRUNCATE for any application role; crm_worker gets nothing. History tables are INSERT-only.
REVOKE ALL ON "public"."ops_incidents", "public"."ops_incident_updates", "public"."ops_releases", "public"."ops_release_checklist_items",
  "public"."ops_release_decisions", "public"."ops_automations", "public"."ops_automation_changes", "public"."ops_automation_runs" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON "public"."ops_incidents", "public"."ops_incident_updates", "public"."ops_releases", "public"."ops_release_checklist_items",
  "public"."ops_release_decisions", "public"."ops_automations", "public"."ops_automation_changes", "public"."ops_automation_runs" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("title", "severity", "owner_id", "summary", "started_at", "created_by") ON "public"."ops_incidents" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("title", "severity", "status", "owner_id", "summary", "resolved_at", "resolution", "post_incident_note", "updated_at") ON "public"."ops_incidents" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("incident_id", "kind", "from_status", "to_status", "note", "actor_id") ON "public"."ops_incident_updates" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("name", "version_label", "environment", "planned_for", "notes", "created_by") ON "public"."ops_releases" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("name", "version_label", "status", "planned_for", "notes", "updated_at") ON "public"."ops_releases" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("release_id", "label", "created_by") ON "public"."ops_release_checklist_items" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("done", "done_by", "done_at") ON "public"."ops_release_checklist_items" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("release_id", "from_status", "to_status", "note", "actor_id") ON "public"."ops_release_decisions" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("name", "purpose", "trigger_description", "created_by") ON "public"."ops_automations" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("name", "purpose", "trigger_description", "status", "updated_at") ON "public"."ops_automations" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("automation_id", "from_status", "to_status", "note", "actor_id") ON "public"."ops_automation_changes" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("automation_id", "started_at", "finished_at", "outcome", "error_summary", "recorded_by") ON "public"."ops_automation_runs" TO crm_app;
