import { z } from "zod";
import { nextCursorSchema, paginationQuerySchema } from "./common.js";
import { normalizeName } from "./growth.js";

export const GROWTH_STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"] as const;
export const OPEN_STAGES = ["new", "contacted", "qualified", "proposal", "negotiation"] as const;
export const LEAD_SOURCES = ["linkedin", "referral", "inbound_email", "website", "event", "cold_outreach", "partner", "other"] as const;
export const LEAD_PRIORITIES = ["low", "medium", "high"] as const;
export const LOST_REASONS = ["no_budget", "chose_competitor", "no_response", "not_a_fit", "timing", "price", "other"] as const;
export const ACTIVITY_KINDS = ["linkedin_dm", "email", "call", "meeting", "follow_up", "other"] as const;
export const ACTIVITY_DIRECTIONS = ["outbound", "inbound"] as const;
export const ACTIVITY_OUTCOMES = ["no_response", "replied", "positive", "negative", "meeting_booked"] as const;

export const growthStageSchema = z.enum(GROWTH_STAGES);
export const openStageSchema = z.enum(OPEN_STAGES);
export const leadSourceSchema = z.enum(LEAD_SOURCES);
export const leadPrioritySchema = z.enum(LEAD_PRIORITIES);
export const lostReasonSchema = z.enum(LOST_REASONS);
export const activityKindSchema = z.enum(ACTIVITY_KINDS);
export const activityDirectionSchema = z.enum(ACTIVITY_DIRECTIONS);
export const activityOutcomeSchema = z.enum(ACTIVITY_OUTCOMES);

export type GrowthStage = z.infer<typeof growthStageSchema>;
export type OpenStage = z.infer<typeof openStageSchema>;
export type LostReason = z.infer<typeof lostReasonSchema>;

/** Highest estimated value: ₹1,000,000,000 (10^11 paise). */
export const MAX_VALUE_MINOR = 100_000_000_000;

/**
 * The single source of Growth stage rules (ADR 0008). Won is reached only through an accepted proposal (4A.3);
 * lost is final for the CGO and only the CEO/CTO can reopen it to an open stage.
 */
export const GROWTH_STAGE_WORKFLOW = {
  labels: {
    new: "New",
    contacted: "Contacted",
    qualified: "Qualified",
    proposal: "Proposal",
    negotiation: "Negotiation",
    won: "Won",
    lost: "Lost",
  } satisfies Record<GrowthStage, string>,
  open: OPEN_STAGES,
  /** Won only through an accepted proposal version (slice 4A.3), never through a stage move. */
  wonAllowed: "via_proposal",
} as const;

export const isOpenStage = (stage: GrowthStage): stage is OpenStage => (OPEN_STAGES as readonly string[]).includes(stage);
export const stageLabel = (stage: GrowthStage): string => GROWTH_STAGE_WORKFLOW.labels[stage];

/** CGO moves: between different open stages, or from an open stage to lost. Never to won: that is the proposal mark-won action. */
export function canMoveStage(from: GrowthStage, to: GrowthStage): boolean {
  if (from === to || !isOpenStage(from)) return false;
  return isOpenStage(to) || to === "lost";
}

/** CEO reopen: only from lost, to an open stage. */
export const canReopen = (from: GrowthStage, to: GrowthStage): boolean => from === "lost" && isOpenStage(to);

/** Overdue from the day after the follow-up date, for open leads only. Dates are "YYYY-MM-DD" in the org time zone. */
export function isOverdue(lead: { stage: GrowthStage; nextFollowUpOn: string | null; archivedAt: string | null }, today: string): boolean {
  return lead.archivedAt === null && isOpenStage(lead.stage) && lead.nextFollowUpOn !== null && lead.nextFollowUpOn < today;
}

/** Outbound activity always needs a contact; activity without a contact must be inbound. */
export const directionAllowed = (direction: "outbound" | "inbound", hasContact: boolean): boolean => direction === "inbound" || hasContact;

/** "₹12,34,567" from paise, rounded down to whole rupees. */
export const formatInr = (minor: number): string =>
  `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.floor(minor / 100))}`;

const leadName = z.string().transform(normalizeName).pipe(z.string().min(1).max(200));
const optionalTrimmed = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(max))
    .transform((value) => (value.length === 0 ? null : value));
const isoDate = z.iso.date();
const valueMinor = z.int().min(0).max(MAX_VALUE_MINOR);
const note = (max: number) => z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(max));
const httpsUrl = z.url({ protocol: /^https$/ }).max(2000);

// Leads

export const createLeadRequestSchema = z.strictObject({
  name: leadName,
  companyId: z.uuid().optional(),
  primaryContactId: z.uuid().optional(),
  source: leadSourceSchema,
  sourceDetail: optionalTrimmed(200).optional(),
  priority: leadPrioritySchema.default("medium"),
  estimatedValueMinor: valueMinor.nullable().optional(),
  expectedCloseOn: isoDate.nullable().optional(),
  nextFollowUpOn: isoDate.nullable().optional(),
}).refine((value) => value.primaryContactId === undefined || value.companyId !== undefined, {
  message: "A primary contact needs its company",
  path: ["companyId"],
});
export type CreateLeadRequest = z.infer<typeof createLeadRequestSchema>;

/** Field edits only; stage, owner and lost details have their own endpoints. `null` clears an optional field. */
export const updateLeadRequestSchema = z
  .strictObject({
    name: leadName.optional(),
    companyId: z.uuid().nullable().optional(),
    primaryContactId: z.uuid().nullable().optional(),
    source: leadSourceSchema.optional(),
    sourceDetail: optionalTrimmed(200).optional(),
    priority: leadPrioritySchema.optional(),
    estimatedValueMinor: valueMinor.nullable().optional(),
    expectedCloseOn: isoDate.nullable().optional(),
    nextFollowUpOn: isoDate.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), { message: "Nothing to update" });
