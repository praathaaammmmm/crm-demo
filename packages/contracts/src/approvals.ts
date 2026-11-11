import { APPROVAL_TYPES, ASSIGNABLE_ROLES } from "@crm/permissions";
import { z } from "zod";
import { nextCursorSchema, paginationQuerySchema } from "./common.js";

const textNote = z.string().trim().min(1).max(500);

export const approvalStatusSchema = z.enum(["pending", "approved", "rejected", "cancelled"]);

export const roleChangePayloadSchema = z.strictObject({ newRole: z.enum(ASSIGNABLE_ROLES) });
export const deactivatePayloadSchema = z.strictObject({});

export const createApprovalRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("user.role_change"),
    targetUserId: z.uuid(),
    payload: roleChangePayloadSchema,
    reason: textNote,
  }),
  z.strictObject({
    type: z.literal("user.deactivate"),
    targetUserId: z.uuid(),
    payload: deactivatePayloadSchema,
    reason: textNote,
  }),
]);
export type CreateApprovalRequest = z.infer<typeof createApprovalRequestSchema>;

export const approveRequestSchema = z.strictObject({ note: textNote.optional() });
export const rejectRequestSchema = z.strictObject({ note: textNote });

export const approvalListQuerySchema = paginationQuerySchema.extend({ status: approvalStatusSchema.optional() });
export type ApprovalListQuery = z.infer<typeof approvalListQuerySchema>;

export const approvalIdParamsSchema = z.strictObject({ id: z.uuid() });

export const approvalSchema = z.strictObject({
  id: z.uuid(),
  type: z.enum(APPROVAL_TYPES),
  targetUserId: z.uuid(),
  payload: z.record(z.string(), z.unknown()),
  reason: z.string(),
  status: approvalStatusSchema,
  requestedBy: z.uuid(),
  requestedAt: z.iso.datetime(),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  decisionNote: z.string().nullable(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const approvalResponseSchema = z.strictObject({ approval: approvalSchema });

export const approvalPageSchema = z.strictObject({
  items: z.array(approvalSchema),
  nextCursor: nextCursorSchema,
});
