import {
  CONTENT_TRANSITIONS,
  type AssetKind,
  type CampaignStatus,
  type Content,
  type ContentStatus,
  type MarketingChannel,
} from "@crm/contracts/marketing";

export const CHANNEL_LABELS: Record<MarketingChannel, string> = { linkedin: "LinkedIn", instagram: "Instagram", youtube: "YouTube" };

export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  in_review: "In review",
  published: "Published",
  cancelled: "Cancelled",
};

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const ASSET_KIND_LABELS: Record<AssetKind, string> = { image: "Image", video: "Video", document: "Document", design: "Design", other: "Other" };

/** Plain status moves; publishing has its own form because it needs a proof link. */
export const contentMoveTargets = (status: ContentStatus): ContentStatus[] => CONTENT_TRANSITIONS[status].filter((to) => to !== "published");

/** Calendar days in date order, with unscheduled content last. */
export function groupByDate(items: Content[]): { date: string | null; items: Content[] }[] {
  const groups = new Map<string | null, Content[]>();
  for (const item of items) groups.set(item.plannedFor, [...(groups.get(item.plannedFor) ?? []), item]);
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([date, list]) => ({ date, items: list }));
}

export const formatCount = (value: number | null): string => (value === null ? "—" : new Intl.NumberFormat("en-IN").format(value));
