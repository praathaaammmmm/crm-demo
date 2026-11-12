export const GROWTH_AUDIT = {
  companyCreated: "growth.company_created",
  companyUpdated: "growth.company_updated",
  companyArchived: "growth.company_archived",
  contactCreated: "growth.contact_created",
  contactUpdated: "growth.contact_updated",
  contactArchived: "growth.contact_archived",
  leadCreated: "growth.lead_created",
  leadUpdated: "growth.lead_updated",
  leadStageChanged: "growth.lead_stage_changed",
  leadReassigned: "growth.lead_reassigned",
  leadReopened: "growth.lead_reopened",
  leadArchived: "growth.lead_archived",
  activityLogged: "growth.activity_logged",
  activityVoided: "growth.activity_voided",
  proposalVersionCreated: "growth.proposal_version_created",
  proposalSubmitted: "growth.proposal_submitted",
  proposalApproved: "growth.proposal_approved",
  proposalRejected: "growth.proposal_rejected",
  proposalSent: "growth.proposal_sent",
  proposalWithdrawn: "growth.proposal_withdrawn",
  proposalAcceptanceRecorded: "growth.proposal_acceptance_recorded",
  proposalConfirmationDecided: "growth.proposal_confirmation_decided",
  leadMarkedWon: "growth.lead_marked_won",
} as const;

/**
 * Allowlisted Growth audit fields (docs/security/audit-policy.md): ids, archive state, do-not-contact and
 * changed-field flags only. Names, emails, phones, links, notes and industry text are never recorded.
 */
export function changedFlags<T extends Record<string, unknown>>(before: T, after: T, keys: readonly (keyof T & string)[]): Record<string, boolean> {
  return Object.fromEntries(keys.map((key) => [`${key}Changed`, before[key] !== after[key]]));
}
