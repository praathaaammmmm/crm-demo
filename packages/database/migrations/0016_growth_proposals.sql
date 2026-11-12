-- 0016_growth_proposals: proposals (one per lead, status cache), immutable versions, append-only status events,
-- acceptances and CEO confirmations, and the won-lead transition for Phase 4A.3. Runs as crm_migrator.
-- Must stay consistent with packages/database/src/schema/growth-proposals.ts and growth-leads.ts.
--
-- Status is event-driven: growth_proposals is a cache written only by nested trigger invocations
-- (pg_trigger_depth() > 1), never by direct DML from any role. Internal transitions (creation, supersede,
-- acceptance, confirmation, won) can only be inserted from inside another trigger; user transitions (submit,
-- approve, reject, send, withdraw) only directly. A deferred check keeps the cache equal to the latest event.
CREATE TYPE "public"."growth_proposal_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'sent', 'acceptance_pending', 'accepted', 'acceptance_refused', 'withdrawn', 'superseded', 'won');
--> statement-breakpoint
CREATE TYPE "public"."growth_acceptance_method" AS ENUM('signed_document', 'email_confirmation', 'written_message', 'verbal');
--> statement-breakpoint
CREATE TYPE "public"."growth_confirmation_decision" AS ENUM('confirmed', 'refused');
--> statement-breakpoint
CREATE TABLE "growth_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"current_version_id" uuid,
	"current_version_no" integer,
	"status" "growth_proposal_status",
	"event_seq" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_proposals_lead_unique" UNIQUE("lead_id"),
	CONSTRAINT "growth_proposals_id_lead_unique" UNIQUE("id","lead_id"),
	CONSTRAINT "growth_proposals_seq_status" CHECK ((event_seq = 0) = (status IS NULL)),
	CONSTRAINT "growth_proposals_current_set" CHECK ((status IS NULL) = (current_version_id IS NULL) AND (status IS NULL) = (current_version_no IS NULL))
);
--> statement-breakpoint
ALTER TABLE "growth_proposals" ADD CONSTRAINT "growth_proposals_lead_id_growth_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."growth_leads"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_proposals" ADD CONSTRAINT "growth_proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "growth_proposals_queue_idx" ON "growth_proposals" USING btree ("status") WHERE status IN ('pending_approval', 'acceptance_pending');
--> statement-breakpoint
CREATE TABLE "growth_proposal_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"document_url" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"valid_until" date NOT NULL,
	"summary" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_proposal_versions_number_unique" UNIQUE("proposal_id","version_no"),
	CONSTRAINT "growth_proposal_versions_id_proposal_unique" UNIQUE("id","proposal_id"),
	CONSTRAINT "growth_proposal_versions_id_lead_unique" UNIQUE("id","lead_id"),
	CONSTRAINT "growth_proposal_versions_number_positive" CHECK (version_no >= 1),
	CONSTRAINT "growth_proposal_versions_document_https" CHECK (document_url ~ '^https://[^\s/?#]+[^\s]*$' AND char_length(document_url) <= 2000),
	CONSTRAINT "growth_proposal_versions_amount" CHECK (amount_minor BETWEEN 0 AND 100000000000),
	CONSTRAINT "growth_proposal_versions_currency_inr" CHECK (currency = 'INR'),
	CONSTRAINT "growth_proposal_versions_summary" CHECK (summary = btrim(summary) AND char_length(summary) BETWEEN 1 AND 2000),
	CONSTRAINT "growth_proposal_versions_valid_until" CHECK (valid_until >= ((created_at AT TIME ZONE 'UTC')::date - 1))
);
--> statement-breakpoint
-- The version's lead must be its proposal's lead.
ALTER TABLE "growth_proposal_versions" ADD CONSTRAINT "growth_proposal_versions_proposal_fk" FOREIGN KEY ("proposal_id","lead_id") REFERENCES "public"."growth_proposals"("id","lead_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_proposal_versions" ADD CONSTRAINT "growth_proposal_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "growth_proposal_versions_lead_idx" ON "growth_proposal_versions" USING btree ("lead_id");
--> statement-breakpoint
-- The cache's current version belongs to the same proposal (checked at commit: the cache is updated in the same
-- statement chain that inserts the version).
ALTER TABLE "growth_proposals" ADD CONSTRAINT "growth_proposals_current_version_fk" FOREIGN KEY ("current_version_id","id") REFERENCES "public"."growth_proposal_versions"("id","proposal_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TABLE "growth_proposal_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"from_status" "growth_proposal_status",
	"to_status" "growth_proposal_status" NOT NULL,
	"actor_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_proposal_events_seq_unique" UNIQUE("proposal_id","seq"),
	CONSTRAINT "growth_proposal_events_creation" CHECK ((from_status IS NULL) = (to_status = 'draft')),
	CONSTRAINT "growth_proposal_events_note_required" CHECK (to_status NOT IN ('rejected', 'withdrawn', 'acceptance_refused') OR note IS NOT NULL),
	CONSTRAINT "growth_proposal_events_note" CHECK (note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 1 AND 1000))
);
--> statement-breakpoint
ALTER TABLE "growth_proposal_events" ADD CONSTRAINT "growth_proposal_events_version_fk" FOREIGN KEY ("version_id","proposal_id") REFERENCES "public"."growth_proposal_versions"("id","proposal_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_proposal_events" ADD CONSTRAINT "growth_proposal_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "growth_proposal_events_one_creation" ON "growth_proposal_events" USING btree ("version_id") WHERE from_status IS NULL;
--> statement-breakpoint
CREATE INDEX "growth_proposal_events_version_idx" ON "growth_proposal_events" USING btree ("version_id");
--> statement-breakpoint
CREATE TABLE "growth_proposal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"method" "growth_acceptance_method" NOT NULL,
	"evidence_url" text,
	"note" text,
	"accepted_on" date NOT NULL,
	"late" boolean NOT NULL,
	"needs_confirmation" boolean NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_proposal_acceptances_version_unique" UNIQUE("version_id"),
	CONSTRAINT "growth_proposal_acceptances_id_version_unique" UNIQUE("id","version_id"),
	CONSTRAINT "growth_proposal_acceptances_evidence" CHECK (method = 'verbal' OR evidence_url IS NOT NULL),
	CONSTRAINT "growth_proposal_acceptances_evidence_https" CHECK (evidence_url IS NULL OR (evidence_url ~ '^https://[^\s/?#]+[^\s]*$' AND char_length(evidence_url) <= 2000)),
	CONSTRAINT "growth_proposal_acceptances_verbal_note" CHECK (method <> 'verbal' OR note IS NOT NULL),
	CONSTRAINT "growth_proposal_acceptances_note" CHECK (note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 1 AND 1000)),
	CONSTRAINT "growth_proposal_acceptances_needs_confirmation" CHECK (needs_confirmation = (method = 'verbal' OR late))
);
--> statement-breakpoint
ALTER TABLE "growth_proposal_acceptances" ADD CONSTRAINT "growth_proposal_acceptances_version_fk" FOREIGN KEY ("version_id","proposal_id") REFERENCES "public"."growth_proposal_versions"("id","proposal_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_proposal_acceptances" ADD CONSTRAINT "growth_proposal_acceptances_lead_fk" FOREIGN KEY ("version_id","lead_id") REFERENCES "public"."growth_proposal_versions"("id","lead_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_proposal_acceptances" ADD CONSTRAINT "growth_proposal_acceptances_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "growth_proposal_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"acceptance_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"decision" "growth_confirmation_decision" NOT NULL,
	"note" text,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_proposal_confirmations_acceptance_unique" UNIQUE("acceptance_id"),
	CONSTRAINT "growth_proposal_confirmations_refusal_note" CHECK (decision = 'confirmed' OR note IS NOT NULL),
	CONSTRAINT "growth_proposal_confirmations_note" CHECK (note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 1 AND 1000))
);
--> statement-breakpoint
ALTER TABLE "growth_proposal_confirmations" ADD CONSTRAINT "growth_proposal_confirmations_acceptance_fk" FOREIGN KEY ("acceptance_id","version_id") REFERENCES "public"."growth_proposal_acceptances"("id","version_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_proposal_confirmations" ADD CONSTRAINT "growth_proposal_confirmations_version_fk" FOREIGN KEY ("version_id","proposal_id") REFERENCES "public"."growth_proposal_versions"("id","proposal_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_proposal_confirmations" ADD CONSTRAINT "growth_proposal_confirmations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Won leads: replaces the 4A.2 placeholder CHECK. All four won fields are present exactly when stage = 'won'.
ALTER TABLE "growth_leads" DROP CONSTRAINT "growth_leads_won_not_yet";
--> statement-breakpoint
ALTER TABLE "growth_leads" ADD COLUMN "won_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "growth_leads" ADD COLUMN "won_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "growth_leads" ADD COLUMN "won_amount_minor" bigint;
--> statement-breakpoint
ALTER TABLE "growth_leads" ADD COLUMN "won_currency" char(3);
--> statement-breakpoint
ALTER TABLE "growth_leads" ADD CONSTRAINT "growth_leads_won_fields" CHECK (
  CASE WHEN stage = 'won' THEN
        won_at IS NOT NULL
    AND won_version_id IS NOT NULL
    AND won_amount_minor IS NOT NULL
    AND won_currency IS NOT NULL AND won_currency = 'INR'
  ELSE
        won_at IS NULL
    AND won_version_id IS NULL
    AND won_amount_minor IS NULL
    AND won_currency IS NULL
  END
);
--> statement-breakpoint
ALTER TABLE "growth_leads" ADD CONSTRAINT "growth_leads_won_version_fk" FOREIGN KEY ("won_version_id","id") REFERENCES "public"."growth_proposal_versions"("id","lead_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "growth_leads_won_idx" ON "growth_leads" USING btree ("won_at","id") WHERE stage = 'won';
--> statement-breakpoint
-- growth_proposals is written only from inside proposal triggers. A direct INSERT or UPDATE by any role (including
-- crm_migrator DML) runs this guard at depth 1 and is refused; configuration settings are never consulted.
CREATE FUNCTION "public"."growth_proposals_write_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'growth_proposals is written only by proposal triggers' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.event_seq <> 0 OR NEW.status IS NOT NULL OR NEW.current_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'a proposal starts without status' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.lead_id IS DISTINCT FROM OLD.lead_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.event_seq IS DISTINCT FROM OLD.event_seq + 1 THEN
    RAISE EXCEPTION 'invalid proposal cache update' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_proposals_write_guard_row"
BEFORE INSERT OR UPDATE ON "public"."growth_proposals"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_proposals_write_guard"();
--> statement-breakpoint
CREATE TRIGGER "growth_proposals_append_only_delete"
BEFORE DELETE ON "public"."growth_proposals"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "growth_proposals_append_only_truncate"
BEFORE TRUNCATE ON "public"."growth_proposals"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
-- Version insert: lock the lead; it must be open, not archived and not won, and the creator an active CGO.
-- The first version creates the cache row for exactly the server-generated proposal_id and the route's lead;
-- any proposal/lead mismatch is refused. version_no, currency and created_at are forced.
CREATE FUNCTION "public"."growth_proposal_versions_before_insert"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  lead_stage public.growth_stage;
  lead_archived timestamptz;
  p public.growth_proposals%ROWTYPE;
BEGIN
  SELECT l.stage, l.archived_at INTO lead_stage, lead_archived FROM public.growth_leads l WHERE l.id = NEW.lead_id FOR UPDATE;
  IF NOT FOUND OR lead_archived IS NOT NULL OR lead_stage NOT IN ('new', 'contacted', 'qualified', 'proposal', 'negotiation') THEN
    RAISE EXCEPTION 'proposal versions need an open, non-archived lead' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.created_by AND u.status = 'active' AND u.role = 'cgo') THEN
    RAISE EXCEPTION 'proposal versions are created by an active CGO' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM public.growth_proposals g WHERE g.id = NEW.proposal_id;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.growth_proposals g WHERE g.lead_id = NEW.lead_id) THEN
      RAISE EXCEPTION 'this lead already has a proposal' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.growth_proposals (id, lead_id, created_by) VALUES (NEW.proposal_id, NEW.lead_id, NEW.created_by);
    NEW.version_no := 1;
  ELSE
    IF p.lead_id IS DISTINCT FROM NEW.lead_id THEN
      RAISE EXCEPTION 'the proposal belongs to another lead' USING ERRCODE = 'check_violation';
    END IF;
    IF p.status IS NULL OR p.status NOT IN ('draft', 'rejected', 'withdrawn', 'acceptance_refused') THEN
      RAISE EXCEPTION 'a new version is not allowed in status %', p.status USING ERRCODE = 'check_violation';
    END IF;
    NEW.version_no := p.current_version_no + 1;
  END IF;
  NEW.currency := 'INR';
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_versions_before_insert_row"
BEFORE INSERT ON "public"."growth_proposal_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_proposal_versions_before_insert"();
--> statement-breakpoint
-- After a version insert: supersede a current draft, then append the version's single NULL -> draft event.
CREATE FUNCTION "public"."growth_proposal_versions_after_insert"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  p public.growth_proposals%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.growth_proposals g WHERE g.id = NEW.proposal_id;
  IF p.status = 'draft' THEN
    INSERT INTO public.growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id)
    VALUES (NEW.proposal_id, p.current_version_id, 'draft', 'superseded', NEW.created_by);
  END IF;
  INSERT INTO public.growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id)
  VALUES (NEW.proposal_id, NEW.id, NULL, 'draft', NEW.created_by);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_versions_after_insert_row"
