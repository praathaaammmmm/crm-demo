import type { LoggerOptions } from "pino";

/** Values that must never reach logs. Request bodies are not logged at all. */
export const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "*.password",
  "*.currentPassword",
  "*.newPassword",
  "*.initialPassword",
  "*.passwordHash",
  "*.password_hash",
  "*.token",
  "*.tokenHash",
  "*.token_hash",
];

export function loggerOptions(level: string): LoggerOptions {
  return { level, redact: { paths: REDACT_PATHS, censor: "[redacted]" } };
}
