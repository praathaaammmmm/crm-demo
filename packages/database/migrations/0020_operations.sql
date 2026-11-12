-- 0020_operations: Engineering Operations records (Phase 4C, ADR 0012): incidents with an append-only timeline,
-- release records with a checklist and append-only decisions (including the rollback record), and an automation
-- registry with append-only lifecycle changes and runs. Records only: nothing here deploys or runs anything.
-- Runs as crm_migrator. Must stay consistent with packages/database/src/schema/operations.ts and
-- packages/contracts/src/operations.ts (INCIDENT_TRANSITIONS, releaseTransition, automationTransition).
CREATE TYPE "public"."ops_incident_severity" AS ENUM('sev1', 'sev2', 'sev3', 'sev4');
--> statement-breakpoint
CREATE TYPE "public"."ops_incident_status" AS ENUM('open', 'investigating', 'mitigated', 'resolved');
--> statement-breakpoint
CREATE TYPE "public"."ops_incident_entry_kind" AS ENUM('note', 'status');
--> statement-breakpoint
CREATE TYPE "public"."ops_release_environment" AS ENUM('staging', 'production');
--> statement-breakpoint
CREATE TYPE "public"."ops_release_status" AS ENUM('draft', 'awaiting_approval', 'approved', 'rejected', 'deployed', 'failed', 'rolled_back');
--> statement-breakpoint
CREATE TYPE "public"."ops_automation_status" AS ENUM('draft', 'testing', 'awaiting_approval', 'live', 'paused', 'retired');
--> statement-breakpoint
CREATE TYPE "public"."ops_run_outcome" AS ENUM('succeeded', 'failed');
--> statement-breakpoint
CREATE TABLE "ops_incidents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"severity" "ops_incident_severity" NOT NULL,
	"status" "ops_incident_status" DEFAULT 'open' NOT NULL,
	"owner_id" uuid NOT NULL REFERENCES "public"."users"("id"),
	"summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"post_incident_note" text,
	"created_by" uuid NOT NULL REFERENCES "public"."users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_incidents_title" CHECK (title = regexp_replace(btrim(title), '\s+', ' ', 'g') AND char_length(title) BETWEEN 1 AND 200),
	CONSTRAINT "ops_incidents_summary" CHECK (summary IS NULL OR (summary = btrim(summary) AND char_length(summary) BETWEEN 1 AND 2000)),
	CONSTRAINT "ops_incidents_resolution" CHECK (resolution IS NULL OR (resolution = btrim(resolution) AND char_length(resolution) BETWEEN 1 AND 2000)),
	CONSTRAINT "ops_incidents_post_note" CHECK (post_incident_note IS NULL OR (post_incident_note = btrim(post_incident_note) AND char_length(post_incident_note) BETWEEN 1 AND 5000)),
	CONSTRAINT "ops_incidents_resolved_fields" CHECK ((status = 'resolved') = (resolved_at IS NOT NULL) AND (status = 'resolved') = (resolution IS NOT NULL)),
	CONSTRAINT "ops_incidents_post_note_after_resolution" CHECK (post_incident_note IS NULL OR status = 'resolved'),
	CONSTRAINT "ops_incidents_resolved_after_start" CHECK (resolved_at IS NULL OR resolved_at >= started_at)
);
--> statement-breakpoint
CREATE INDEX "ops_incidents_status_idx" ON "ops_incidents" USING btree ("status", "severity");
--> statement-breakpoint
CREATE TABLE "ops_incident_updates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"incident_id" uuid NOT NULL REFERENCES "public"."ops_incidents"("id"),
	"kind" "ops_incident_entry_kind" NOT NULL,
	"from_status" "ops_incident_status",
	"to_status" "ops_incident_status",
	"note" text,
	"actor_id" uuid NOT NULL REFERENCES "public"."users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_incident_updates_shape" CHECK (
		(kind = 'status' AND from_status IS NOT NULL AND to_status IS NOT NULL AND from_status <> to_status)
		OR (kind = 'note' AND from_status IS NULL AND to_status IS NULL AND note IS NOT NULL)),
	CONSTRAINT "ops_incident_updates_note" CHECK (note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 1 AND 2000))
);
--> statement-breakpoint
CREATE INDEX "ops_incident_updates_incident_idx" ON "ops_incident_updates" USING btree ("incident_id", "created_at");
--> statement-breakpoint
CREATE TABLE "ops_releases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"version_label" text NOT NULL,
	"environment" "ops_release_environment" NOT NULL,
	"status" "ops_release_status" DEFAULT 'draft' NOT NULL,
	"planned_for" date,
	"notes" text,
	"created_by" uuid NOT NULL REFERENCES "public"."users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_releases_name" CHECK (name = regexp_replace(btrim(name), '\s+', ' ', 'g') AND char_length(name) BETWEEN 1 AND 200),
	CONSTRAINT "ops_releases_version_label" CHECK (version_label = regexp_replace(btrim(version_label), '\s+', ' ', 'g') AND char_length(version_label) BETWEEN 1 AND 64),
	CONSTRAINT "ops_releases_notes" CHECK (notes IS NULL OR (notes = btrim(notes) AND char_length(notes) BETWEEN 1 AND 2000))
);
--> statement-breakpoint
CREATE INDEX "ops_releases_status_idx" ON "ops_releases" USING btree ("status");
--> statement-breakpoint
CREATE TABLE "ops_release_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"release_id" uuid NOT NULL REFERENCES "public"."ops_releases"("id"),
	"label" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_by" uuid REFERENCES "public"."users"("id"),
	"done_at" timestamp with time zone,
	"created_by" uuid NOT NULL REFERENCES "public"."users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_release_checklist_items_label" CHECK (label = regexp_replace(btrim(label), '\s+', ' ', 'g') AND char_length(label) BETWEEN 1 AND 200),
	CONSTRAINT "ops_release_checklist_items_done" CHECK (done = (done_by IS NOT NULL) AND done = (done_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "ops_release_checklist_items_release_idx" ON "ops_release_checklist_items" USING btree ("release_id");
--> statement-breakpoint
CREATE TABLE "ops_release_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"release_id" uuid NOT NULL REFERENCES "public"."ops_releases"("id"),
	"from_status" "ops_release_status" NOT NULL,
	"to_status" "ops_release_status" NOT NULL,
	"note" text,
	"actor_id" uuid NOT NULL REFERENCES "public"."users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_release_decisions_different" CHECK (from_status <> to_status),
	CONSTRAINT "ops_release_decisions_note_required" CHECK (to_status NOT IN ('rejected', 'rolled_back') OR note IS NOT NULL),
	CONSTRAINT "ops_release_decisions_note" CHECK (note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 1 AND 2000))
);
--> statement-breakpoint
CREATE INDEX "ops_release_decisions_release_idx" ON "ops_release_decisions" USING btree ("release_id", "created_at");
--> statement-breakpoint
CREATE TABLE "ops_automations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"trigger_description" text NOT NULL,
	"status" "ops_automation_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL REFERENCES "public"."users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_automations_name" CHECK (name = regexp_replace(btrim(name), '\s+', ' ', 'g') AND char_length(name) BETWEEN 1 AND 200),
	CONSTRAINT "ops_automations_purpose" CHECK (purpose = btrim(purpose) AND char_length(purpose) BETWEEN 1 AND 1000),
	CONSTRAINT "ops_automations_trigger" CHECK (trigger_description = btrim(trigger_description) AND char_length(trigger_description) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX "ops_automations_status_idx" ON "ops_automations" USING btree ("status");
--> statement-breakpoint
CREATE TABLE "ops_automation_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"automation_id" uuid NOT NULL REFERENCES "public"."ops_automations"("id"),
	"from_status" "ops_automation_status" NOT NULL,
	"to_status" "ops_automation_status" NOT NULL,
	"note" text,
	"actor_id" uuid NOT NULL REFERENCES "public"."users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_automation_changes_different" CHECK (from_status <> to_status),
	CONSTRAINT "ops_automation_changes_reject_note" CHECK (NOT (from_status = 'awaiting_approval' AND to_status = 'testing') OR note IS NOT NULL),
	CONSTRAINT "ops_automation_changes_note" CHECK (note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 1 AND 1000))
);
--> statement-breakpoint
CREATE INDEX "ops_automation_changes_automation_idx" ON "ops_automation_changes" USING btree ("automation_id", "created_at");
--> statement-breakpoint
CREATE TABLE "ops_automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"automation_id" uuid NOT NULL REFERENCES "public"."ops_automations"("id"),
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"outcome" "ops_run_outcome" NOT NULL,
	"error_summary" text,
	"recorded_by" uuid NOT NULL REFERENCES "public"."users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_automation_runs_order" CHECK (finished_at >= started_at AND finished_at <= created_at + interval '5 minutes'),
	CONSTRAINT "ops_automation_runs_error" CHECK ((outcome = 'failed') = (error_summary IS NOT NULL)),
	-- Short, single-line summaries without links (the API also refuses secret-like text).
	CONSTRAINT "ops_automation_runs_error_text" CHECK (error_summary IS NULL OR (error_summary = btrim(error_summary)
		AND char_length(error_summary) BETWEEN 1 AND 300 AND position(E'\n' IN error_summary) = 0 AND position('://' IN error_summary) = 0))
);
--> statement-breakpoint
CREATE INDEX "ops_automation_runs_automation_idx" ON "ops_automation_runs" USING btree ("automation_id", "finished_at" DESC);
--> statement-breakpoint
-- Incidents: status pairs as in the contracts; a resolved incident may only gain its post-incident note, once.
CREATE FUNCTION "public"."ops_incidents_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.status = 'resolved' THEN
    IF OLD.post_incident_note IS NOT NULL OR ROW(NEW.title, NEW.severity, NEW.status, NEW.owner_id, NEW.summary, NEW.started_at, NEW.resolved_at, NEW.resolution)
       IS DISTINCT FROM ROW(OLD.title, OLD.severity, OLD.status, OLD.owner_id, OLD.summary, OLD.started_at, OLD.resolved_at, OLD.resolution) THEN
      RAISE EXCEPTION 'a resolved incident may only gain its post-incident note, once' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'open' AND NEW.status IN ('investigating', 'mitigated', 'resolved'))
    OR (OLD.status = 'investigating' AND NEW.status IN ('mitigated', 'resolved'))
    OR (OLD.status = 'mitigated' AND NEW.status IN ('investigating', 'resolved'))) THEN
    RAISE EXCEPTION 'incident status change not allowed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ops_incidents_guard_row"