AFTER INSERT ON "public"."growth_proposal_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_proposal_versions_after_insert"();
--> statement-breakpoint
-- Event insert: the single gate for proposal status. User transitions must be direct (depth 1); internal ones
-- only from another trigger (depth > 1). The event must follow the cached status of the current version, the
-- actor must hold the right role, and seq/created_at are assigned here.
CREATE FUNCTION "public"."growth_proposal_events_before_insert"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pair text := coalesce(NEW.from_status::text, 'NULL') || '>' || NEW.to_status::text;
  internal boolean;
  ceo_decision boolean;
  p public.growth_proposals%ROWTYPE;
  v_no integer;
  v_valid date;
  lead public.growth_leads%ROWTYPE;
  acc public.growth_proposal_acceptances%ROWTYPE;
  decision public.growth_confirmation_decision;
BEGIN
  internal := pair IN ('NULL>draft', 'draft>superseded', 'sent>accepted', 'sent>acceptance_pending',
                       'acceptance_pending>accepted', 'acceptance_pending>acceptance_refused', 'accepted>won');
  IF internal THEN
    IF pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'transition % is made only by the database', pair USING ERRCODE = 'check_violation';
    END IF;
  ELSIF pair IN ('draft>pending_approval', 'pending_approval>approved', 'pending_approval>rejected', 'approved>sent',
                 'draft>withdrawn', 'pending_approval>withdrawn', 'approved>withdrawn', 'sent>withdrawn',
                 'acceptance_pending>withdrawn', 'accepted>withdrawn') THEN
    IF pg_trigger_depth() <> 1 THEN
      RAISE EXCEPTION 'transition % must be made directly', pair USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'proposal transition % is not allowed', pair USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO p FROM public.growth_proposals g WHERE g.id = NEW.proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown proposal' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO lead FROM public.growth_leads l WHERE l.id = p.lead_id FOR UPDATE;
  SELECT * INTO p FROM public.growth_proposals g WHERE g.id = NEW.proposal_id;
  SELECT v.version_no, v.valid_until INTO v_no, v_valid FROM public.growth_proposal_versions v
   WHERE v.id = NEW.version_id AND v.proposal_id = NEW.proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the version does not belong to this proposal' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.from_status IS NULL THEN
    IF NOT (p.status IS NULL OR p.status IN ('superseded', 'rejected', 'withdrawn', 'acceptance_refused'))
       OR v_no <> coalesce(p.current_version_no, 0) + 1 THEN
      RAISE EXCEPTION 'a new draft must be the next version' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.version_id IS DISTINCT FROM p.current_version_id OR NEW.from_status IS DISTINCT FROM p.status THEN
    RAISE EXCEPTION 'the event does not follow the current version and status' USING ERRCODE = 'check_violation';
  END IF;

  ceo_decision := pair IN ('pending_approval>approved', 'pending_approval>rejected', 'acceptance_pending>accepted', 'acceptance_pending>acceptance_refused');
  IF ceo_decision THEN
    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.actor_id AND u.is_super_admin AND u.status = 'active') THEN
      RAISE EXCEPTION 'only the CEO/CTO decides this' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.actor_id AND u.role = 'cgo' AND u.status = 'active') THEN
    RAISE EXCEPTION 'only an active CGO makes this change' USING ERRCODE = 'check_violation';
  END IF;

  -- Sending needs a validity date that has not passed anywhere (UTC-12); the API applies the organisation date.
  IF pair = 'approved>sent' AND v_valid < (now() AT TIME ZONE 'Etc/GMT+12')::date THEN
    RAISE EXCEPTION 'the proposal validity has ended' USING ERRCODE = 'check_violation';
  END IF;
  IF pair IN ('sent>accepted', 'sent>acceptance_pending') THEN
    SELECT * INTO acc FROM public.growth_proposal_acceptances a WHERE a.version_id = NEW.version_id;
    IF NOT FOUND OR acc.needs_confirmation <> (NEW.to_status = 'acceptance_pending') THEN
      RAISE EXCEPTION 'acceptance does not match the transition' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF pair IN ('acceptance_pending>accepted', 'acceptance_pending>acceptance_refused') THEN
    SELECT c.decision INTO decision FROM public.growth_proposal_confirmations c WHERE c.version_id = NEW.version_id;
    IF NOT FOUND OR (decision = 'confirmed') <> (NEW.to_status = 'accepted') THEN
      RAISE EXCEPTION 'confirmation does not match the transition' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF pair = 'accepted>won' AND (lead.stage <> 'won' OR lead.won_version_id IS DISTINCT FROM NEW.version_id) THEN
    RAISE EXCEPTION 'the lead is not won with this version' USING ERRCODE = 'check_violation';
  END IF;

  NEW.seq := p.event_seq + 1;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_events_before_insert_row"
