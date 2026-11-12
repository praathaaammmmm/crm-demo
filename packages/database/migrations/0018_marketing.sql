-- 0018_marketing: Marketing campaigns, content calendar and link-only asset metadata (Phase 4B, ADR 0011).
-- Runs as crm_migrator. Must stay consistent with packages/database/src/schema/marketing.ts and
-- packages/contracts/src/marketing.ts (CONTENT_TRANSITIONS, CAMPAIGN_TRANSITIONS).
CREATE TYPE "public"."marketing_channel" AS ENUM('linkedin', 'instagram', 'youtube');
--> statement-breakpoint
CREATE TYPE "public"."marketing_content_status" AS ENUM('draft', 'planned', 'in_review', 'published', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."marketing_campaign_status" AS ENUM('draft', 'planned', 'active', 'paused', 'completed', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."marketing_asset_kind" AS ENUM('image', 'video', 'document', 'design', 'other');
--> statement-breakpoint
CREATE TABLE "marketing_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"objective" text,
	"status" "marketing_campaign_status" DEFAULT 'draft' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"created_by" uuid NOT NULL REFERENCES "public"."users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_campaigns_name" CHECK (name = regexp_replace(btrim(name), '\s+', ' ', 'g') AND char_length(name) BETWEEN 1 AND 200),
	CONSTRAINT "marketing_campaigns_objective" CHECK (objective IS NULL OR (objective = btrim(objective) AND char_length(objective) BETWEEN 1 AND 1000)),
	CONSTRAINT "marketing_campaigns_dates" CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on)
);
--> statement-breakpoint
CREATE INDEX "marketing_campaigns_status_idx" ON "marketing_campaigns" USING btree ("status");
--> statement-breakpoint
CREATE TABLE "marketing_content" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"campaign_id" uuid REFERENCES "public"."marketing_campaigns"("id"),
	"title" text NOT NULL,
	"channel" "marketing_channel" NOT NULL,
	"status" "marketing_content_status" DEFAULT 'draft' NOT NULL,
	"planned_for" date,
	"brief" text,
	"proof_url" text,
	"published_at" timestamp with time zone,
	"reach" integer,
	"engagements" integer,
	"clicks" integer,
	"created_by" uuid NOT NULL REFERENCES "public"."users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_content_title" CHECK (title = regexp_replace(btrim(title), '\s+', ' ', 'g') AND char_length(title) BETWEEN 1 AND 200),
	CONSTRAINT "marketing_content_brief" CHECK (brief IS NULL OR (brief = btrim(brief) AND char_length(brief) BETWEEN 1 AND 2000)),
	CONSTRAINT "marketing_content_proof_https" CHECK (proof_url IS NULL OR (proof_url ~ '^https://[^\s/?#]+[^\s]*$' AND char_length(proof_url) <= 2000)),
	-- Published content always has its proof link and time; nothing else has either.
	CONSTRAINT "marketing_content_published_fields" CHECK ((status = 'published') = (proof_url IS NOT NULL) AND (status = 'published') = (published_at IS NOT NULL)),
	-- Outcomes are recorded for published content only.
	CONSTRAINT "marketing_content_outcomes" CHECK (
		(status = 'published' OR (reach IS NULL AND engagements IS NULL AND clicks IS NULL))
		AND (reach IS NULL OR reach BETWEEN 0 AND 1000000000)
		AND (engagements IS NULL OR engagements BETWEEN 0 AND 1000000000)
		AND (clicks IS NULL OR clicks BETWEEN 0 AND 1000000000))
);
--> statement-breakpoint
CREATE INDEX "marketing_content_campaign_idx" ON "marketing_content" USING btree ("campaign_id");
--> statement-breakpoint
CREATE INDEX "marketing_content_planned_idx" ON "marketing_content" USING btree ("planned_for");
--> statement-breakpoint
CREATE INDEX "marketing_content_status_idx" ON "marketing_content" USING btree ("status");
--> statement-breakpoint
CREATE TABLE "marketing_asset_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content_id" uuid NOT NULL REFERENCES "public"."marketing_content"("id"),
	"label" text NOT NULL,
	"url" text NOT NULL,
	"kind" "marketing_asset_kind" NOT NULL,
	"created_by" uuid NOT NULL REFERENCES "public"."users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid REFERENCES "public"."users"("id"),
	CONSTRAINT "marketing_asset_links_label" CHECK (label = regexp_replace(btrim(label), '\s+', ' ', 'g') AND char_length(label) BETWEEN 1 AND 200),
	CONSTRAINT "marketing_asset_links_url_https" CHECK (url ~ '^https://[^\s/?#]+[^\s]*$' AND char_length(url) <= 2000),
	CONSTRAINT "marketing_asset_links_removed" CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);
