import { z } from "zod";

export const errorCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "PASSWORD_CHANGE_REQUIRED",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL",
  "DEMO_READ_ONLY",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** Cursor pagination: the cursor is opaque to clients (docs/api/conventions.md). */
export const paginationQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const nextCursorSchema = z.uuid().nullable();
