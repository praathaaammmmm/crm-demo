export const OPERATIONS_PERMISSIONS = [
  /** Incidents, releases and automations: the CEO/CTO (read-only) and the VP Engineering & Quality. */
  "operations:read_all",
  /** Every Engineering Operations write: the VP Engineering & Quality only (ADR 0012). */
  "operations:manage",
  /** CEO/CTO only: approve or reject production releases and automation go-live (ADR 0012). */
  "operations:approve",
] as const;
