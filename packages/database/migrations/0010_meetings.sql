-- 0010_meetings: meetings, attendees, in-app notifications, and the guard that limits crm_app outbox inserts
-- to meeting reminders. Runs as crm_migrator. Must stay consistent with packages/database/src/schema/meetings.ts.
-- Enum type names never equal a table name (a table's row type would clash).
CREATE TYPE "public"."meeting_state" AS ENUM('scheduled', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."meeting_response" AS ENUM('pending', 'accepted', 'declined');
--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('meeting_reminder');
--> statement-breakpoint
-- Lets a meeting reference a task together with its project. Additive; no existing data changes.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_id_project_unique" UNIQUE("id","project_id");
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" text,
	"meeting_url" text,
	"project_id" uuid,
	"task_id" uuid,
	"status" "meeting_state" DEFAULT 'scheduled' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"organizer_id" uuid NOT NULL,
	"organizer_is_super_admin" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"responses_reset_at" timestamp with time zone,
	CONSTRAINT "meetings_time_order" CHECK (ends_at > starts_at),
	CONSTRAINT "meetings_max_duration" CHECK (ends_at - starts_at <= interval '12 hours'),
	CONSTRAINT "meetings_title_length" CHECK (char_length(title) BETWEEN 1 AND 200),
	CONSTRAINT "meetings_description_length" CHECK (char_length(description) <= 5000),
	CONSTRAINT "meetings_location_length" CHECK (location IS NULL OR char_length(location) BETWEEN 1 AND 500),
	CONSTRAINT "meetings_url_https" CHECK (meeting_url IS NULL OR (meeting_url ~ '^https://[^\s/?#]+[^\s]*$' AND char_length(meeting_url) <= 2000)),
	CONSTRAINT "meetings_version_positive" CHECK (version >= 1),
	CONSTRAINT "meetings_cancelled_at" CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
	CONSTRAINT "meetings_task_needs_project" CHECK (task_id IS NULL OR project_id IS NOT NULL),
	CONSTRAINT "meetings_organizer_super_admin" CHECK (organizer_is_super_admin = true),
	CONSTRAINT "meetings_responses_reset_after_create" CHECK (responses_reset_at IS NULL OR responses_reset_at >= created_at)
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- A referenced task must belong to the referenced project. Not checked when task_id is NULL (MATCH SIMPLE).
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_task_project_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Only the Super Admin (CEO/CTO) can organise a meeting.
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizer_fk" FOREIGN KEY ("organizer_id","organizer_is_super_admin") REFERENCES "public"."users"("id","is_super_admin") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "meetings_starts_at_idx" ON "meetings" USING btree ("starts_at");
--> statement-breakpoint
CREATE INDEX "meetings_status_starts_at_idx" ON "meetings" USING btree ("status","starts_at");
--> statement-breakpoint
CREATE TABLE "meeting_attendees" (
	"meeting_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"response" "meeting_response" DEFAULT 'pending' NOT NULL,
	"responded_at" timestamp with time zone,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "meeting_attendees_pk" PRIMARY KEY("meeting_id","user_id"),
	CONSTRAINT "meeting_attendees_responded_at" CHECK ((response = 'pending') = (responded_at IS NULL))
);
--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "meeting_attendees_user_idx" ON "meeting_attendees" USING btree ("user_id","meeting_id");
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"meeting_id" uuid NOT NULL,
	"meeting_version" integer NOT NULL,
	"minutes_before" integer NOT NULL,
	"source_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_source_recipient_unique" UNIQUE("source_event_id","recipient_id"),
	CONSTRAINT "notifications_minutes_before" CHECK (minutes_before IN (10, 5, 2)),
	CONSTRAINT "notifications_version_positive" CHECK (meeting_version >= 1),
	CONSTRAINT "notifications_read_after_create" CHECK (read_at IS NULL OR read_at >= created_at)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_id","read_at","created_at");
--> statement-breakpoint
-- crm_app may insert only meeting reminder events, with exactly the expected payload and dedupe key.
-- Existing outbox guards (status transitions, immutable columns, no DELETE/TRUNCATE) are unchanged.
CREATE FUNCTION "public"."outbox_events_app_insert_guard"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  keys text[];
BEGIN
  IF current_user <> 'crm_app' THEN
    RETURN NEW;
  END IF;
  SELECT array_agg(k ORDER BY k COLLATE "C") INTO keys FROM jsonb_object_keys(NEW.payload) AS k;
  IF NEW.event_type <> 'meetings.reminder_due'
     OR keys IS DISTINCT FROM ARRAY['meetingId', 'minutesBefore', 'version']
     OR jsonb_typeof(NEW.payload -> 'meetingId') <> 'string'
     OR jsonb_typeof(NEW.payload -> 'version') <> 'number'
     OR (NEW.payload ->> 'minutesBefore') NOT IN ('10', '5', '2')
     OR NEW.dedupe_key !~ '^meeting:[0-9a-f-]{36}:v[0-9]+:m(10|5|2)$'
     OR NEW.status <> 'pending' OR NEW.attempts <> 0
     OR NEW.locked_by IS NOT NULL OR NEW.locked_until IS NOT NULL
     OR NEW.last_error IS NOT NULL OR NEW.processed_at IS NOT NULL THEN
    RAISE EXCEPTION 'crm_app may only insert meeting reminder events'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "outbox_events_app_insert_guard_row"
BEFORE INSERT ON "public"."outbox_events"
FOR EACH ROW EXECUTE FUNCTION "public"."outbox_events_app_insert_guard"();
