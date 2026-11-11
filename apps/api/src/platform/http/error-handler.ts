import type { ErrorResponse } from "@crm/contracts/common";
import type { FastifyInstance } from "fastify";
import { AppError } from "../errors.js";

function numericProperty(value: unknown, key: "statusCode"): number | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  const property: unknown = (value as Record<string, unknown>)[key];
  return typeof property === "number" ? property : undefined;
}

function stringProperty(value: unknown, key: "code"): string | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  const property: unknown = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : undefined;
}

/** Maps every error to { code, message }. Internal details are logged by name and code only, never sent. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      const body: ErrorResponse = { code: error.code, message: error.message };
      return reply.code(error.statusCode).send(body);
    }

    const statusCode = numericProperty(error, "statusCode");
    if (statusCode === 429) {
      const body: ErrorResponse = { code: "RATE_LIMITED", message: "Too many requests" };
      return reply.code(429).send(body);
    }
    if (statusCode === 400 || statusCode === 413 || statusCode === 415) {
      const body: ErrorResponse = { code: "VALIDATION_FAILED", message: "Invalid request" };
      return reply.code(400).send(body);
    }

    // Never log the error message: database errors can contain SQL and parameter values.
    request.log.error(
      { errName: error instanceof Error ? error.name : "unknown", errCode: stringProperty(error, "code") },
      "Unhandled error",
    );
    const body: ErrorResponse = { code: "INTERNAL", message: "Internal error" };
    return reply.code(500).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    const body: ErrorResponse = { code: "NOT_FOUND", message: "Not found" };
    return reply.code(404).send(body);
  });
}