BEFORE INSERT ON "public"."growth_proposal_events"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_proposal_events_before_insert"();
--> statement-breakpoint
-- After every event: move the cache to the event (nested update, allowed by the write guard).
CREATE FUNCTION "public"."growth_proposal_events_after_insert"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.from_status IS NULL THEN
    UPDATE public.growth_proposals g
       SET status = NEW.to_status, current_version_id = NEW.version_id,
           current_version_no = (SELECT v.version_no FROM public.growth_proposal_versions v WHERE v.id = NEW.version_id),
           event_seq = NEW.seq, updated_at = now()
     WHERE g.id = NEW.proposal_id;
  ELSE
    UPDATE public.growth_proposals g SET status = NEW.to_status, event_seq = NEW.seq, updated_at = now() WHERE g.id = NEW.proposal_id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_events_after_insert_row"
AFTER INSERT ON "public"."growth_proposal_events"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_proposal_events_after_insert"();
--> statement-breakpoint
-- At commit, every proposal's cache equals its latest immutable event.
CREATE FUNCTION "public"."growth_proposals_cache_check"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  p public.growth_proposals%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.growth_proposals g WHERE g.id = NEW.id;
  IF p.event_seq < 1
     OR NOT EXISTS (
       SELECT 1 FROM public.growth_proposal_events e JOIN public.growth_proposal_versions v ON v.id = e.version_id
        WHERE e.proposal_id = p.id AND e.seq = p.event_seq AND e.to_status = p.status
          AND e.version_id = p.current_version_id AND v.version_no = p.current_version_no)
     OR EXISTS (SELECT 1 FROM public.growth_proposal_events e WHERE e.proposal_id = p.id AND e.seq > p.event_seq) THEN
    RAISE EXCEPTION 'proposal % status does not match its latest event', p.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "growth_proposals_cache_matches_events"