export type UpdateLeadRequest = z.infer<typeof updateLeadRequestSchema>;

export const stageMoveRequestSchema = z
  .strictObject({ to: growthStageSchema, note: note(1000).optional(), lostReason: lostReasonSchema.optional() })
  .refine((value) => value.to !== "lost" || (value.lostReason !== undefined && value.note !== undefined), {
    message: "Marking a lead lost needs a reason and a note",
    path: ["lostReason"],
  });
export type StageMoveRequest = z.infer<typeof stageMoveRequestSchema>;

export const reopenRequestSchema = z.strictObject({ to: openStageSchema, note: note(1000) });
export type ReopenRequest = z.infer<typeof reopenRequestSchema>;

export const reassignRequestSchema = z.strictObject({ ownerId: z.uuid() });
export type ReassignRequest = z.infer<typeof reassignRequestSchema>;

export const leadListQuerySchema = paginationQuerySchema.extend({
  stage: growthStageSchema.optional(),
  owner: z.uuid().optional(),
  source: leadSourceSchema.optional(),
  overdue: z.enum(["true", "false"]).optional(),
  /** Open, non-archived leads with no touch for more than GROWTH_STALE_DAYS days (growth-reports.ts). */
  stale: z.enum(["true", "false"]).optional(),
  archived: z.enum(["true", "false"]).optional(),
  companyId: z.uuid().optional(),
});
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

export const leadSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  companyId: z.uuid().nullable(),
  primaryContactId: z.uuid().nullable(),
  source: leadSourceSchema,
  sourceDetail: z.string().nullable(),
  ownerId: z.uuid(),
  ownerFlagged: z.boolean(),
  stage: growthStageSchema,
  stageRevision: z.int().nonnegative(),
  priority: leadPrioritySchema,
  estimatedValueMinor: z.int().nonnegative().nullable(),
  currency: z.literal("INR"),
  expectedCloseOn: isoDate.nullable(),
  nextFollowUpOn: isoDate.nullable(),
  overdue: z.boolean(),
  lostReason: lostReasonSchema.nullable(),
  lostNote: z.string().nullable(),
  lostAt: z.iso.datetime().nullable(),
  version: z.int().min(1),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
  wonAt: z.iso.datetime().nullable(),
  wonVersionId: z.uuid().nullable(),
  wonAmountMinor: z.int().nonnegative().nullable(),
  wonCurrency: z.literal("INR").nullable(),
});
export type Lead = z.infer<typeof leadSchema>;

export const stageChangeSchema = z.strictObject({
  id: z.uuid(),
  fromStage: growthStageSchema,
  toStage: growthStageSchema,
  stageRevision: z.int().min(1),
  actorId: z.uuid(),
  note: z.string().nullable(),
  lostReason: lostReasonSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type StageChange = z.infer<typeof stageChangeSchema>;

export const leadResponseSchema = z.strictObject({ lead: leadSchema });
export const leadDetailResponseSchema = z.strictObject({ lead: leadSchema, history: z.array(stageChangeSchema) });
export type LeadDetail = z.infer<typeof leadDetailResponseSchema>;
export const leadPageSchema = z.strictObject({ items: z.array(leadSchema), nextCursor: nextCursorSchema });

// Activities

export const logActivityRequestSchema = z
  .strictObject({
    leadId: z.uuid().optional(),
    companyId: z.uuid().optional(),
    contactId: z.uuid().optional(),
    kind: activityKindSchema,
    direction: activityDirectionSchema,
    outcome: activityOutcomeSchema.optional(),
    occurredAt: z.iso.datetime(),
    summary: note(2000),
    proofUrl: httpsUrl.optional(),
    nextFollowUpOn: isoDate.nullable().optional(),
  })
  .refine((value) => value.leadId !== undefined || value.companyId !== undefined || value.contactId !== undefined, {
    message: "Link the activity to a lead, company or contact",
    path: ["leadId"],
  })
  .refine((value) => directionAllowed(value.direction, value.contactId !== undefined), {
    message: "Outbound activity needs a contact",
    path: ["contactId"],
  })
  .refine((value) => value.nextFollowUpOn === undefined || value.leadId !== undefined, {
    message: "A follow-up date needs a lead",
    path: ["nextFollowUpOn"],
  });
export type LogActivityRequest = z.infer<typeof logActivityRequestSchema>;

export const voidActivityRequestSchema = z.strictObject({ reason: note(500) });

export const activitySchema = z.strictObject({
  id: z.uuid(),
  leadId: z.uuid().nullable(),
  companyId: z.uuid().nullable(),
  contactId: z.uuid().nullable(),
  kind: activityKindSchema,
  direction: activityDirectionSchema,
  outcome: activityOutcomeSchema.nullable(),
  occurredAt: z.iso.datetime(),
  summary: z.string(),
  proofUrl: z.string().nullable(),
  authorId: z.uuid(),
  createdAt: z.iso.datetime(),
  voidedAt: z.iso.datetime().nullable(),
  voidedBy: z.uuid().nullable(),
  voidReason: z.string().nullable(),
});
export type Activity = z.infer<typeof activitySchema>;

export const activityResponseSchema = z.strictObject({ activity: activitySchema });
export const activityPageSchema = z.strictObject({ items: z.array(activitySchema), nextCursor: nextCursorSchema });
export const activityListQuerySchema = paginationQuerySchema.extend({ includeVoided: z.enum(["true", "false"]).optional() });
export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;
