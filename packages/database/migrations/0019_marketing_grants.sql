-- 0019_marketing_grants: least-privilege access to Marketing tables. See docs/security/database-roles.md.
-- No DELETE or TRUNCATE for any application role; crm_worker gets nothing. crm_app cannot set id, created_by
-- after insert, created_at, or the content of an asset link after insert.
REVOKE ALL ON "public"."marketing_campaigns", "public"."marketing_content", "public"."marketing_asset_links" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON "public"."marketing_campaigns" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("name", "objective", "starts_on", "ends_on", "created_by") ON "public"."marketing_campaigns" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("name", "objective", "status", "starts_on", "ends_on", "updated_at") ON "public"."marketing_campaigns" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."marketing_content" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("campaign_id", "title", "channel", "planned_for", "brief", "created_by") ON "public"."marketing_content" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("campaign_id", "title", "planned_for", "brief", "status", "proof_url", "published_at", "reach", "engagements", "clicks", "updated_at") ON "public"."marketing_content" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."marketing_asset_links" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("content_id", "label", "url", "kind", "created_by") ON "public"."marketing_asset_links" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("removed_at", "removed_by") ON "public"."marketing_asset_links" TO crm_app;