AFTER INSERT OR UPDATE ON "public"."growth_proposals"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."growth_proposals_cache_check"();
--> statement-breakpoint
-- At commit, every version has exactly one creation (NULL -> draft) event.
CREATE FUNCTION "public"."growth_proposal_versions_creation_check"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF (SELECT count(*) FROM public.growth_proposal_events e WHERE e.version_id = NEW.id AND e.from_status IS NULL) <> 1 THEN
    RAISE EXCEPTION 'version % has no creation event', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "growth_proposal_versions_have_creation_event"
AFTER INSERT ON "public"."growth_proposal_versions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."growth_proposal_versions_creation_check"();
--> statement-breakpoint
-- Acceptance: only for the current, sent version of the row's own proposal and lead. late and needs_confirmation
-- are computed here. Late = accepted after validity, or recorded once validity has ended anywhere (UTC+14).
CREATE FUNCTION "public"."growth_proposal_acceptances_before_insert"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  p public.growth_proposals%ROWTYPE;
  v_valid date;
  sent_at timestamptz;
BEGIN
  PERFORM 1 FROM public.growth_leads l WHERE l.id = NEW.lead_id FOR UPDATE;
  SELECT * INTO p FROM public.growth_proposals g WHERE g.id = NEW.proposal_id;
  IF NOT FOUND OR p.lead_id IS DISTINCT FROM NEW.lead_id OR p.status IS DISTINCT FROM 'sent'
     OR p.current_version_id IS DISTINCT FROM NEW.version_id THEN
    RAISE EXCEPTION 'acceptance needs the current sent version' USING ERRCODE = 'check_violation';
  END IF;
  SELECT v.valid_until INTO v_valid FROM public.growth_proposal_versions v WHERE v.id = NEW.version_id;
  SELECT max(e.created_at) INTO sent_at FROM public.growth_proposal_events e WHERE e.version_id = NEW.version_id AND e.to_status = 'sent';
  IF NEW.accepted_on < (sent_at AT TIME ZONE 'Etc/GMT+12')::date OR NEW.accepted_on > (now() AT TIME ZONE 'Etc/GMT-14')::date THEN
    RAISE EXCEPTION 'the acceptance date must be between sending and today' USING ERRCODE = 'check_violation';
  END IF;
  NEW.recorded_at := now();
  NEW.late := NEW.accepted_on > v_valid OR now() >= ((v_valid + 1)::timestamp AT TIME ZONE 'Etc/GMT-14');
  NEW.needs_confirmation := NEW.method = 'verbal' OR NEW.late;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_acceptances_before_insert_row"
