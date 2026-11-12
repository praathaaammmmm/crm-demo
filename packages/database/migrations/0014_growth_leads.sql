-- 0014_growth_leads: leads, stage history (append-only, one row per stage revision) and outreach activities
-- (append-only, voidable once) for Phase 4A.2. Runs as crm_migrator.
-- Must stay consistent with packages/database/src/schema/growth-leads.ts. Enum type names never equal a table name.
CREATE TYPE "public"."growth_stage" AS ENUM('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost');
--> statement-breakpoint
CREATE TYPE "public"."growth_lead_source" AS ENUM('linkedin', 'referral', 'inbound_email', 'website', 'event', 'cold_outreach', 'partner', 'other');
--> statement-breakpoint
CREATE TYPE "public"."growth_priority" AS ENUM('low', 'medium', 'high');
--> statement-breakpoint
CREATE TYPE "public"."growth_lost_reason" AS ENUM('no_budget', 'chose_competitor', 'no_response', 'not_a_fit', 'timing', 'price', 'other');
--> statement-breakpoint
CREATE TYPE "public"."growth_activity_kind" AS ENUM('linkedin_dm', 'email', 'call', 'meeting', 'follow_up', 'other');
--> statement-breakpoint
CREATE TYPE "public"."growth_activity_direction" AS ENUM('outbound', 'inbound');
--> statement-breakpoint
CREATE TYPE "public"."growth_activity_outcome" AS ENUM('no_response', 'replied', 'positive', 'negative', 'meeting_booked');
--> statement-breakpoint
CREATE TABLE "growth_leads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"company_id" uuid,
	"primary_contact_id" uuid,
	"source" "growth_lead_source" NOT NULL,
	"source_detail" text,
	"owner_id" uuid NOT NULL,
	"owner_is_super_admin" boolean DEFAULT false NOT NULL,
	"stage" "growth_stage" DEFAULT 'new' NOT NULL,
	"stage_revision" integer DEFAULT 0 NOT NULL,
	"priority" "growth_priority" DEFAULT 'medium' NOT NULL,
	"estimated_value_minor" bigint,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"expected_close_on" date,
	"next_follow_up_on" date,
	"lost_reason" "growth_lost_reason",
	"lost_note" text,
	"lost_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "growth_leads_name_normalized" CHECK (name = regexp_replace(btrim(name), '\s+', ' ', 'g') AND char_length(name) BETWEEN 1 AND 200),
	CONSTRAINT "growth_leads_source_detail" CHECK (source_detail IS NULL OR (source_detail = btrim(source_detail) AND char_length(source_detail) BETWEEN 1 AND 200)),
	CONSTRAINT "growth_leads_owner_not_super_admin" CHECK (owner_is_super_admin = false),
	CONSTRAINT "growth_leads_value" CHECK (estimated_value_minor IS NULL OR estimated_value_minor BETWEEN 0 AND 100000000000),
	CONSTRAINT "growth_leads_currency_inr" CHECK (currency = 'INR'),
	CONSTRAINT "growth_leads_lost_fields" CHECK ((stage = 'lost') = (lost_reason IS NOT NULL) AND (stage = 'lost') = (lost_note IS NOT NULL) AND (stage = 'lost') = (lost_at IS NOT NULL)),
	CONSTRAINT "growth_leads_lost_note" CHECK (lost_note IS NULL OR (lost_note = btrim(lost_note) AND char_length(lost_note) BETWEEN 1 AND 1000)),
	-- Removed by slice 4A.3, together with the won columns and their trigger.
	CONSTRAINT "growth_leads_won_not_yet" CHECK (stage <> 'won'),
	CONSTRAINT "growth_leads_contact_needs_company" CHECK (primary_contact_id IS NULL OR company_id IS NOT NULL),
	CONSTRAINT "growth_leads_version_positive" CHECK (version >= 1),
	CONSTRAINT "growth_leads_stage_revision_nonnegative" CHECK (stage_revision >= 0)
);
--> statement-breakpoint
ALTER TABLE "growth_leads" ADD CONSTRAINT "growth_leads_company_id_growth_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."growth_companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- The primary contact belongs to the lead's company (not checked when either is NULL: MATCH SIMPLE).
ALTER TABLE "growth_leads" ADD CONSTRAINT "growth_leads_contact_company_fk" FOREIGN KEY ("primary_contact_id","company_id") REFERENCES "public"."growth_contacts"("id","company_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_leads" ADD CONSTRAINT "growth_leads_owner_fk" FOREIGN KEY ("owner_id","owner_is_super_admin") REFERENCES "public"."users"("id","is_super_admin") MATCH FULL ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_leads" ADD CONSTRAINT "growth_leads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "growth_leads_owner_stage_idx" ON "growth_leads" USING btree ("owner_id","stage");
--> statement-breakpoint
CREATE INDEX "growth_leads_follow_up_idx" ON "growth_leads" USING btree ("stage","next_follow_up_on") WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE INDEX "growth_leads_company_idx" ON "growth_leads" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "growth_leads_source_idx" ON "growth_leads" USING btree ("source");
--> statement-breakpoint
CREATE INDEX "growth_leads_archived_idx" ON "growth_leads" USING btree ("archived_at");
--> statement-breakpoint
CREATE TABLE "growth_stage_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_stage" "growth_stage" NOT NULL,
	"to_stage" "growth_stage" NOT NULL,
	"stage_revision" integer NOT NULL,
	"actor_id" uuid NOT NULL,
	"note" text,
	"lost_reason" "growth_lost_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_stage_changes_lead_revision_unique" UNIQUE("lead_id","stage_revision"),
	CONSTRAINT "growth_stage_changes_different" CHECK (from_stage <> to_stage),
	CONSTRAINT "growth_stage_changes_revision_positive" CHECK (stage_revision >= 1),
	CONSTRAINT "growth_stage_changes_lost_needs_reason" CHECK (to_stage <> 'lost' OR (lost_reason IS NOT NULL AND note IS NOT NULL)),
	CONSTRAINT "growth_stage_changes_reopen_needs_note" CHECK (from_stage <> 'lost' OR note IS NOT NULL),
	CONSTRAINT "growth_stage_changes_note" CHECK (note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 1 AND 1000))
);
--> statement-breakpoint
ALTER TABLE "growth_stage_changes" ADD CONSTRAINT "growth_stage_changes_lead_id_growth_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."growth_leads"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_stage_changes" ADD CONSTRAINT "growth_stage_changes_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "growth_stage_changes_lead_idx" ON "growth_stage_changes" USING btree ("lead_id","created_at");
--> statement-breakpoint
CREATE TABLE "growth_activities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lead_id" uuid,
	"company_id" uuid,
	"contact_id" uuid,
	"kind" "growth_activity_kind" NOT NULL,
	"direction" "growth_activity_direction" NOT NULL,
	"outcome" "growth_activity_outcome",
	"occurred_at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"proof_url" text,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	CONSTRAINT "growth_activities_has_link" CHECK (num_nonnulls(lead_id, company_id, contact_id) >= 1),
	-- Every outbound activity, of any kind, names a contact.
	CONSTRAINT "growth_activities_outbound_contact" CHECK (direction = 'inbound' OR contact_id IS NOT NULL),
	CONSTRAINT "growth_activities_occurred_window" CHECK (occurred_at <= created_at + interval '5 minutes' AND occurred_at >= created_at - interval '365 days'),
	CONSTRAINT "growth_activities_summary" CHECK (summary = btrim(summary) AND char_length(summary) BETWEEN 1 AND 2000),
	CONSTRAINT "growth_activities_proof_https" CHECK (proof_url IS NULL OR (proof_url ~ '^https://[^\s/?#]+[^\s]*$' AND char_length(proof_url) <= 2000)),
	CONSTRAINT "growth_activities_void_fields" CHECK ((voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL)),
	CONSTRAINT "growth_activities_void_reason" CHECK (void_reason IS NULL OR (void_reason = btrim(void_reason) AND char_length(void_reason) BETWEEN 1 AND 500))
);
--> statement-breakpoint
ALTER TABLE "growth_activities" ADD CONSTRAINT "growth_activities_lead_id_growth_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."growth_leads"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_activities" ADD CONSTRAINT "growth_activities_company_id_growth_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."growth_companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_activities" ADD CONSTRAINT "growth_activities_contact_id_growth_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."growth_contacts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_activities" ADD CONSTRAINT "growth_activities_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_activities" ADD CONSTRAINT "growth_activities_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "growth_activities_lead_idx" ON "growth_activities" USING btree ("lead_id","occurred_at" DESC);
--> statement-breakpoint
CREATE INDEX "growth_activities_company_idx" ON "growth_activities" USING btree ("company_id","occurred_at" DESC);
--> statement-breakpoint
CREATE INDEX "growth_activities_contact_idx" ON "growth_activities" USING btree ("contact_id","occurred_at" DESC);
--> statement-breakpoint
CREATE INDEX "growth_activities_author_idx" ON "growth_activities" USING btree ("author_id","occurred_at");
--> statement-breakpoint
-- Lead owners must be active CGOs when assigned (function from migration 0012).
CREATE TRIGGER "growth_leads_owner_guard_row"
BEFORE INSERT OR UPDATE OF "owner_id" ON "public"."growth_leads"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_owner_guard"();
--> statement-breakpoint
-- Leads start in stage new at revision 0; every stage change bumps stage_revision by exactly one, whatever is
-- supplied; stage_revision never changes without a stage change. Applies to every role.
CREATE FUNCTION "public"."growth_leads_stage_revision"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage <> 'new' THEN
      RAISE EXCEPTION 'a lead must start in stage new' USING ERRCODE = 'check_violation';
    END IF;
    NEW.stage_revision := 0;
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_revision := OLD.stage_revision + 1;
  ELSIF NEW.stage_revision IS DISTINCT FROM OLD.stage_revision THEN
    RAISE EXCEPTION 'stage_revision changes only with stage' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_leads_stage_revision_row"
