import { describe, expect, it } from "vitest";
import {
  addAssetLinkRequestSchema,
  campaignAcceptsContent,
  canMoveCampaign,
  canMoveContent,
  CAMPAIGN_STATUSES,
  CONTENT_STATUSES,
  contentOutcomeRequestSchema,
  contentStatusRequestSchema,
  createCampaignRequestSchema,
  createContentRequestSchema,
} from "./marketing.js";

describe("marketing workflow", () => {
  it("content moves draft → planned → in_review → published; published and cancelled are final", () => {
    expect(canMoveContent("draft", "planned")).toBe(true);
    expect(canMoveContent("planned", "in_review")).toBe(true);
    expect(canMoveContent("in_review", "published")).toBe(true);
    expect(canMoveContent("in_review", "planned")).toBe(true);
    expect(canMoveContent("draft", "published")).toBe(false);
    expect(canMoveContent("planned", "published")).toBe(false);
    for (const to of CONTENT_STATUSES) {
      expect(canMoveContent("published", to)).toBe(false);
      expect(canMoveContent("cancelled", to)).toBe(false);
    }
    for (const from of ["draft", "planned", "in_review"] as const) expect(canMoveContent(from, "cancelled")).toBe(true);
  });

  it("campaigns move draft → planned → active ⇄ paused → completed; completed and cancelled are final", () => {
    expect(canMoveCampaign("draft", "planned")).toBe(true);
    expect(canMoveCampaign("planned", "active")).toBe(true);
    expect(canMoveCampaign("active", "paused")).toBe(true);
    expect(canMoveCampaign("paused", "active")).toBe(true);
    expect(canMoveCampaign("active", "completed")).toBe(true);
    expect(canMoveCampaign("draft", "active")).toBe(false);
    expect(canMoveCampaign("draft", "completed")).toBe(false);
    for (const to of CAMPAIGN_STATUSES) {
      expect(canMoveCampaign("completed", to)).toBe(false);
      expect(canMoveCampaign("cancelled", to)).toBe(false);
    }
    expect(campaignAcceptsContent("active")).toBe(true);
    expect(campaignAcceptsContent("completed")).toBe(false);
    expect(campaignAcceptsContent("cancelled")).toBe(false);
  });

  it("validates requests: normalised names, date order, https links, publish proof and outcome bounds", () => {
    expect(createCampaignRequestSchema.parse({ name: "  Launch   Q1 " }).name).toBe("Launch Q1");
    expect(createCampaignRequestSchema.safeParse({ name: "X", startsOn: "2026-02-01", endsOn: "2026-01-31" }).success).toBe(false);
    expect(createContentRequestSchema.safeParse({ title: "Post", channel: "tiktok" }).success).toBe(false);
    expect(createContentRequestSchema.safeParse({ title: "Post", channel: "youtube", extra: 1 }).success).toBe(false);
    expect(contentStatusRequestSchema.safeParse({ to: "published" }).success).toBe(false);
    expect(contentStatusRequestSchema.safeParse({ to: "published", proofUrl: "http://example.com/p" }).success).toBe(false);
    expect(contentStatusRequestSchema.safeParse({ to: "published", proofUrl: "https://example.com/p" }).success).toBe(true);
    expect(contentStatusRequestSchema.safeParse({ to: "planned", proofUrl: "https://example.com/p" }).success).toBe(false);
    expect(contentOutcomeRequestSchema.safeParse({}).success).toBe(false);
    expect(contentOutcomeRequestSchema.safeParse({ reach: -1 }).success).toBe(false);
    expect(contentOutcomeRequestSchema.safeParse({ reach: 10, clicks: 2 }).success).toBe(true);
    expect(addAssetLinkRequestSchema.safeParse({ label: "Hero", url: "javascript:alert(1)", kind: "image" }).success).toBe(false);
    expect(addAssetLinkRequestSchema.safeParse({ label: "Hero", url: "https://cdn.example.com/a.png", kind: "image" }).success).toBe(true);
  });
});
