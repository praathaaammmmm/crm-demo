export const MARKETING_AUDIT = {
  campaignCreated: "marketing.campaign_created",
  campaignUpdated: "marketing.campaign_updated",
  campaignStatusChanged: "marketing.campaign_status_changed",
  contentCreated: "marketing.content_created",
  contentUpdated: "marketing.content_updated",
  contentStatusChanged: "marketing.content_status_changed",
  contentOutcomeRecorded: "marketing.content_outcome_recorded",
  assetAdded: "marketing.asset_added",
  assetRemoved: "marketing.asset_removed",
} as const;

/**
 * Allowlisted audit fields (docs/security/audit-policy.md): ids, statuses, channels, dates, counts and
 * changed-field flags only. Names, titles, objectives, briefs, labels and links are never recorded.
 */
export function changedFlags<T extends Record<string, unknown>>(before: T, after: T, keys: readonly (keyof T & string)[]): Record<string, boolean> {
  return Object.fromEntries(keys.map((key) => [`${key}Changed`, before[key] !== after[key]]));
}