BEFORE INSERT ON "public"."growth_proposal_acceptances"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_proposal_acceptances_before_insert"();
--> statement-breakpoint
CREATE FUNCTION "public"."growth_proposal_acceptances_after_insert"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO public.growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id)
  VALUES (NEW.proposal_id, NEW.version_id, 'sent',
          CASE WHEN NEW.needs_confirmation THEN 'acceptance_pending'::public.growth_proposal_status ELSE 'accepted'::public.growth_proposal_status END,
          NEW.recorded_by);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_acceptances_after_insert_row"
AFTER INSERT ON "public"."growth_proposal_acceptances"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_proposal_acceptances_after_insert"();
--> statement-breakpoint
-- CEO confirmation: proposal_id and version_id are taken from the acceptance; it must be awaiting confirmation.
CREATE FUNCTION "public"."growth_proposal_confirmations_before_insert"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  acc public.growth_proposal_acceptances%ROWTYPE;
  p public.growth_proposals%ROWTYPE;
BEGIN
  SELECT * INTO acc FROM public.growth_proposal_acceptances a WHERE a.id = NEW.acceptance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown acceptance' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM public.growth_leads l WHERE l.id = acc.lead_id FOR UPDATE;
  SELECT * INTO p FROM public.growth_proposals g WHERE g.id = acc.proposal_id;
  IF NOT acc.needs_confirmation OR p.status IS DISTINCT FROM 'acceptance_pending' OR p.current_version_id IS DISTINCT FROM acc.version_id THEN
    RAISE EXCEPTION 'this acceptance is not awaiting confirmation' USING ERRCODE = 'check_violation';
  END IF;
  NEW.proposal_id := acc.proposal_id;
  NEW.version_id := acc.version_id;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_confirmations_before_insert_row"
