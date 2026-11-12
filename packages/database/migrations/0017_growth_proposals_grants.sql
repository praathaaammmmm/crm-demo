-- 0017_growth_proposals_grants: least-privilege grants for Phase 4A.3 proposal tables. Runs as crm_migrator.
-- crm_app never gets UPDATE on any proposal table, nor INSERT/UPDATE on the growth_proposals cache (written only by
-- nested triggers). Trigger-set columns (version_no, currency, seq, late, needs_confirmation, created_at,
-- recorded_at, confirmation proposal_id/version_id) are not granted. No DELETE or TRUNCATE anywhere.
-- crm_worker gets nothing.
REVOKE ALL ON "public"."growth_proposals", "public"."growth_proposal_versions", "public"."growth_proposal_events",
  "public"."growth_proposal_acceptances", "public"."growth_proposal_confirmations" FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON "public"."growth_proposals" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."growth_proposal_versions" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("proposal_id", "lead_id", "document_url", "amount_minor", "valid_until", "summary", "created_by") ON "public"."growth_proposal_versions" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."growth_proposal_events" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("proposal_id", "version_id", "from_status", "to_status", "actor_id", "note") ON "public"."growth_proposal_events" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."growth_proposal_acceptances" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("proposal_id", "version_id", "lead_id", "method", "evidence_url", "note", "accepted_on", "recorded_by") ON "public"."growth_proposal_acceptances" TO crm_app;
--> statement-breakpoint
GRANT SELECT ON "public"."growth_proposal_confirmations" TO crm_app;
--> statement-breakpoint
GRANT INSERT ("acceptance_id", "decision", "note", "actor_id") ON "public"."growth_proposal_confirmations" TO crm_app;
--> statement-breakpoint
-- Needed only by the mark-won update (stage and won_version_id together); every other change is refused by
-- growth_leads_won_before(). won_at, won_amount_minor and won_currency are set by that trigger and not granted.
GRANT UPDATE ("won_version_id") ON "public"."growth_leads" TO crm_app;
