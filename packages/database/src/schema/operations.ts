import { sql } from "drizzle-orm";
import { boolean, date, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./organization.js";

/**
 * Engineering Operations (migration 0020). Status pairs, release approval order and checklist completeness are
 * enforced by triggers; incident updates, release decisions, automation changes and runs are append-only.
 */
export const opsIncidentSeverity = pgEnum("ops_incident_severity", ["sev1", "sev2", "sev3", "sev4"]);
export const opsIncidentStatus = pgEnum("ops_incident_status", ["open", "investigating", "mitigated", "resolved"]);
export const opsIncidentEntryKind = pgEnum("ops_incident_entry_kind", ["note", "status"]);
export const opsReleaseEnvironment = pgEnum("ops_release_environment", ["staging", "production"]);
export const opsReleaseStatus = pgEnum("ops_release_status", ["draft", "awaiting_approval", "approved", "rejected", "deployed", "failed", "rolled_back"]);
export const opsAutomationStatus = pgEnum("ops_automation_status", ["draft", "testing", "awaiting_approval", "live", "paused", "retired"]);
export const opsRunOutcome = pgEnum("ops_run_outcome", ["succeeded", "failed"]);

const createdBy = () =>
  uuid("created_by")
    .notNull()
    .references(() => users.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const opsIncidents = pgTable(
  "ops_incidents",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    title: text("title").notNull(),
    severity: opsIncidentSeverity("severity").notNull(),
    status: opsIncidentStatus("status").notNull().default("open"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    summary: text("summary"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"),
    postIncidentNote: text("post_incident_note"),
    createdBy: createdBy(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ops_incidents_status_idx").on(t.status, t.severity)],
);

export const opsIncidentUpdates = pgTable(
  "ops_incident_updates",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => opsIncidents.id),
    kind: opsIncidentEntryKind("kind").notNull(),
    fromStatus: opsIncidentStatus("from_status"),
    toStatus: opsIncidentStatus("to_status"),
    note: text("note"),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("ops_incident_updates_incident_idx").on(t.incidentId, t.createdAt)],
);

export const opsReleases = pgTable(
  "ops_releases",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    name: text("name").notNull(),
    versionLabel: text("version_label").notNull(),
    environment: opsReleaseEnvironment("environment").notNull(),
    status: opsReleaseStatus("status").notNull().default("draft"),
    plannedFor: date("planned_for", { mode: "string" }),
    notes: text("notes"),
    createdBy: createdBy(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ops_releases_status_idx").on(t.status)],
);

export const opsReleaseChecklistItems = pgTable(
  "ops_release_checklist_items",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => opsReleases.id),
    label: text("label").notNull(),
    done: boolean("done").notNull().default(false),
    doneBy: uuid("done_by").references(() => users.id),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdBy: createdBy(),
    createdAt: createdAt(),
  },
  (t) => [index("ops_release_checklist_items_release_idx").on(t.releaseId)],
);

export const opsReleaseDecisions = pgTable(
  "ops_release_decisions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => opsReleases.id),
    fromStatus: opsReleaseStatus("from_status").notNull(),
    toStatus: opsReleaseStatus("to_status").notNull(),
    note: text("note"),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("ops_release_decisions_release_idx").on(t.releaseId, t.createdAt)],
);

export const opsAutomations = pgTable(
  "ops_automations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    name: text("name").notNull(),
    purpose: text("purpose").notNull(),
    triggerDescription: text("trigger_description").notNull(),
    status: opsAutomationStatus("status").notNull().default("draft"),
    createdBy: createdBy(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ops_automations_status_idx").on(t.status)],
);

export const opsAutomationChanges = pgTable(
  "ops_automation_changes",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => opsAutomations.id),
    fromStatus: opsAutomationStatus("from_status").notNull(),
    toStatus: opsAutomationStatus("to_status").notNull(),
    note: text("note"),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("ops_automation_changes_automation_idx").on(t.automationId, t.createdAt)],
);

export const opsAutomationRuns = pgTable(
  "ops_automation_runs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => opsAutomations.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    outcome: opsRunOutcome("outcome").notNull(),
    errorSummary: text("error_summary"),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("ops_automation_runs_automation_idx").on(t.automationId, t.finishedAt.desc())],
);