BEFORE INSERT OR UPDATE ON "public"."growth_leads"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_leads_stage_revision"();
--> statement-breakpoint
-- New or changed links must point to a company and contact that are not archived (existing links are kept).
CREATE FUNCTION "public"."growth_leads_link_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  archived timestamptz;
BEGIN
  IF NEW.company_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.company_id IS DISTINCT FROM OLD.company_id) THEN
    SELECT c.archived_at INTO archived FROM public.growth_companies c WHERE c.id = NEW.company_id FOR SHARE;
    IF archived IS NOT NULL THEN
      RAISE EXCEPTION 'a lead cannot be linked to an archived company' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.primary_contact_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.primary_contact_id IS DISTINCT FROM OLD.primary_contact_id) THEN
    SELECT c.archived_at INTO archived FROM public.growth_contacts c WHERE c.id = NEW.primary_contact_id FOR SHARE;
    IF archived IS NOT NULL THEN
      RAISE EXCEPTION 'a lead cannot be linked to an archived contact' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_leads_link_guard_row"
BEFORE INSERT OR UPDATE OF "company_id", "primary_contact_id" ON "public"."growth_leads"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_leads_link_guard"();
--> statement-breakpoint
-- Archived leads are read-only. A lost lead that stays lost may change only owner, archive state, version and
-- updated_at; reopening (lost to an open stage) clears the lost fields (enforced by growth_leads_lost_fields).
CREATE FUNCTION "public"."growth_leads_state_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'an archived lead is read-only' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.stage = 'lost' AND NEW.stage = 'lost' AND
     ROW(NEW.name, NEW.company_id, NEW.primary_contact_id, NEW.source, NEW.source_detail, NEW.priority,
         NEW.estimated_value_minor, NEW.expected_close_on, NEW.next_follow_up_on, NEW.lost_reason, NEW.lost_note, NEW.lost_at)
     IS DISTINCT FROM
     ROW(OLD.name, OLD.company_id, OLD.primary_contact_id, OLD.source, OLD.source_detail, OLD.priority,
         OLD.estimated_value_minor, OLD.expected_close_on, OLD.next_follow_up_on, OLD.lost_reason, OLD.lost_note, OLD.lost_at) THEN
    RAISE EXCEPTION 'a lost lead can only be reopened, reassigned or archived' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_leads_state_guard_row"
