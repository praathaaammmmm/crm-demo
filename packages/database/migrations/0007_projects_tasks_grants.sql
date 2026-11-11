-- 0007_projects_tasks_grants: least-privilege access to projects and tasks. See docs/security/database-roles.md.
-- No DELETE or TRUNCATE for any application role. Task history tables are append-only (SELECT and INSERT).
-- crm_worker receives nothing.
REVOKE ALL ON "public"."projects", "public"."tasks", "public"."task_updates", "public"."task_proofs", "public"."task_reviews" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON "public"."projects" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("name", "description", "created_by") ON "public"."projects" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."tasks" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("project_id", "title", "description", "priority", "due_date", "assignee_id", "created_by") ON "public"."tasks" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("title", "description", "priority", "due_date", "assignee_id", "status", "completed_at", "updated_at") ON "public"."tasks" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."task_updates" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("task_id", "author_id", "from_status", "to_status", "note") ON "public"."task_updates" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."task_proofs" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("task_id", "author_id", "url", "note") ON "public"."task_proofs" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."task_reviews" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("task_id", "reviewer_id", "decision", "note") ON "public"."task_reviews" TO crm_app;
