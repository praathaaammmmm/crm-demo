import { sql } from "drizzle-orm";
import { date, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./organization.js";

/** Marketing (migration 0018). Status pairs, published/cancelled finality and add-only asset links are enforced by triggers. */
export const marketingChannel = pgEnum("marketing_channel", ["linkedin", "instagram", "youtube"]);
export const marketingContentStatus = pgEnum("marketing_content_status", ["draft", "planned", "in_review", "published", "cancelled"]);
export const marketingCampaignStatus = pgEnum("marketing_campaign_status", ["draft", "planned", "active", "paused", "completed", "cancelled"]);
export const marketingAssetKind = pgEnum("marketing_asset_kind", ["image", "video", "document", "design", "other"]);

export const marketingCampaigns = pgTable(
  "marketing_campaigns",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    name: text("name").notNull(),
    objective: text("objective"),
    status: marketingCampaignStatus("status").notNull().default("draft"),
    startsOn: date("starts_on", { mode: "string" }),
    endsOn: date("ends_on", { mode: "string" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("marketing_campaigns_status_idx").on(t.status)],
);

export const marketingContent = pgTable(
  "marketing_content",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    campaignId: uuid("campaign_id").references(() => marketingCampaigns.id),
    title: text("title").notNull(),
    channel: marketingChannel("channel").notNull(),
    status: marketingContentStatus("status").notNull().default("draft"),
    plannedFor: date("planned_for", { mode: "string" }),
    brief: text("brief"),
    proofUrl: text("proof_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    reach: integer("reach"),
    engagements: integer("engagements"),
    clicks: integer("clicks"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("marketing_content_campaign_idx").on(t.campaignId),
    index("marketing_content_planned_idx").on(t.plannedFor),
    index("marketing_content_status_idx").on(t.status),
  ],
);

export const marketingAssetLinks = pgTable(
  "marketing_asset_links",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    contentId: uuid("content_id")
      .notNull()
      .references(() => marketingContent.id),
    label: text("label").notNull(),
    url: text("url").notNull(),
    kind: marketingAssetKind("kind").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id),
  },
  (t) => [index("marketing_asset_links_content_idx").on(t.contentId)],
);