BEFORE UPDATE ON "public"."growth_leads"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_leads_state_guard"();
--> statement-breakpoint
-- Generic append-only guard: refuses UPDATE, DELETE and TRUNCATE for every role, including the owner.
CREATE FUNCTION "public"."growth_append_only_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% refused)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_stage_changes_append_only_row"
BEFORE UPDATE OR DELETE ON "public"."growth_stage_changes"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "growth_stage_changes_append_only_truncate"
BEFORE TRUNCATE ON "public"."growth_stage_changes"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
-- A history row is accepted only for the lead's current stage revision and stage, i.e. right after the stage
-- update it records. It cannot be written ahead, forged for another revision, or reused.
CREATE FUNCTION "public"."growth_stage_changes_insert_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  cur_stage public.growth_stage;
  cur_rev integer;
BEGIN
  SELECT l.stage, l.stage_revision INTO cur_stage, cur_rev FROM public.growth_leads l WHERE l.id = NEW.lead_id FOR SHARE;
  IF NOT FOUND OR NEW.stage_revision <> cur_rev OR NEW.to_stage <> cur_stage THEN
    RAISE EXCEPTION 'history row does not match the lead''s current stage revision' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_stage_changes_insert_guard_row"
BEFORE INSERT ON "public"."growth_stage_changes"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_stage_changes_insert_guard"();
--> statement-breakpoint
-- At commit, every stage transition must have its own history row matching lead, revision, previous and new stage.
CREATE FUNCTION "public"."growth_leads_stage_history_check"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.growth_stage_changes s
    WHERE s.lead_id = NEW.id AND s.stage_revision = NEW.stage_revision
      AND s.from_stage = OLD.stage AND s.to_stage = NEW.stage
  ) THEN
    RAISE EXCEPTION 'lead % stage revision % has no matching history row', NEW.id, NEW.stage_revision
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "growth_leads_stage_history_required"
AFTER UPDATE OF "stage" ON "public"."growth_leads"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (OLD.stage IS DISTINCT FROM NEW.stage)
EXECUTE FUNCTION "public"."growth_leads_stage_history_check"();
--> statement-breakpoint
-- Canonical activity links: the lead's company, company_id and the contact's company must agree; company_id is
-- derived when exactly one company is implied; a lead with no company allows only inbound, contact-less activity.
-- Linked rows must exist and not be archived, and outbound to a do-not-contact contact is refused.
CREATE FUNCTION "public"."growth_activities_link_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  lead_company uuid;
  lead_archived timestamptz;
  contact_company uuid;
  contact_archived timestamptz;
  contact_dnc boolean;
  company_archived timestamptz;
  candidates uuid[];
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    SELECT l.company_id, l.archived_at INTO lead_company, lead_archived FROM public.growth_leads l WHERE l.id = NEW.lead_id FOR SHARE;
    IF NOT FOUND OR lead_archived IS NOT NULL THEN
      RAISE EXCEPTION 'activity lead is missing or archived' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.contact_id IS NOT NULL THEN
    SELECT c.company_id, c.archived_at, c.do_not_contact INTO contact_company, contact_archived, contact_dnc
      FROM public.growth_contacts c WHERE c.id = NEW.contact_id FOR SHARE;
    IF NOT FOUND OR contact_archived IS NOT NULL THEN
      RAISE EXCEPTION 'activity contact is missing or archived' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.direction = 'outbound' AND contact_dnc THEN
      RAISE EXCEPTION 'outbound activity to a do-not-contact contact is refused' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.lead_id IS NOT NULL AND lead_company IS NULL THEN
    IF NEW.direction <> 'inbound' OR NEW.contact_id IS NOT NULL OR NEW.company_id IS NOT NULL THEN
      RAISE EXCEPTION 'a lead with no company allows only inbound activity without a contact' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT array_agg(DISTINCT x) INTO candidates FROM unnest(ARRAY[lead_company, NEW.company_id, contact_company]) AS x WHERE x IS NOT NULL;
  IF coalesce(array_length(candidates, 1), 0) > 1 THEN
    RAISE EXCEPTION 'linked lead, company and contact belong to different companies' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.company_id IS NULL AND coalesce(array_length(candidates, 1), 0) = 1 THEN
    NEW.company_id := candidates[1];
  END IF;
  IF NEW.company_id IS NOT NULL THEN
    SELECT c.archived_at INTO company_archived FROM public.growth_companies c WHERE c.id = NEW.company_id FOR SHARE;
    IF NOT FOUND OR company_archived IS NOT NULL THEN
      RAISE EXCEPTION 'activity company is missing or archived' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_activities_link_guard_row"
BEFORE INSERT ON "public"."growth_activities"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_activities_link_guard"();
--> statement-breakpoint
-- Activities are append-only: the only allowed update sets the three void fields once.
CREATE FUNCTION "public"."growth_activities_void_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL OR
     ROW(NEW.id, NEW.lead_id, NEW.company_id, NEW.contact_id, NEW.kind, NEW.direction, NEW.outcome, NEW.occurred_at,
         NEW.summary, NEW.proof_url, NEW.author_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.lead_id, OLD.company_id, OLD.contact_id, OLD.kind, OLD.direction, OLD.outcome, OLD.occurred_at,
         OLD.summary, OLD.proof_url, OLD.author_id, OLD.created_at) THEN
    RAISE EXCEPTION 'activities are append-only; only a single void is allowed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_activities_void_guard_row"
BEFORE UPDATE ON "public"."growth_activities"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_activities_void_guard"();
--> statement-breakpoint
CREATE TRIGGER "growth_activities_append_only_delete"
BEFORE DELETE ON "public"."growth_activities"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "growth_activities_append_only_truncate"
BEFORE TRUNCATE ON "public"."growth_activities"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
