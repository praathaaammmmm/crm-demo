-- 0015_growth_leads_grants: least-privilege access to leads, stage history and activities.
-- See docs/security/database-roles.md. No DELETE or TRUNCATE for any application role; crm_worker gets nothing.
-- crm_app never writes owner_is_super_admin, currency, stage_revision, created_by (after insert) or created_at;
-- growth_leads.stage is not insertable (leads always start in stage new).
REVOKE ALL ON "public"."growth_leads", "public"."growth_stage_changes", "public"."growth_activities" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON "public"."growth_leads" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("name", "company_id", "primary_contact_id", "source", "source_detail", "owner_id", "priority", "estimated_value_minor", "expected_close_on", "next_follow_up_on", "created_by") ON "public"."growth_leads" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("name", "company_id", "primary_contact_id", "source", "source_detail", "owner_id", "stage", "priority", "estimated_value_minor", "expected_close_on", "next_follow_up_on", "lost_reason", "lost_note", "lost_at", "version", "updated_at", "archived_at") ON "public"."growth_leads" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."growth_stage_changes" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("lead_id", "from_stage", "to_stage", "actor_id", "note", "lost_reason", "stage_revision") ON "public"."growth_stage_changes" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."growth_activities" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("lead_id", "company_id", "contact_id", "kind", "direction", "outcome", "occurred_at", "summary", "proof_url", "author_id") ON "public"."growth_activities" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("voided_at", "voided_by", "void_reason") ON "public"."growth_activities" TO crm_app;
