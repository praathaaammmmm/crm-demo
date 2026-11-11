import type { z } from "zod";
import { errors } from "../errors.js";

/** Validates untrusted input. Error details are not returned, so submitted values are never echoed. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw errors.validation();
  return result.data;
}

/**
 * Validates an outgoing body against its strict response contract.
 * Any field not in the contract throws, so unlisted fields can never reach a client.
 */
export function toResponse<S extends z.ZodType>(schema: S, data: z.input<S>): z.output<S> {
  return schema.parse(data);
}