BEFORE UPDATE ON "public"."ops_incidents"
FOR EACH ROW EXECUTE FUNCTION "public"."ops_incidents_guard"();
--> statement-breakpoint
-- Releases: status pairs by environment, as in the contracts; only drafts can be edited.
CREATE FUNCTION "public"."ops_releases_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pair text := OLD.status::text || '>' || NEW.status::text;
BEGIN
  IF NEW.environment IS DISTINCT FROM OLD.environment THEN
    RAISE EXCEPTION 'a release environment cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'draft' AND ROW(NEW.name, NEW.version_label, NEW.planned_for, NEW.notes)
     IS DISTINCT FROM ROW(OLD.name, OLD.version_label, OLD.planned_for, OLD.notes) THEN
    RAISE EXCEPTION 'only a draft release can be edited' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       pair IN ('deployed>rolled_back', 'failed>rolled_back')
    OR (OLD.environment = 'production' AND pair IN ('draft>awaiting_approval', 'awaiting_approval>approved', 'awaiting_approval>rejected',
                                                     'rejected>draft', 'approved>deployed', 'approved>failed'))
    OR (OLD.environment = 'staging' AND pair IN ('draft>deployed', 'draft>failed'))) THEN
    RAISE EXCEPTION 'release status change not allowed' USING ERRCODE = 'check_violation';
  END IF;
  -- Submitting a production release, or recording a staging outcome, needs a complete, non-empty checklist.
  IF pair IN ('draft>awaiting_approval', 'draft>deployed', 'draft>failed') AND (
       NOT EXISTS (SELECT 1 FROM public.ops_release_checklist_items i WHERE i.release_id = NEW.id)
    OR EXISTS (SELECT 1 FROM public.ops_release_checklist_items i WHERE i.release_id = NEW.id AND NOT i.done)) THEN
    RAISE EXCEPTION 'the release checklist must be complete' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ops_releases_guard_row"
