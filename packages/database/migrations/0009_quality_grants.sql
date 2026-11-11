-- 0009_quality_grants: least-privilege access to quality tables. See docs/security/database-roles.md.
-- No DELETE or TRUNCATE for any application role. qa_results, defect_updates and release_readiness are
-- append-only (SELECT and INSERT). crm_worker receives nothing.
REVOKE ALL ON "public"."qa_checks", "public"."qa_results", "public"."defects", "public"."defect_updates", "public"."release_readiness" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON "public"."qa_checks" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("task_id", "title", "created_by") ON "public"."qa_checks" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("latest_outcome", "latest_result_at") ON "public"."qa_checks" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."qa_results" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("qa_check_id", "outcome", "note", "evidence_url", "recorded_by") ON "public"."qa_results" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."defects" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("task_id", "qa_check_id", "title", "severity", "reproduction_steps", "reported_by") ON "public"."defects" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("title", "severity", "reproduction_steps", "status", "updated_at", "resolved_at") ON "public"."defects" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."defect_updates" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("defect_id", "author_id", "note", "evidence_url", "from_status", "to_status") ON "public"."defect_updates" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."release_readiness" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("project_id", "label", "readiness", "note", "decided_by") ON "public"."release_readiness" TO crm_app;
