export const MARKETING_PERMISSIONS = [
  /** Campaigns, content, asset links and outcome reports: the CEO/CTO (read-only) and the CMO. */
  "marketing:read_all",
  /** Every Marketing write: the CMO only (ADR 0011). */
  "marketing:manage",
] as const;
