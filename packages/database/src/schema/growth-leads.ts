import { sql } from "drizzle-orm";
import { bigint, boolean, char, check, date, foreignKey, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { growthCompanies, growthContacts } from "./growth.js";
import { users } from "./organization.js";

export const growthStage = pgEnum("growth_stage", ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"]);
export const growthLeadSource = pgEnum("growth_lead_source", [
  "linkedin",
  "referral",
  "inbound_email",
  "website",
  "event",
  "cold_outreach",
  "partner",
  "other",
]);
export const growthPriority = pgEnum("growth_priority", ["low", "medium", "high"]);
export const growthLostReason = pgEnum("growth_lost_reason", ["no_budget", "chose_competitor", "no_response", "not_a_fit", "timing", "price", "other"]);
export const growthActivityKind = pgEnum("growth_activity_kind", ["linkedin_dm", "email", "call", "meeting", "follow_up", "other"]);
export const growthActivityDirection = pgEnum("growth_activity_direction", ["outbound", "inbound"]);
export const growthActivityOutcome = pgEnum("growth_activity_outcome", ["no_response", "replied", "positive", "negative", "meeting_booked"]);

/**
 * One lead moving through the pipeline (migration 0014). Every stage change bumps stage_revision (trigger)
 * and needs a matching growth_stage_changes row in the same transaction (deferred constraint trigger).
 */
export const growthLeads = pgTable(
  "growth_leads",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    name: text("name").notNull(),
    companyId: uuid("company_id").references(() => growthCompanies.id),
    primaryContactId: uuid("primary_contact_id"),
    source: growthLeadSource("source").notNull(),
    sourceDetail: text("source_detail"),
    ownerId: uuid("owner_id").notNull(),
    ownerIsSuperAdmin: boolean("owner_is_super_admin").notNull().default(false),
    stage: growthStage("stage").notNull().default("new"),
    stageRevision: integer("stage_revision").notNull().default(0),
    priority: growthPriority("priority").notNull().default("medium"),
    estimatedValueMinor: bigint("estimated_value_minor", { mode: "number" }),
    currency: char("currency", { length: 3 }).notNull().default("INR"),
    expectedCloseOn: date("expected_close_on", { mode: "string" }),
    nextFollowUpOn: date("next_follow_up_on", { mode: "string" }),
    lostReason: growthLostReason("lost_reason"),
    lostNote: text("lost_note"),
    lostAt: timestamp("lost_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Set together, only by the mark-won transition (migration 0016 triggers); the composite FK is in SQL. */
    wonAt: timestamp("won_at", { withTimezone: true }),
    wonVersionId: uuid("won_version_id"),
    wonAmountMinor: bigint("won_amount_minor", { mode: "number" }),
    wonCurrency: char("won_currency", { length: 3 }),
  },
  (t) => [
    foreignKey({ name: "growth_leads_owner_fk", columns: [t.ownerId, t.ownerIsSuperAdmin], foreignColumns: [users.id, users.isSuperAdmin] }),
    foreignKey({ name: "growth_leads_contact_company_fk", columns: [t.primaryContactId, t.companyId], foreignColumns: [growthContacts.id, growthContacts.companyId] }),
    index("growth_leads_owner_stage_idx").on(t.ownerId, t.stage),
    index("growth_leads_follow_up_idx").on(t.stage, t.nextFollowUpOn).where(sql`archived_at IS NULL`),
    index("growth_leads_company_idx").on(t.companyId),
    index("growth_leads_source_idx").on(t.source),
    index("growth_leads_archived_idx").on(t.archivedAt),
    check("growth_leads_name_normalized", sql`name = regexp_replace(btrim(name), '\\s+', ' ', 'g') AND char_length(name) BETWEEN 1 AND 200`),
    check("growth_leads_source_detail", sql`source_detail IS NULL OR (source_detail = btrim(source_detail) AND char_length(source_detail) BETWEEN 1 AND 200)`),
    check("growth_leads_owner_not_super_admin", sql`owner_is_super_admin = false`),
    check("growth_leads_value", sql`estimated_value_minor IS NULL OR estimated_value_minor BETWEEN 0 AND 100000000000`),
    check("growth_leads_currency_inr", sql`currency = 'INR'`),
    check(
      "growth_leads_lost_fields",
      sql`(stage = 'lost') = (lost_reason IS NOT NULL) AND (stage = 'lost') = (lost_note IS NOT NULL) AND (stage = 'lost') = (lost_at IS NOT NULL)`,
    ),
    check("growth_leads_lost_note", sql`lost_note IS NULL OR (lost_note = btrim(lost_note) AND char_length(lost_note) BETWEEN 1 AND 1000)`),
    check(
      "growth_leads_won_fields",
      sql`CASE WHEN stage = 'won' THEN won_at IS NOT NULL AND won_version_id IS NOT NULL AND won_amount_minor IS NOT NULL AND won_currency IS NOT NULL AND won_currency = 'INR' ELSE won_at IS NULL AND won_version_id IS NULL AND won_amount_minor IS NULL AND won_currency IS NULL END`,
    ),
    index("growth_leads_won_idx").on(t.wonAt, t.id).where(sql`stage = 'won'`),
    check("growth_leads_contact_needs_company", sql`primary_contact_id IS NULL OR company_id IS NOT NULL`),
    check("growth_leads_version_positive", sql`version >= 1`),
    check("growth_leads_stage_revision_nonnegative", sql`stage_revision >= 0`),
  ],
);

/** Append-only for every role (triggers). One row per stage transition, keyed by (lead_id, stage_revision). */
export const growthStageChanges = pgTable(
  "growth_stage_changes",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => growthLeads.id),
    fromStage: growthStage("from_stage").notNull(),
    toStage: growthStage("to_stage").notNull(),
    stageRevision: integer("stage_revision").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    note: text("note"),
    lostReason: growthLostReason("lost_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("growth_stage_changes_lead_revision_unique").on(t.leadId, t.stageRevision),
    index("growth_stage_changes_lead_idx").on(t.leadId, t.createdAt),
    check("growth_stage_changes_different", sql`from_stage <> to_stage`),
    check("growth_stage_changes_revision_positive", sql`stage_revision >= 1`),
    check("growth_stage_changes_lost_needs_reason", sql`to_stage <> 'lost' OR (lost_reason IS NOT NULL AND note IS NOT NULL)`),
    check("growth_stage_changes_reopen_needs_note", sql`from_stage <> 'lost' OR note IS NOT NULL`),
    check("growth_stage_changes_note", sql`note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 1 AND 1000)`),
  ],
);

/** Append-only outreach log; only the void fields may be set, once (trigger). */
export const growthActivities = pgTable(
  "growth_activities",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    leadId: uuid("lead_id").references(() => growthLeads.id),
    companyId: uuid("company_id").references(() => growthCompanies.id),
    contactId: uuid("contact_id").references(() => growthContacts.id),
    kind: growthActivityKind("kind").notNull(),
    direction: growthActivityDirection("direction").notNull(),
    outcome: growthActivityOutcome("outcome"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    summary: text("summary").notNull(),
    proofUrl: text("proof_url"),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
  },
  (t) => [
    index("growth_activities_lead_idx").on(t.leadId, t.occurredAt.desc()),
    index("growth_activities_company_idx").on(t.companyId, t.occurredAt.desc()),
    index("growth_activities_contact_idx").on(t.contactId, t.occurredAt.desc()),
    index("growth_activities_author_idx").on(t.authorId, t.occurredAt),
    check("growth_activities_has_link", sql`num_nonnulls(lead_id, company_id, contact_id) >= 1`),
    check("growth_activities_outbound_contact", sql`direction = 'inbound' OR contact_id IS NOT NULL`),
    check(
      "growth_activities_occurred_window",
      sql`occurred_at <= created_at + interval '5 minutes' AND occurred_at >= created_at - interval '365 days'`,
    ),
    check("growth_activities_summary", sql`summary = btrim(summary) AND char_length(summary) BETWEEN 1 AND 2000`),
    check("growth_activities_proof_https", sql`proof_url IS NULL OR (proof_url ~ '^https://[^\\s/?#]+[^\\s]*$' AND char_length(proof_url) <= 2000)`),
    check("growth_activities_void_fields", sql`(voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL)`),
    check("growth_activities_void_reason", sql`void_reason IS NULL OR (void_reason = btrim(void_reason) AND char_length(void_reason) BETWEEN 1 AND 500)`),
  ],
);
