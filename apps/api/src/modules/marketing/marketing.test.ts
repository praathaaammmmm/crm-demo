import {
  assetLinkResponseSchema,
  campaignDetailResponseSchema,
  campaignResponseSchema,
  contentDetailResponseSchema,
  contentPageSchema,
  contentResponseSchema,
  marketingSummarySchema,
  type Campaign,
  type Content,
} from "@crm/contracts/marketing";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/db.js";
import { buildTestApp, call, createSuperAdmin, createUser, dateFromToday, loginToken, SUPER_ADMIN, TEST_ORIGIN } from "../../../test/helpers.js";

const person = (key: string) => ({ email: `${key}@example.test`, name: `Test ${key}`, password: `test-${key}-password` });
const CMO = person("mkt-cmo");
const SECRET = "private-marketing-text-3f9a";
const UNKNOWN_ID = "00000000-0000-7000-8000-000000000000";
/** Every role without marketing:read_all. */
const DENIED = ["cfo", "cgo", "vp_engineering_quality", "founder", "employee", "intern", "contractor"] as const;

describe("marketing", () => {
  let db: TestDatabase;
  let app: FastifyInstance;
  const tokens: Record<string, string> = {};
  const as = (key: string) => tokens[key] ?? "";
  const get = (who: string, url: string) => call(app, { method: "GET", url, token: as(who) });
  const post = (who: string, url: string, payload: object = {}) => call(app, { method: "POST", url, token: as(who), payload });
  const patch = (who: string, url: string, payload: object) =>
    app.inject({ method: "PATCH", url, headers: { origin: TEST_ORIGIN }, cookies: { crm_session: as(who) }, payload });

  const newCampaign = async (extra: object = {}): Promise<Campaign> => {
    const response = await post("cmo", "/api/v1/marketing/campaigns", { name: `Launch ${SECRET}`, objective: SECRET, ...extra });
    expect(response.statusCode).toBe(201);
    return campaignResponseSchema.parse(response.json()).campaign;
  };
  const newContent = async (extra: object = {}): Promise<Content> => {
    const response = await post("cmo", "/api/v1/marketing/content", { title: `Post ${SECRET}`, channel: "linkedin", brief: SECRET, ...extra });
    expect(response.statusCode).toBe(201);
    return contentResponseSchema.parse(response.json()).content;
  };
  const move = (id: string, payload: object) => post("cmo", `/api/v1/marketing/content/${id}/status`, payload);
  const publish = async (id: string) => {
    for (const to of ["planned", "in_review"]) expect((await move(id, { to })).statusCode).toBe(200);
    expect((await move(id, { to: "published", proofUrl: `https://www.linkedin.com/posts/${SECRET}` })).statusCode).toBe(200);
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await createSuperAdmin(db.migrator);
    await createUser(db.migrator, { ...CMO, role: "cmo" });
    for (const role of DENIED) await createUser(db.migrator, { ...person(`mkt-${role}`), role });
    const setup = await buildTestApp(db.app);
    tokens["ceo"] = await loginToken(setup, SUPER_ADMIN.email, SUPER_ADMIN.password);
    tokens["cmo"] = await loginToken(setup, CMO.email, CMO.password);
    for (const role of DENIED) tokens[role] = await loginToken(setup, person(`mkt-${role}`).email, person(`mkt-${role}`).password);
    await setup.close();
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });
  beforeEach(async () => {
    app = await buildTestApp(db.app);
  });
  afterEach(async () => {
    await (app as FastifyInstance | undefined)?.close();
  });

  it("the CMO manages, the CEO/CTO only reads, and every other role is refused", async () => {
    const campaign = await newCampaign();
    const content = await newContent({ campaignId: campaign.id });
    expect((await call(app, { method: "GET", url: "/api/v1/marketing/summary" })).statusCode).toBe(401);
    for (const url of ["/api/v1/marketing/summary", "/api/v1/marketing/campaigns", `/api/v1/marketing/campaigns/${campaign.id}`, `/api/v1/marketing/content/${content.id}`]) {
      expect((await get("ceo", url)).statusCode).toBe(200);
      for (const role of DENIED) expect((await get(role, url)).statusCode).toBe(403);
    }
    for (const who of ["ceo", ...DENIED]) {
      expect((await post(who, "/api/v1/marketing/campaigns", { name: "X" })).statusCode).toBe(403);
      expect((await post(who, "/api/v1/marketing/content", { title: "X", channel: "youtube" })).statusCode).toBe(403);
      expect((await post(who, `/api/v1/marketing/campaigns/${campaign.id}/status`, { to: "planned" })).statusCode).toBe(403);
      expect((await patch(who, `/api/v1/marketing/content/${content.id}`, { title: "Y" })).statusCode).toBe(403);
    }
    expect((await get("cfo", "/api/v1/marketing/campaigns/not-a-uuid")).statusCode).toBe(403);
    expect((await get("cmo", "/api/v1/marketing/campaigns/not-a-uuid")).statusCode).toBe(404);
    expect((await get("cmo", `/api/v1/marketing/content/${UNKNOWN_ID}`)).statusCode).toBe(404);
  });

  it("campaigns follow their lifecycle; finished campaigns are read-only and refuse new content", async () => {
    const campaign = await newCampaign({ startsOn: dateFromToday(0), endsOn: dateFromToday(30) });
    expect(campaign).toMatchObject({ status: "draft", contentCount: 0 });
    expect((await post("cmo", "/api/v1/marketing/campaigns", { name: "Bad", startsOn: dateFromToday(5), endsOn: dateFromToday(1) })).statusCode).toBe(400);
    expect((await patch("cmo", `/api/v1/marketing/campaigns/${campaign.id}`, { endsOn: dateFromToday(-1) })).statusCode).toBe(400);
    const status = (to: string) => post("cmo", `/api/v1/marketing/campaigns/${campaign.id}/status`, { to });
    expect((await status("active")).statusCode).toBe(409);
    for (const to of ["planned", "active", "paused", "active", "completed"]) expect((await status(to)).statusCode).toBe(200);
    expect((await status("active")).statusCode).toBe(409);
    expect((await patch("cmo", `/api/v1/marketing/campaigns/${campaign.id}`, { name: "Renamed" })).statusCode).toBe(409);
    expect((await post("cmo", "/api/v1/marketing/content", { title: "Late", channel: "instagram", campaignId: campaign.id })).statusCode).toBe(409);
    const loose = await newContent();
    expect((await patch("cmo", `/api/v1/marketing/content/${loose.id}`, { campaignId: campaign.id })).statusCode).toBe(409);
  });

  it("content moves through review to published with a proof link; published keeps only outcomes editable", async () => {
    const content = await newContent({ channel: "youtube", plannedFor: dateFromToday(-1) });
    expect(content).toMatchObject({ status: "draft", overdue: true, proofUrl: null });
    expect((await move(content.id, { to: "published", proofUrl: "https://youtube.com/watch?v=1" })).statusCode).toBe(409);
    expect((await move(content.id, { to: "planned" })).statusCode).toBe(200);
    expect((await move(content.id, { to: "in_review" })).statusCode).toBe(200);
    expect((await move(content.id, { to: "published" })).statusCode).toBe(400);
    expect((await move(content.id, { to: "published", proofUrl: "http://youtube.com/watch?v=1" })).statusCode).toBe(400);
    expect((await post("cmo", `/api/v1/marketing/content/${content.id}/outcome`, { reach: 5 })).statusCode).toBe(409);
    const published = await move(content.id, { to: "published", proofUrl: "https://youtube.com/watch?v=1" });
    expect(contentResponseSchema.parse(published.json()).content).toMatchObject({ status: "published", overdue: false, proofUrl: "https://youtube.com/watch?v=1" });
    expect((await patch("cmo", `/api/v1/marketing/content/${content.id}`, { title: "Changed" })).statusCode).toBe(409);
    expect((await move(content.id, { to: "cancelled" })).statusCode).toBe(409);
    const outcome = await post("cmo", `/api/v1/marketing/content/${content.id}/outcome`, { reach: 1200, engagements: 80, clicks: 15 });
    expect(contentResponseSchema.parse(outcome.json()).content).toMatchObject({ reach: 1200, engagements: 80, clicks: 15 });
    expect((await post("cmo", `/api/v1/marketing/content/${content.id}/outcome`, { reach: -1 })).statusCode).toBe(400);
  });

  it("asset links are https metadata that can be removed once; cancelled content takes no new links", async () => {
    const content = await newContent();
    expect((await post("cmo", `/api/v1/marketing/content/${content.id}/assets`, { label: "Hero", url: "http://cdn.example.com/a.png", kind: "image" })).statusCode).toBe(400);
    const added = await post("cmo", `/api/v1/marketing/content/${content.id}/assets`, { label: "Hero", url: "https://cdn.example.com/a.png", kind: "image" });
    expect(added.statusCode).toBe(201);
    const asset = assetLinkResponseSchema.parse(added.json()).asset;
    expect((await post("ceo", `/api/v1/marketing/assets/${asset.id}/remove`)).statusCode).toBe(403);
    expect((await post("cmo", `/api/v1/marketing/assets/${asset.id}/remove`)).statusCode).toBe(200);
    expect((await post("cmo", `/api/v1/marketing/assets/${asset.id}/remove`)).statusCode).toBe(409);
    const detail = contentDetailResponseSchema.parse((await get("ceo", `/api/v1/marketing/content/${content.id}`)).json());
    expect(detail.assets).toHaveLength(1);
    expect(detail.assets[0]?.removedAt).not.toBeNull();
    expect((await move(content.id, { to: "cancelled" })).statusCode).toBe(200);
    expect((await post("cmo", `/api/v1/marketing/content/${content.id}/assets`, { label: "Late", url: "https://cdn.example.com/b.png", kind: "image" })).statusCode).toBe(409);
  });

  it("reports campaign outcomes and the dashboard from internal records only", async () => {
    const campaign = await newCampaign();
    const onTime = await newContent({ campaignId: campaign.id, channel: "linkedin", plannedFor: dateFromToday(0) });
    const late = await newContent({ campaignId: campaign.id, channel: "instagram", plannedFor: dateFromToday(-2) });
    await newContent({ campaignId: campaign.id, channel: "youtube", plannedFor: dateFromToday(3) });
    await publish(onTime.id);
    await publish(late.id);
    await post("cmo", `/api/v1/marketing/content/${onTime.id}/outcome`, { reach: 100, clicks: 4 });
    const detail = campaignDetailResponseSchema.parse((await get("ceo", `/api/v1/marketing/campaigns/${campaign.id}`)).json());
    expect(detail.campaign.contentCount).toBe(3);
    expect(detail.outcome.publishedOnTime).toBe(1);
    expect(detail.outcome.publishedLate).toBe(1);
    expect(detail.outcome.contentByStatus.find((row) => row.status === "published")?.count).toBe(2);
    expect(detail.outcome.byChannel.find((row) => row.channel === "linkedin")).toEqual({ channel: "linkedin", published: 1, reach: 100, engagements: 0, clicks: 4 });

    const summary = marketingSummarySchema.parse((await get("cmo", "/api/v1/marketing/summary")).json());
    expect(summary.today).toBe(dateFromToday(0));
    expect(summary.upcoming).toBeGreaterThanOrEqual(1);
    expect(summary.last30Days.find((row) => row.channel === "linkedin")?.published).toBeGreaterThanOrEqual(1);
    const calendar = contentPageSchema.parse((await get("cmo", `/api/v1/marketing/content?from=${dateFromToday(0)}&to=${dateFromToday(7)}&campaignId=${campaign.id}`)).json());
    expect(calendar.items).toHaveLength(2);
    expect((await get("cmo", `/api/v1/marketing/content?from=${dateFromToday(2)}&to=${dateFromToday(1)}`)).statusCode).toBe(400);
  });

  it("audits every mutation without names, briefs, objectives, labels or links", async () => {
    const campaign = await newCampaign();
    const content = await newContent({ campaignId: campaign.id });
    await patch("cmo", `/api/v1/marketing/campaigns/${campaign.id}`, { objective: `${SECRET} again` });
    await patch("cmo", `/api/v1/marketing/content/${content.id}`, { brief: `${SECRET} brief` });
    await post("cmo", `/api/v1/marketing/content/${content.id}/assets`, { label: `Label ${SECRET}`, url: `https://cdn.example.com/${SECRET}.png`, kind: "design" });
    await publish(content.id);
    const events = await db.query<{ action: string; before: unknown; after: unknown }>(
      "SELECT action, before, after FROM audit_events WHERE action LIKE 'marketing.%' AND (entity_id = $1 OR entity_id = $2 OR after->>'contentId' = $2::text)",
      [campaign.id, content.id],
    );
    expect(new Set(events.map((e) => e.action))).toEqual(
      new Set([
        "marketing.campaign_created",
        "marketing.campaign_updated",
        "marketing.content_created",
        "marketing.content_updated",
        "marketing.asset_added",
        "marketing.content_status_changed",
      ]),
    );
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });
});
