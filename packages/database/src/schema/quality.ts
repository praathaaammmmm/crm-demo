import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./organization.js";
import { projects } from "./projects.js";
import { tasks } from "./tasks.js";

export const qaOutcome = pgEnum("qa_outcome", ["passed", "failed", "blocked"]);
export const defectSeverity = pgEnum("defect_severity", ["critical", "high", "medium", "low"]);
export const defectStatus = pgEnum("defect_status", ["open", "in_progress", "fixed", "verified", "wont_fix"]);
export const releaseReadiness = pgEnum("release_readiness_status", ["not_ready", "at_risk", "ready"]);

/** A QA check on a task. latest_outcome mirrors the newest qa_results row; null until the first result. */
export const qaChecks = pgTable(
  "qa_checks",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    title: text("title").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    latestOutcome: qaOutcome("latest_outcome"),
    latestResultAt: timestamp("latest_result_at", { withTimezone: true }),
  },
  (t) => [
    unique("qa_checks_id_task_unique").on(t.id, t.taskId),
    index("qa_checks_task_idx").on(t.taskId),
    index("qa_checks_latest_outcome_idx").on(t.latestOutcome),
    check("qa_checks_title_length", sql`char_length(title) BETWEEN 1 AND 200`),
    check("qa_checks_latest_pair", sql`(latest_outcome IS NULL) = (latest_result_at IS NULL)`),
  ],
);

/** Append-only: QA results. Evidence URLs are stored and returned only; the server never fetches them. */
export const qaResults = pgTable(
  "qa_results",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    qaCheckId: uuid("qa_check_id")
      .notNull()
      .references(() => qaChecks.id),
    outcome: qaOutcome("outcome").notNull(),
    note: text("note"),
    evidenceUrl: text("evidence_url"),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("qa_results_check_idx").on(t.qaCheckId, t.recordedAt),
    check("qa_results_note_required", sql`outcome = 'passed' OR note IS NOT NULL`),
    check("qa_results_note_length", sql`note IS NULL OR char_length(note) BETWEEN 1 AND 2000`),
    check(
      "qa_results_url_https",
      sql`evidence_url IS NULL OR (evidence_url ~ '^https://[^\\s/?#]+[^\\s]*$' AND char_length(evidence_url) <= 2000)`,
    ),
  ],
);

/** A defect on a task. A linked QA check must belong to the same task (composite foreign key). */
export const defects = pgTable(
  "defects",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    qaCheckId: uuid("qa_check_id"),
    title: text("title").notNull(),
    severity: defectSeverity("severity").notNull(),
    status: defectStatus("status").notNull().default("open"),
    reproductionSteps: text("reproduction_steps").notNull(),
    reportedBy: uuid("reported_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "defects_qa_check_same_task_fk",
      columns: [t.qaCheckId, t.taskId],
      foreignColumns: [qaChecks.id, qaChecks.taskId],
    }),
    index("defects_task_idx").on(t.taskId),
    index("defects_status_severity_idx").on(t.status, t.severity),
    check("defects_title_length", sql`char_length(title) BETWEEN 1 AND 200`),
    check("defects_reproduction_length", sql`char_length(reproduction_steps) BETWEEN 1 AND 10000`),
    check("defects_resolved_at", sql`(status IN ('verified', 'wont_fix')) = (resolved_at IS NOT NULL)`),
  ],
);

/** Append-only: responses, evidence and status changes on a defect. */
export const defectUpdates = pgTable(
  "defect_updates",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    defectId: uuid("defect_id")
      .notNull()
      .references(() => defects.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    note: text("note"),
    evidenceUrl: text("evidence_url"),
    fromStatus: defectStatus("from_status"),
    toStatus: defectStatus("to_status"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("defect_updates_defect_idx").on(t.defectId, t.createdAt),
    check("defect_updates_status_pair", sql`(from_status IS NULL) = (to_status IS NULL)`),
    check("defect_updates_has_content", sql`note IS NOT NULL OR evidence_url IS NOT NULL OR to_status IS NOT NULL`),
    check("defect_updates_note_length", sql`note IS NULL OR char_length(note) BETWEEN 1 AND 5000`),
    check(
      "defect_updates_note_required",
      sql`note IS NOT NULL OR to_status IS NULL OR (to_status NOT IN ('fixed', 'wont_fix') AND NOT (from_status = 'fixed' AND to_status = 'open'))`,
    ),
    check(
      "defect_updates_url_https",
      sql`evidence_url IS NULL OR (evidence_url ~ '^https://[^\\s/?#]+[^\\s]*$' AND char_length(evidence_url) <= 2000)`,
    ),
  ],
);

/** Append-only: release-readiness decisions. The newest row per project is its current readiness. */
export const releaseReadinessDecisions = pgTable(
  "release_readiness",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    label: text("label").notNull(),
    readiness: releaseReadiness("readiness").notNull(),
    note: text("note"),
    decidedBy: uuid("decided_by")
      .notNull()
      .references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("release_readiness_project_idx").on(t.projectId, t.decidedAt.desc(), t.id.desc()),
    check("release_readiness_label_length", sql`char_length(label) BETWEEN 1 AND 100`),
    check("release_readiness_note_length", sql`note IS NULL OR char_length(note) BETWEEN 1 AND 2000`),
    check("release_readiness_note_required", sql`readiness = 'ready' OR note IS NOT NULL`),
  ],
);
