-- 0008_quality: QA checks, append-only QA results, defects, append-only defect updates, and append-only
-- release-readiness decisions. Runs as crm_migrator. Must stay consistent with packages/database/src/schema/quality.ts.
CREATE TYPE "public"."qa_outcome" AS ENUM('passed', 'failed', 'blocked');
--> statement-breakpoint
CREATE TYPE "public"."defect_severity" AS ENUM('critical', 'high', 'medium', 'low');
--> statement-breakpoint
CREATE TYPE "public"."defect_status" AS ENUM('open', 'in_progress', 'fixed', 'verified', 'wont_fix');
--> statement-breakpoint
CREATE TYPE "public"."release_readiness_status" AS ENUM('not_ready', 'at_risk', 'ready');
--> statement-breakpoint
CREATE TABLE "qa_checks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latest_outcome" "qa_outcome",
	"latest_result_at" timestamp with time zone,
	CONSTRAINT "qa_checks_id_task_unique" UNIQUE("id","task_id"),
	CONSTRAINT "qa_checks_title_length" CHECK (char_length(title) BETWEEN 1 AND 200),
	CONSTRAINT "qa_checks_latest_pair" CHECK ((latest_outcome IS NULL) = (latest_result_at IS NULL))
);
--> statement-breakpoint
ALTER TABLE "qa_checks" ADD CONSTRAINT "qa_checks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "qa_checks" ADD CONSTRAINT "qa_checks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "qa_checks_task_idx" ON "qa_checks" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX "qa_checks_latest_outcome_idx" ON "qa_checks" USING btree ("latest_outcome");
--> statement-breakpoint
CREATE TABLE "qa_results" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"qa_check_id" uuid NOT NULL,
	"outcome" "qa_outcome" NOT NULL,
	"note" text,
	"evidence_url" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qa_results_note_required" CHECK (outcome = 'passed' OR note IS NOT NULL),
	CONSTRAINT "qa_results_note_length" CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
	CONSTRAINT "qa_results_url_https" CHECK (evidence_url IS NULL OR (evidence_url ~ '^https://[^\s/?#]+[^\s]*$' AND char_length(evidence_url) <= 2000))
);
--> statement-breakpoint
ALTER TABLE "qa_results" ADD CONSTRAINT "qa_results_qa_check_id_qa_checks_id_fk" FOREIGN KEY ("qa_check_id") REFERENCES "public"."qa_checks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "qa_results" ADD CONSTRAINT "qa_results_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "qa_results_check_idx" ON "qa_results" USING btree ("qa_check_id","recorded_at");
--> statement-breakpoint
CREATE TABLE "defects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"qa_check_id" uuid,
	"title" text NOT NULL,
	"severity" "defect_severity" NOT NULL,
	"status" "defect_status" DEFAULT 'open' NOT NULL,
	"reproduction_steps" text NOT NULL,
	"reported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "defects_title_length" CHECK (char_length(title) BETWEEN 1 AND 200),
	CONSTRAINT "defects_reproduction_length" CHECK (char_length(reproduction_steps) BETWEEN 1 AND 10000),
	CONSTRAINT "defects_resolved_at" CHECK ((status IN ('verified', 'wont_fix')) = (resolved_at IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- A linked QA check must belong to the same task. Not checked when qa_check_id is NULL (MATCH SIMPLE).
ALTER TABLE "defects" ADD CONSTRAINT "defects_qa_check_same_task_fk" FOREIGN KEY ("qa_check_id","task_id") REFERENCES "public"."qa_checks"("id","task_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "defects_task_idx" ON "defects" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX "defects_status_severity_idx" ON "defects" USING btree ("status","severity");
--> statement-breakpoint
CREATE TABLE "defect_updates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"defect_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"note" text,
	"evidence_url" text,
	"from_status" "defect_status",
	"to_status" "defect_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "defect_updates_status_pair" CHECK ((from_status IS NULL) = (to_status IS NULL)),
	CONSTRAINT "defect_updates_has_content" CHECK (note IS NOT NULL OR evidence_url IS NOT NULL OR to_status IS NOT NULL),
	CONSTRAINT "defect_updates_note_length" CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 5000),
	CONSTRAINT "defect_updates_note_required" CHECK (note IS NOT NULL OR to_status IS NULL OR (to_status NOT IN ('fixed', 'wont_fix') AND NOT (from_status = 'fixed' AND to_status = 'open'))),
	CONSTRAINT "defect_updates_url_https" CHECK (evidence_url IS NULL OR (evidence_url ~ '^https://[^\s/?#]+[^\s]*$' AND char_length(evidence_url) <= 2000))
);
--> statement-breakpoint
ALTER TABLE "defect_updates" ADD CONSTRAINT "defect_updates_defect_id_defects_id_fk" FOREIGN KEY ("defect_id") REFERENCES "public"."defects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "defect_updates" ADD CONSTRAINT "defect_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "defect_updates_defect_idx" ON "defect_updates" USING btree ("defect_id","created_at");
--> statement-breakpoint
CREATE TABLE "release_readiness" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text NOT NULL,
	"readiness" "release_readiness_status" NOT NULL,
	"note" text,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_readiness_label_length" CHECK (char_length(label) BETWEEN 1 AND 100),
	CONSTRAINT "release_readiness_note_length" CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000),
	CONSTRAINT "release_readiness_note_required" CHECK (readiness = 'ready' OR note IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "release_readiness" ADD CONSTRAINT "release_readiness_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "release_readiness" ADD CONSTRAINT "release_readiness_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "release_readiness_project_idx" ON "release_readiness" USING btree ("project_id","decided_at" DESC,"id" DESC);