BEFORE UPDATE ON "public"."ops_releases"
FOR EACH ROW EXECUTE FUNCTION "public"."ops_releases_guard"();
--> statement-breakpoint
-- Checklist items: added and ticked only while the release is a draft; only the done fields change.
CREATE FUNCTION "public"."ops_release_checklist_items_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ops_releases r WHERE r.id = NEW.release_id AND r.status = 'draft') THEN
    RAISE EXCEPTION 'the checklist can change only while the release is a draft' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW.release_id, NEW.label, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.release_id, OLD.label, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'only the done state of a checklist item can change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ops_release_checklist_items_guard_row"
BEFORE INSERT OR UPDATE ON "public"."ops_release_checklist_items"
FOR EACH ROW EXECUTE FUNCTION "public"."ops_release_checklist_items_guard"();
--> statement-breakpoint
-- Automations: lifecycle pairs as in the contracts; retired is final; only draft or testing can be edited.
CREATE FUNCTION "public"."ops_automations_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pair text := OLD.status::text || '>' || NEW.status::text;
BEGIN
  IF OLD.status = 'retired' THEN
    RAISE EXCEPTION 'a retired automation is read-only' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status NOT IN ('draft', 'testing') AND ROW(NEW.name, NEW.purpose, NEW.trigger_description)
     IS DISTINCT FROM ROW(OLD.name, OLD.purpose, OLD.trigger_description) THEN
    RAISE EXCEPTION 'only a draft or testing automation can be edited' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       NEW.status = 'retired'
    OR pair IN ('draft>testing', 'testing>draft', 'testing>awaiting_approval', 'awaiting_approval>live',
                'awaiting_approval>testing', 'live>paused', 'paused>live')) THEN
    RAISE EXCEPTION 'automation status change not allowed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ops_automations_guard_row"
