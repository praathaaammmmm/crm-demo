import { ASSIGNABLE_ROLES, ROLES } from "@crm/permissions";
import { z } from "zod";
import { nextCursorSchema, paginationQuerySchema } from "./common.js";

export const userStatusSchema = z.enum(["active", "deactivated"]);

/** No manager field: every user reports to the CEO/CTO, set by the database (ADR 0005). */
export const createUserRequestSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  name: z.string().trim().min(1).max(200),
  role: z.enum(ASSIGNABLE_ROLES),
  initialPassword: z.string().min(12).max(128),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const userIdParamsSchema = z.strictObject({ id: z.uuid() });

/**
 * CEO only. Sets a new temporary password (the user must change it at next sign-in), ends every session,
 * clears any lockout and, if the user was deactivated, restores access. Nothing is deleted.
 */
export const resetAccessRequestSchema = z.strictObject({
  temporaryPassword: z.string().min(12).max(128),
});
export type ResetAccessRequest = z.infer<typeof resetAccessRequestSchema>;

/** Explicit allowlist: never add password_hash or any credential field. */
export const userResponseSchema = z.strictObject({
  user: z.strictObject({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
    role: z.enum(ROLES),
    status: userStatusSchema,
    mustChangePassword: z.boolean(),
    createdAt: z.iso.datetime(),
  }),
});
export type UserResponse = z.infer<typeof userResponseSchema>;

export const directoryQuerySchema = paginationQuerySchema;

/** `email` is present only for callers with users:read_email. */
export const directoryItemSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  role: z.enum(ROLES),
  status: userStatusSchema,
  email: z.string().optional(),
});

export const directoryPageSchema = z.strictObject({
  items: z.array(directoryItemSchema),
  nextCursor: nextCursorSchema,
});
export type DirectoryPage = z.infer<typeof directoryPageSchema>;