BEFORE INSERT ON "public"."growth_proposal_confirmations"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_proposal_confirmations_before_insert"();
--> statement-breakpoint
CREATE FUNCTION "public"."growth_proposal_confirmations_after_insert"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO public.growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id, note)
  VALUES (NEW.proposal_id, NEW.version_id, 'acceptance_pending',
          CASE WHEN NEW.decision = 'confirmed' THEN 'accepted'::public.growth_proposal_status ELSE 'acceptance_refused'::public.growth_proposal_status END,
          NEW.actor_id, NEW.note);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_confirmations_after_insert_row"
AFTER INSERT ON "public"."growth_proposal_confirmations"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_proposal_confirmations_after_insert"();
--> statement-breakpoint
-- Versions, events, acceptances and confirmations are append-only for every role.
CREATE TRIGGER "growth_proposal_versions_append_only_row" BEFORE UPDATE OR DELETE ON "public"."growth_proposal_versions" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_versions_append_only_truncate" BEFORE TRUNCATE ON "public"."growth_proposal_versions" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_events_append_only_row" BEFORE UPDATE OR DELETE ON "public"."growth_proposal_events" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_events_append_only_truncate" BEFORE TRUNCATE ON "public"."growth_proposal_events" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_acceptances_append_only_row" BEFORE UPDATE OR DELETE ON "public"."growth_proposal_acceptances" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_acceptances_append_only_truncate" BEFORE TRUNCATE ON "public"."growth_proposal_acceptances" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_confirmations_append_only_row" BEFORE UPDATE OR DELETE ON "public"."growth_proposal_confirmations" FOR EACH ROW EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
CREATE TRIGGER "growth_proposal_confirmations_append_only_truncate" BEFORE TRUNCATE ON "public"."growth_proposal_confirmations" FOR EACH STATEMENT EXECUTE FUNCTION "public"."growth_append_only_guard"();
--> statement-breakpoint
-- Replaces the 4A.2 state guard. Fires (alphabetically) before growth_leads_won_before_row:
-- won leads are final for every update; archived leads are read-only; a lead cannot become lost or archived
-- while its proposal is active; a lost lead that stays lost may change only owner, archive state and version.
CREATE OR REPLACE FUNCTION "public"."growth_leads_state_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.stage = 'won' THEN
    RAISE EXCEPTION 'a won lead is final' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'an archived lead is read-only' USING ERRCODE = 'check_violation';
  END IF;
  IF ((NEW.stage = 'lost' AND OLD.stage <> 'lost') OR (NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL))
     AND EXISTS (SELECT 1 FROM public.growth_proposals p WHERE p.lead_id = NEW.id
                  AND p.status IN ('draft', 'pending_approval', 'approved', 'sent', 'acceptance_pending', 'accepted')) THEN
    RAISE EXCEPTION 'withdraw the active proposal first' USING ERRCODE = 'check_violation';
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
-- won_version_id (and the other won fields) change only in the update that moves a non-won lead to won; that
-- update must name the accepted (and, where needed, CEO-confirmed) current version, and the amount, currency and
-- won_at are copied here, overwriting anything supplied.
CREATE FUNCTION "public"."growth_leads_won_before"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  p public.growth_proposals%ROWTYPE;
  acc public.growth_proposal_acceptances%ROWTYPE;
  amount bigint;