BEFORE UPDATE ON "public"."ops_automations"
FOR EACH ROW EXECUTE FUNCTION "public"."ops_automations_guard"();
--> statement-breakpoint
-- Runs are recorded only while an automation is testing, live or paused.
CREATE FUNCTION "public"."ops_automation_runs_insert_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ops_automations a WHERE a.id = NEW.automation_id AND a.status IN ('testing', 'live', 'paused')) THEN
    RAISE EXCEPTION 'runs are recorded only for testing, live or paused automations' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ops_automation_runs_insert_guard_row"
BEFORE INSERT ON "public"."ops_automation_runs"
FOR EACH ROW EXECUTE FUNCTION "public"."ops_automation_runs_insert_guard"();
--> statement-breakpoint
-- Append-only histories for every role, including the owner (generic guard from migration 0014).
CREATE TRIGGER "ops_incident_updates_append_only_row" BEFORE UPDATE OR DELETE ON "public"."ops_incident_updates" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "ops_incident_updates_append_only_truncate" BEFORE TRUNCATE ON "public"."ops_incident_updates" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "ops_release_decisions_append_only_row" BEFORE UPDATE OR DELETE ON "public"."ops_release_decisions" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "ops_release_decisions_append_only_truncate" BEFORE TRUNCATE ON "public"."ops_release_decisions" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "ops_automation_changes_append_only_row" BEFORE UPDATE OR DELETE ON "public"."ops_automation_changes" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "ops_automation_changes_append_only_truncate" BEFORE TRUNCATE ON "public"."ops_automation_changes" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "ops_automation_runs_append_only_row" BEFORE UPDATE OR DELETE ON "public"."ops_automation_runs" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "ops_automation_runs_append_only_truncate" BEFORE TRUNCATE ON "public"."ops_automation_runs" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
-- No deletion of the mutable Operations records either.
CREATE TRIGGER "ops_incidents_no_delete" BEFORE DELETE ON "public"."ops_incidents" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "ops_incidents_no_truncate" BEFORE TRUNCATE ON "public"."ops_incidents" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "ops_releases_no_delete" BEFORE DELETE ON "public"."ops_releases" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "ops_releases_no_truncate" BEFORE TRUNCATE ON "public"."ops_releases" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "ops_release_checklist_items_no_delete" BEFORE DELETE ON "public"."ops_release_checklist_items" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "ops_release_checklist_items_no_truncate" BEFORE TRUNCATE ON "public"."ops_release_checklist_items" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "ops_automations_no_delete" BEFORE DELETE ON "public"."ops_automations" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "ops_automations_no_truncate" BEFORE TRUNCATE ON "public"."ops_automations" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
