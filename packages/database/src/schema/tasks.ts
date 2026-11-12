import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./organization.js";
import { projects } from "./projects.js";

export const taskStatus = pgEnum("task_status", [
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "changes_requested",
  "completed",
]);
export const taskPriority = pgEnum("task_priority", ["low", "medium", "high", "urgent"]);
export const taskReviewDecision = pgEnum("task_review_decision", ["approved", "changes_requested", "marked_complete"]);

/**
 * The composite foreign key (assignee_id, assignee_is_super_admin) -> users(id, is_super_admin), with
 * assignee_is_super_admin fixed to false, means the CEO/CTO can never be assigned a task.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    priority: taskPriority("priority").notNull().default("medium"),
    status: taskStatus("status").notNull().default("todo"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    assigneeId: uuid("assignee_id").notNull(),
    assigneeIsSuperAdmin: boolean("assignee_is_super_admin").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "tasks_assignee_fk",
      columns: [t.assigneeId, t.assigneeIsSuperAdmin],
      foreignColumns: [users.id, users.isSuperAdmin],
    }),
    index("tasks_assignee_status_idx").on(t.assigneeId, t.status),
    index("tasks_project_idx").on(t.projectId),
    // Lets meetings reference a task together with its project (migration 0010).
    unique("tasks_id_project_unique").on(t.id, t.projectId),
    index("tasks_status_due_idx").on(t.status, t.dueDate),
    check("tasks_title_length", sql`char_length(title) BETWEEN 1 AND 200`),
    check("tasks_description_length", sql`char_length(description) <= 10000`),
    check("tasks_completed_at", sql`(status = 'completed') = (completed_at IS NOT NULL)`),
    check("tasks_assignee_not_super_admin", sql`assignee_is_super_admin = false`),
  ],
);

/** Append-only: progress notes and status changes. */
export const taskUpdates = pgTable(
  "task_updates",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    fromStatus: taskStatus("from_status"),
    toStatus: taskStatus("to_status"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_updates_task_idx").on(t.taskId, t.createdAt),
    check("task_updates_status_pair", sql`(from_status IS NULL) = (to_status IS NULL)`),
    check("task_updates_has_content", sql`note IS NOT NULL OR to_status IS NOT NULL`),
    check("task_updates_note_length", sql`note IS NULL OR char_length(note) BETWEEN 1 AND 5000`),
  ],
);

/** Append-only: proof of work. URLs are stored and returned only; the server never fetches them. */
export const taskProofs = pgTable(
  "task_proofs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    url: text("url"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_proofs_task_idx").on(t.taskId, t.createdAt),
    check("task_proofs_has_content", sql`url IS NOT NULL OR note IS NOT NULL`),
    check(
      "task_proofs_url_https",
      sql`url IS NULL OR (url ~ '^https://[^\\s/?#]+[^\\s]*$' AND char_length(url) <= 2000)`,
    ),
    check("task_proofs_note_length", sql`note IS NULL OR char_length(note) BETWEEN 1 AND 2000`),
  ],
);

/** Append-only: CEO review decisions. */
export const taskReviews = pgTable(
  "task_reviews",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => users.id),
    decision: taskReviewDecision("decision").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_reviews_task_idx").on(t.taskId, t.createdAt),
    check("task_reviews_changes_need_note", sql`decision <> 'changes_requested' OR note IS NOT NULL`),
    check("task_reviews_note_length", sql`note IS NULL OR char_length(note) BETWEEN 1 AND 2000`),
  ],
);