BEGIN
  IF NOT (OLD.stage <> 'won' AND NEW.stage = 'won') THEN
    IF ROW(NEW.won_at, NEW.won_version_id, NEW.won_amount_minor, NEW.won_currency)
       IS DISTINCT FROM ROW(OLD.won_at, OLD.won_version_id, OLD.won_amount_minor, OLD.won_currency) THEN
      RAISE EXCEPTION 'won fields change only when a lead is marked won' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.won_version_id IS NULL OR OLD.stage NOT IN ('new', 'contacted', 'qualified', 'proposal', 'negotiation') THEN
    RAISE EXCEPTION 'only an open lead with an accepted proposal version can be won' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM public.growth_proposals g WHERE g.lead_id = NEW.id;
  IF NOT FOUND OR p.status IS DISTINCT FROM 'accepted' OR p.current_version_id IS DISTINCT FROM NEW.won_version_id THEN
    RAISE EXCEPTION 'the won version must be the accepted current version' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO acc FROM public.growth_proposal_acceptances a WHERE a.version_id = NEW.won_version_id;
  IF NOT FOUND OR (acc.needs_confirmation AND NOT EXISTS (
       SELECT 1 FROM public.growth_proposal_confirmations c WHERE c.acceptance_id = acc.id AND c.decision = 'confirmed')) THEN
    RAISE EXCEPTION 'the acceptance is missing or not confirmed' USING ERRCODE = 'check_violation';
  END IF;
  SELECT v.amount_minor INTO amount FROM public.growth_proposal_versions v WHERE v.id = NEW.won_version_id AND v.lead_id = NEW.id;
  NEW.won_at := now();
  NEW.won_amount_minor := amount;
  NEW.won_currency := 'INR';
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_leads_won_before_row"
BEFORE UPDATE ON "public"."growth_leads"
FOR EACH ROW EXECUTE FUNCTION "public"."growth_leads_won_before"();
--> statement-breakpoint
-- The won stage-history row (written by the actor right after the stage update) appends the internal
-- accepted -> won proposal event with that actor.
CREATE FUNCTION "public"."growth_stage_changes_won_event"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  p public.growth_proposals%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.growth_proposals g WHERE g.lead_id = NEW.lead_id;
  INSERT INTO public.growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id)
  VALUES (p.id, p.current_version_id, 'accepted', 'won', NEW.actor_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "growth_stage_changes_won_event_row"
AFTER INSERT ON "public"."growth_stage_changes"
FOR EACH ROW WHEN (NEW.to_stage = 'won')
EXECUTE FUNCTION "public"."growth_stage_changes_won_event"();
--> statement-breakpoint
-- At commit, a won lead's proposal is in status won.
CREATE FUNCTION "public"."growth_leads_won_event_check"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.growth_proposals p WHERE p.lead_id = NEW.id AND p.status = 'won' AND p.current_version_id = NEW.won_version_id) THEN
    RAISE EXCEPTION 'won lead % has no won proposal event', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "growth_leads_won_event_required"
AFTER UPDATE OF "stage" ON "public"."growth_leads"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.stage = 'won' AND OLD.stage IS DISTINCT FROM NEW.stage)
EXECUTE FUNCTION "public"."growth_leads_won_event_check"();
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."growth_proposal_versions_before_insert"(), "public"."growth_proposal_versions_after_insert"(),
  "public"."growth_proposal_events_before_insert"(), "public"."growth_proposal_events_after_insert"(),
  "public"."growth_proposal_acceptances_before_insert"(), "public"."growth_proposal_acceptances_after_insert"(),
  "public"."growth_proposal_confirmations_before_insert"(), "public"."growth_proposal_confirmations_after_insert"(),
  "public"."growth_stage_changes_won_event"() FROM PUBLIC;
