export const GROWTH_PERMISSIONS = [
  "growth:read_all",
  "growth:read_contacts",
  "growth:manage",
  /** CEO/CTO only: change a lead's owner (Phase 4A.2). */
  "growth:reassign",
  /** CEO/CTO only: reopen a lost lead (Phase 4A.2). */
  "growth:reopen",
  /** CEO/CTO only: approve or reject proposal versions and confirm or refuse acceptances (Phase 4A.3). */
  "growth:approve_proposals",
] as const;
