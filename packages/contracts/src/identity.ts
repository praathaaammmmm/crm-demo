import { ROLES } from "@crm/permissions";
import { z } from "zod";

export const loginRequestSchema = z.strictObject({
  email: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Explicit allowlist: never add password_hash, token_hash or any credential field. */
export const sessionUserSchema = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  isSuperAdmin: z.boolean(),
});

/** Response of POST /api/v1/auth/login and GET /api/v1/auth/me. */
export const sessionResponseSchema = z.strictObject({
  user: sessionUserSchema,
  mustChangePassword: z.boolean(),
  sessionExpiresAt: z.iso.datetime(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const changePasswordRequestSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(12).max(128),
  })
  .refine((value) => value.currentPassword !== value.newPassword, { path: ["newPassword"] });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
