import { z } from "zod";
import { nextCursorSchema, paginationQuerySchema } from "./common.js";
import { MAX_VALUE_MINOR } from "./growth-leads.js";

export const PROPOSAL_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "sent",
  "acceptance_pending",
  "accepted",
  "acceptance_refused",
  "withdrawn",
  "superseded",
  "won",
] as const;
export const ACCEPTANCE_METHODS = ["signed_document", "email_confirmation", "written_message", "verbal"] as const;
export const CONFIRMATION_DECISIONS = ["confirmed", "refused"] as const;

export const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export const acceptanceMethodSchema = z.enum(ACCEPTANCE_METHODS);
export const confirmationDecisionSchema = z.enum(CONFIRMATION_DECISIONS);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
export type AcceptanceMethod = z.infer<typeof acceptanceMethodSchema>;
export type ConfirmationDecision = z.infer<typeof confirmationDecisionSchema>;

/** A new version may be created when there is no proposal yet or the current version is in one of these. */
export const NEW_VERSION_FROM = ["draft", "rejected", "withdrawn", "acceptance_refused"] as const satisfies readonly ProposalStatus[];
/** While the proposal is in one of these, the lead cannot be marked lost or archived (withdraw first). */
export const ACTIVE_STATUSES = ["draft", "pending_approval", "approved", "sent", "acceptance_pending", "accepted"] as const satisfies readonly ProposalStatus[];
/** Statuses the CGO can withdraw from (note required). */
export const WITHDRAWABLE = ACTIVE_STATUSES;

/** Transitions the API performs directly, and who performs them. Every other transition is internal (trigger-made). */
export const USER_TRANSITIONS = {
  submit: { from: ["draft"], to: "pending_approval", by: "cgo" },
  approve: { from: ["pending_approval"], to: "approved", by: "ceo" },
  reject: { from: ["pending_approval"], to: "rejected", by: "ceo" },
  send: { from: ["approved"], to: "sent", by: "cgo" },
  withdraw: { from: WITHDRAWABLE, to: "withdrawn", by: "cgo" },
} as const satisfies Record<string, { from: readonly ProposalStatus[]; to: ProposalStatus; by: "cgo" | "ceo" }>;
export type UserTransition = keyof typeof USER_TRANSITIONS;

const includes = (list: readonly string[], value: string) => list.includes(value);

export const canTransition = (action: UserTransition, status: ProposalStatus | null): boolean =>
  status !== null && includes(USER_TRANSITIONS[action].from, status);
export const canCreateVersion = (status: ProposalStatus | null): boolean => status === null || includes(NEW_VERSION_FROM, status);
export const isActiveProposal = (status: ProposalStatus | null): boolean => status !== null && includes(ACTIVE_STATUSES, status);

/** Late when the client accepted after validity, or the acceptance is recorded after the validity date. */
export const isLate = (validUntil: string, acceptedOn: string, recordedOn: string): boolean => acceptedOn > validUntil || recordedOn > validUntil;
/** Verbal or late acceptances need CEO confirmation before the lead can be won. */
export const needsConfirmation = (method: AcceptanceMethod, late: boolean): boolean => method === "verbal" || late;

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: "Draft",
  pending_approval: "Awaiting CEO approval",
  approved: "Approved",
  rejected: "Rejected",
  sent: "Sent",
  acceptance_pending: "Awaiting CEO confirmation",
  accepted: "Accepted",
  acceptance_refused: "Acceptance refused",
  withdrawn: "Withdrawn",
  superseded: "Superseded",
  won: "Won",
};

const isoDate = z.iso.date();
const httpsUrl = z.url({ protocol: /^https$/ }).max(2000);
const note = (max: number) => z.string().transform((value) => value.trim()).pipe(z.string().min(1).max(max));
const versionNo = z.int().min(1);

// Requests. Bodies never carry a proposal id, lead id or owner: they come from the route and the server.

