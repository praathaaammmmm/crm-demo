import type { ErrorCode } from "@crm/contracts/common";

/** An expected failure with a safe, client-facing message. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const errors = {
  validation: (message = "Invalid request") => new AppError("VALIDATION_FAILED", 400, message),
  unauthenticated: (message = "Authentication required") => new AppError("UNAUTHENTICATED", 401, message),
  forbidden: (message = "Forbidden") => new AppError("FORBIDDEN", 403, message),
  conflict: (message: string) => new AppError("CONFLICT", 409, message),
  notFound: () => new AppError("NOT_FOUND", 404, "Not found"),
  passwordChangeRequired: () =>
    new AppError("PASSWORD_CHANGE_REQUIRED", 403, "You must change your password before continuing"),
};

/**
 * True if the error (or one it wraps, as Drizzle does) is a PostgreSQL unique violation (23505)
 * on the named constraint or index.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const fields = current as Error & { code?: unknown; constraint?: unknown };
    if (fields.code === "23505" && fields.constraint === constraint) return true;
    current = current.cause;
  }
  return false;
}
