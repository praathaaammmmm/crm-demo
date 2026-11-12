-- 0013_growth_companies_grants: least-privilege access to Growth companies and contacts.
-- See docs/security/database-roles.md. No DELETE or TRUNCATE for any application role; crm_worker gets nothing.
-- crm_app cannot set owner_is_super_admin (default false) or change owner_id, company_id, created_by or created_at.
REVOKE ALL ON "public"."growth_companies", "public"."growth_contacts" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON "public"."growth_companies" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("name", "website_url", "industry", "notes", "owner_id", "created_by") ON "public"."growth_companies" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("name", "website_url", "industry", "notes", "archived_at", "updated_at") ON "public"."growth_companies" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."growth_contacts" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("company_id", "full_name", "role_title", "email", "phone", "linkedin_url", "website_url", "do_not_contact", "owner_id") ON "public"."growth_contacts" TO crm_app;
--> statement-breakpoint
GRANT UPDATE ("full_name", "role_title", "email", "phone", "linkedin_url", "website_url", "do_not_contact", "archived_at", "updated_at") ON "public"."growth_contacts" TO crm_app;