export const createVersionRequestSchema = z.strictObject({
  documentUrl: httpsUrl,
  amountMinor: z.int().min(0).max(MAX_VALUE_MINOR),
  validUntil: isoDate,
  summary: note(2000),
  /** null for the first version; otherwise the current version number (optimistic check). */
  expectedVersionNo: versionNo.nullable(),
});
export type CreateVersionRequest = z.infer<typeof createVersionRequestSchema>;

export const versionActionRequestSchema = z.strictObject({ versionNo, note: note(1000).optional() });
export const versionNoteRequestSchema = z.strictObject({ versionNo, note: note(1000) });
export type VersionActionRequest = z.infer<typeof versionActionRequestSchema>;
/** CEO confirmation may carry an optional decision note; refusal must state its reason. */
export const confirmationRequestSchema = versionActionRequestSchema;
export const refusalRequestSchema = versionNoteRequestSchema;

export const acceptanceRequestSchema = z
  .strictObject({
    versionNo,
    method: acceptanceMethodSchema,
    acceptedOn: isoDate,
    evidenceUrl: httpsUrl.optional(),
    note: note(1000).optional(),
  })
  .refine((value) => value.method === "verbal" || value.evidenceUrl !== undefined, {
    message: "This confirmation method needs an https evidence link",
    path: ["evidenceUrl"],
  })
  .refine((value) => value.method !== "verbal" || value.note !== undefined, {
    message: "A verbal acceptance needs a note",
    path: ["note"],
  });
export type AcceptanceRequest = z.infer<typeof acceptanceRequestSchema>;

export const markWonRequestSchema = z.strictObject({ versionNo });
export type MarkWonRequest = z.infer<typeof markWonRequestSchema>;

export const proposalListQuerySchema = paginationQuerySchema.extend({
  status: proposalStatusSchema.optional(),
  leadId: z.uuid().optional(),
});
export type ProposalListQuery = z.infer<typeof proposalListQuerySchema>;

// Responses

export const proposalSchema = z.strictObject({
  id: z.uuid(),
  leadId: z.uuid(),
  leadName: z.string(),
  ownerId: z.uuid(),
  status: proposalStatusSchema,
  currentVersionId: z.uuid(),
  currentVersionNo: versionNo,
  amountMinor: z.int().nonnegative(),
  currency: z.literal("INR"),
  validUntil: isoDate,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Proposal = z.infer<typeof proposalSchema>;

export const proposalVersionSchema = z.strictObject({
  id: z.uuid(),
  versionNo,
  status: proposalStatusSchema,
  documentUrl: z.string(),
  amountMinor: z.int().nonnegative(),
  currency: z.literal("INR"),
  validUntil: isoDate,
  summary: z.string(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type ProposalVersion = z.infer<typeof proposalVersionSchema>;

export const proposalEventSchema = z.strictObject({
  id: z.uuid(),
  seq: z.int().min(1),
  versionNo,
  fromStatus: proposalStatusSchema.nullable(),
  toStatus: proposalStatusSchema,
  actorId: z.uuid(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ProposalEvent = z.infer<typeof proposalEventSchema>;

export const acceptanceSchema = z.strictObject({
  id: z.uuid(),
  versionNo,
  method: acceptanceMethodSchema,
  evidenceUrl: z.string().nullable(),
  note: z.string().nullable(),
  acceptedOn: isoDate,
  late: z.boolean(),
  needsConfirmation: z.boolean(),
  recordedBy: z.uuid(),
  recordedAt: z.iso.datetime(),
  confirmation: z
    .strictObject({ decision: confirmationDecisionSchema, note: z.string().nullable(), actorId: z.uuid(), createdAt: z.iso.datetime() })
    .nullable(),
});
export type Acceptance = z.infer<typeof acceptanceSchema>;

export const proposalDetailSchema = z.strictObject({
  proposal: proposalSchema.nullable(),
  versions: z.array(proposalVersionSchema),
  events: z.array(proposalEventSchema),
  acceptances: z.array(acceptanceSchema),
});
export type ProposalDetail = z.infer<typeof proposalDetailSchema>;
export const proposalResponseSchema = z.strictObject({ proposal: proposalSchema });
export const proposalPageSchema = z.strictObject({ items: z.array(proposalSchema), nextCursor: nextCursorSchema });
