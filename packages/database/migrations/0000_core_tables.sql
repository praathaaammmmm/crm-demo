-- 0000_core_tables: enums, Phase 1 tables, constraints and indexes.
-- Runs as crm_migrator. Must stay consistent with packages/database/src/schema/*.ts.
CREATE TYPE "public"."user_role" AS ENUM('ceo_cto', 'cfo', 'cgo', 'cmo', 'vp_engineering_quality', 'founder', 'employee', 'intern', 'contractor');
--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'deactivated');
--> statement-breakpoint
CREATE TYPE "public"."session_end_reason" AS ENUM('logout', 'expired', 'revoked');
--> statement-breakpoint
CREATE TYPE "public"."attendance_kind" AS ENUM('login', 'session_end');
--> statement-breakpoint
CREATE TYPE "public"."approval_type" AS ENUM('user.role_change', 'user.deactivate');
--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'system', 'bootstrap', 'anonymous');
--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'done', 'cancelled', 'failed');
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"reports_to_user_id" uuid,
	"reports_to_is_super_admin" boolean,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"deactivated_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_id_super_admin_unique" UNIQUE("id","is_super_admin"),
	CONSTRAINT "users_email_lowercase" CHECK (email = lower(email)),
	CONSTRAINT "users_email_length" CHECK (char_length(email) BETWEEN 3 AND 254),
	CONSTRAINT "users_name_length" CHECK (char_length(name) BETWEEN 1 AND 200),
	CONSTRAINT "users_super_admin_role" CHECK (is_super_admin = (role = 'ceo_cto')),
	CONSTRAINT "users_super_admin_no_manager" CHECK (is_super_admin = (reports_to_user_id IS NULL)),
	CONSTRAINT "users_reports_to_super_admin" CHECK (reports_to_is_super_admin IS DISTINCT FROM false),
	CONSTRAINT "users_super_admin_active" CHECK (NOT (is_super_admin AND status = 'deactivated')),
	CONSTRAINT "users_deactivated_at" CHECK ((status = 'deactivated') = (deactivated_at IS NOT NULL)),
	CONSTRAINT "users_failed_login_count" CHECK (failed_login_count >= 0)
);
--> statement-breakpoint
-- MATCH FULL: both reporting columns are NULL (Super Admin) or both are set and point at the Super Admin row.
ALTER TABLE "users" ADD CONSTRAINT "users_reports_to_fk" FOREIGN KEY ("reports_to_user_id","reports_to_is_super_admin") REFERENCES "public"."users"("id","is_super_admin") MATCH FULL ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_one_super_admin" ON "users" USING btree ("is_super_admin") WHERE is_super_admin;
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '12 hours' NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" "session_end_reason",
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "sessions_token_hash_length" CHECK (octet_length(token_hash) = 32),
	CONSTRAINT "sessions_fixed_duration" CHECK (expires_at = created_at + interval '12 hours'),
	CONSTRAINT "sessions_end_fields" CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
	CONSTRAINT "sessions_ended_after_created" CHECK (ended_at IS NULL OR ended_at >= created_at),
	CONSTRAINT "sessions_expired_at_expiry" CHECK (end_reason IS DISTINCT FROM 'expired' OR ended_at = expires_at)
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sessions_active_expiry_idx" ON "sessions" USING btree ("expires_at") WHERE ended_at IS NULL;
--> statement-breakpoint
CREATE INDEX "sessions_active_user_idx" ON "sessions" USING btree ("user_id") WHERE ended_at IS NULL;
--> statement-breakpoint
CREATE TABLE "attendance_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" "attendance_kind" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "attendance_events_session_kind_unique" UNIQUE("session_id","kind")
);
--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_session_user_fk" FOREIGN KEY ("session_id","user_id") REFERENCES "public"."sessions"("id","user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "attendance_events_user_occurred_idx" ON "attendance_events" USING btree ("user_id","occurred_at");
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" "approval_type" NOT NULL,
	"target_user_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "approval_requests_payload_object" CHECK (jsonb_typeof(payload) = 'object'),
	CONSTRAINT "approval_requests_reason_length" CHECK (char_length(reason) BETWEEN 1 AND 500),
	CONSTRAINT "approval_requests_note_length" CHECK (decision_note IS NULL OR char_length(decision_note) BETWEEN 1 AND 500),
	CONSTRAINT "approval_requests_not_self" CHECK (requested_by <> target_user_id),
	CONSTRAINT "approval_requests_decided_at" CHECK ((status = 'pending') = (decided_at IS NULL)),
	CONSTRAINT "approval_requests_decided_by" CHECK ((status IN ('approved', 'rejected')) = (decided_by IS NOT NULL)),
	CONSTRAINT "approval_requests_reject_note" CHECK (status <> 'rejected' OR decision_note IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_one_pending" ON "approval_requests" USING btree ("type","target_user_id") WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX "approval_requests_requester_idx" ON "approval_requests" USING btree ("requested_by","requested_at");
--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("status","requested_at");
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	CONSTRAINT "audit_events_actor" CHECK ((actor_type = 'user') = (actor_user_id IS NOT NULL)),
	CONSTRAINT "audit_events_action_format" CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
	CONSTRAINT "audit_events_entity_type_format" CHECK (entity_type ~ '^[a-z_]+$'),
	CONSTRAINT "audit_events_before_object" CHECK (before IS NULL OR jsonb_typeof(before) = 'object'),
	CONSTRAINT "audit_events_after_object" CHECK (after IS NULL OR jsonb_typeof(after) = 'object'),
	CONSTRAINT "audit_events_request_id_length" CHECK (request_id IS NULL OR char_length(request_id) <= 100)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");
--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_user_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "audit_events_occurred_idx" ON "audit_events" USING btree ("occurred_at");
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "outbox_events_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "outbox_events_event_type_format" CHECK (event_type ~ '^[a-z_]+\.[a-z_]+$'),
	CONSTRAINT "outbox_events_payload_object" CHECK (jsonb_typeof(payload) = 'object'),
	CONSTRAINT "outbox_events_dedupe_key_length" CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
	CONSTRAINT "outbox_events_attempts" CHECK (attempts >= 0),
	CONSTRAINT "outbox_events_max_attempts" CHECK (max_attempts BETWEEN 1 AND 20),
	CONSTRAINT "outbox_events_last_error_length" CHECK (last_error IS NULL OR char_length(last_error) <= 500),
	CONSTRAINT "outbox_events_processing_lock" CHECK (status <> 'processing' OR (locked_by IS NOT NULL AND locked_until IS NOT NULL)),
	CONSTRAINT "outbox_events_processed_at" CHECK ((status IN ('done', 'cancelled', 'failed')) = (processed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "outbox_events_status_available_idx" ON "outbox_events" USING btree ("status","available_at");
