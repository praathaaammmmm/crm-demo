import { z } from "zod";
import { nextCursorSchema, paginationQuerySchema } from "./common.js";

export const createProjectRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(""),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const projectSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  createdAt: z.iso.datetime(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectResponseSchema = z.strictObject({ project: projectSchema });

export const projectListQuerySchema = paginationQuerySchema;

export const projectPageSchema = z.strictObject({
  items: z.array(projectSchema),
  nextCursor: nextCursorSchema,
});

export const projectIdParamsSchema = z.strictObject({ id: z.uuid() });
