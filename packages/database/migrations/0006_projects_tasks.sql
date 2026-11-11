-- 0006_projects_tasks: projects, tasks, and append-only task history (updates, proofs, reviews).
-- Runs as crm_migrator. Must stay consistent with packages/database/src/schema/{projects,tasks}.ts.
CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'blocked', 'in_review', 'changes_requested', 'completed');
--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'urgent');
--> statement-breakpoint
CREATE TYPE "public"."task_review_decision" AS ENUM('approved', 'changes_requested', 'marked_complete');
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_name_length" CHECK (char_length(name) BETWEEN 1 AND 200),
	CONSTRAINT "projects_description_length" CHECK (char_length(description) <= 5000)
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"due_date" date NOT NULL,
	"assignee_id" uuid NOT NULL,
	"assignee_is_super_admin" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tasks_title_length" CHECK (char_length(title) BETWEEN 1 AND 200),
	CONSTRAINT "tasks_description_length" CHECK (char_length(description) <= 10000),
	CONSTRAINT "tasks_completed_at" CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
	CONSTRAINT "tasks_assignee_not_super_admin" CHECK (assignee_is_super_admin = false)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- The assignee can only be a row with is_super_admin = false: the CEO/CTO can never be assigned a task.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_fk" FOREIGN KEY ("assignee_id","assignee_is_super_admin") REFERENCES "public"."users"("id","is_super_admin") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tasks_assignee_status_idx" ON "tasks" USING btree ("assignee_id","status");
--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "tasks" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "tasks_status_due_idx" ON "tasks" USING btree ("status","due_date");
--> statement-breakpoint
CREATE TABLE "task_updates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"from_status" "task_status",
	"to_status" "task_status",
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_updates_status_pair" CHECK ((from_status IS NULL) = (to_status IS NULL)),
	CONSTRAINT "task_updates_has_content" CHECK (note IS NOT NULL OR to_status IS NOT NULL),
	CONSTRAINT "task_updates_note_length" CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 5000)
);
--> statement-breakpoint
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "task_updates_task_idx" ON "task_updates" USING btree ("task_id","created_at");
--> statement-breakpoint
CREATE TABLE "task_proofs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"url" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_proofs_has_content" CHECK (url IS NOT NULL OR note IS NOT NULL),
	CONSTRAINT "task_proofs_url_https" CHECK (url IS NULL OR (url ~ '^https://[^\s/?#]+[^\s]*$' AND char_length(url) <= 2000)),
	CONSTRAINT "task_proofs_note_length" CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
ALTER TABLE "task_proofs" ADD CONSTRAINT "task_proofs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_proofs" ADD CONSTRAINT "task_proofs_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "task_proofs_task_idx" ON "task_proofs" USING btree ("task_id","created_at");
--> statement-breakpoint
CREATE TABLE "task_reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" "task_review_decision" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_reviews_changes_need_note" CHECK (decision <> 'changes_requested' OR note IS NOT NULL),
	CONSTRAINT "task_reviews_note_length" CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "task_reviews_task_idx" ON "task_reviews" USING btree ("task_id","created_at");