--> statement-breakpoint
CREATE INDEX "marketing_asset_links_content_idx" ON "marketing_asset_links" USING btree ("content_id");
--> statement-breakpoint
-- Status pairs, as in the contracts. A finished campaign (completed or cancelled) cannot change at all.
CREATE FUNCTION "public"."marketing_campaigns_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'a finished campaign is read-only' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('planned', 'cancelled'))
    OR (OLD.status = 'planned' AND NEW.status IN ('draft', 'active', 'cancelled'))
    OR (OLD.status = 'active' AND NEW.status IN ('paused', 'completed', 'cancelled'))
    OR (OLD.status = 'paused' AND NEW.status IN ('active', 'completed', 'cancelled'))) THEN
    RAISE EXCEPTION 'campaign status change not allowed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "marketing_campaigns_guard_row"
BEFORE UPDATE ON "public"."marketing_campaigns"
FOR EACH ROW EXECUTE FUNCTION "public"."marketing_campaigns_guard"();
--> statement-breakpoint
-- Content status pairs. Cancelled content is read-only; published content may change only its outcome counts.
-- New or re-linked content must point at a campaign that has not finished.
CREATE FUNCTION "public"."marketing_content_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.campaign_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id) AND EXISTS (
       SELECT 1 FROM public.marketing_campaigns c WHERE c.id = NEW.campaign_id AND c.status IN ('completed', 'cancelled')) THEN
    RAISE EXCEPTION 'content cannot join a finished campaign' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'content starts as a draft' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'cancelled content is read-only' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'published' AND ROW(NEW.campaign_id, NEW.title, NEW.channel, NEW.status, NEW.planned_for, NEW.brief, NEW.proof_url, NEW.published_at, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.campaign_id, OLD.title, OLD.channel, OLD.status, OLD.planned_for, OLD.brief, OLD.proof_url, OLD.published_at, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'published content may only change its outcomes' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status IN ('planned', 'cancelled'))
    OR (OLD.status = 'planned' AND NEW.status IN ('draft', 'in_review', 'cancelled'))
    OR (OLD.status = 'in_review' AND NEW.status IN ('planned', 'published', 'cancelled'))) THEN
    RAISE EXCEPTION 'content status change not allowed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "marketing_content_guard_row"
BEFORE INSERT OR UPDATE ON "public"."marketing_content"
FOR EACH ROW EXECUTE FUNCTION "public"."marketing_content_guard"();
--> statement-breakpoint
-- Asset links are add-only: the only change is removing a link once (removed_at, removed_by).
CREATE FUNCTION "public"."marketing_asset_links_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.removed_at IS NOT NULL OR ROW(NEW.content_id, NEW.label, NEW.url, NEW.kind, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.content_id, OLD.label, OLD.url, OLD.kind, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'asset links can only be removed, once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "marketing_asset_links_guard_row"
BEFORE UPDATE ON "public"."marketing_asset_links"
FOR EACH ROW EXECUTE FUNCTION "public"."marketing_asset_links_guard"();
--> statement-breakpoint
-- No deletion of Marketing records for any role, including the owner (generic guard from migration 0014).
CREATE TRIGGER "marketing_campaigns_no_delete" BEFORE DELETE ON "public"."marketing_campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "marketing_campaigns_no_truncate" BEFORE TRUNCATE ON "public"."marketing_campaigns" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "marketing_content_no_delete" BEFORE DELETE ON "public"."marketing_content" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "marketing_content_no_truncate" BEFORE TRUNCATE ON "public"."marketing_content" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "marketing_asset_links_no_delete" BEFORE DELETE ON "public"."marketing_asset_links" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "marketing_asset_links_no_truncate" BEFORE TRUNCATE ON "public"."marketing_asset_links" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
