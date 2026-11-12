import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./db.js";
import { createSuperAdmin, createUser, pgErrorCode } from "./helpers.js";

describe("database: marketing", () => {
  let db: TestDatabase;
  let cmoId = "";

  const asMigrator = (statement: SQL) => pgErrorCode(db.migrator.execute(statement));
  const asApp = (statement: SQL) => pgErrorCode(db.app.execute(statement));
  const asWorker = (statement: SQL) => pgErrorCode(db.worker.execute(statement));
  const one = async (text: string, values: unknown[]): Promise<string> => {
    const [row] = await db.query<{ id: string }>(text, values);
    return row?.id ?? "";
  };
  const campaign = () => one("INSERT INTO marketing_campaigns (name, created_by) VALUES ('Camp', $1) RETURNING id", [cmoId]);
  const content = (campaignId: string | null = null) =>
    one("INSERT INTO marketing_content (title, channel, campaign_id, created_by) VALUES ('Post', 'linkedin', $1, $2) RETURNING id", [campaignId, cmoId]);

  beforeAll(async () => {
    db = await createTestDatabase();
    // The hierarchy trigger requires the Super Admin before any other user.
    await createSuperAdmin(db.migrator);
    cmoId = await createUser(db.migrator, { email: "cmo@example.test", name: "CMO", password: "test-cmo-password", role: "cmo" });
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });

  it("grants: crm_app cannot delete, truncate or write protected columns; crm_worker has no access", async () => {
    const id = await content();
    expect(await asApp(sql`DELETE FROM marketing_content WHERE id = ${id}`)).toBe("42501");
    expect(await asApp(sql`TRUNCATE marketing_campaigns`)).toBe("42501");
    expect(await asApp(sql`UPDATE marketing_content SET created_by = ${cmoId} WHERE id = ${id}`)).toBe("42501");
    expect(await asApp(sql`UPDATE marketing_content SET channel = 'youtube' WHERE id = ${id}`)).toBe("42501");
    expect(await asApp(sql`INSERT INTO marketing_content (title, channel, status, created_by) VALUES ('X', 'linkedin', 'published', ${cmoId})`)).toBe("42501");
    for (const table of ["marketing_campaigns", "marketing_content", "marketing_asset_links"]) {
      expect(await asWorker(sql`SELECT 1 FROM ${sql.identifier(table)} LIMIT 1`)).toBe("42501");
    }
  });

  it("status guards: content starts as a draft, follows its pairs, and publishing needs proof and time together", async () => {
    expect(await asMigrator(sql`INSERT INTO marketing_content (title, channel, status, created_by) VALUES ('X', 'linkedin', 'planned', ${cmoId})`)).toBe("23514");
    const id = await content();
    expect(await asMigrator(sql`UPDATE marketing_content SET status = 'published', proof_url = 'https://x.example/p', published_at = now() WHERE id = ${id}`)).toBe("23514");
    expect(await asMigrator(sql`UPDATE marketing_content SET status = 'planned' WHERE id = ${id}`)).toBeNull();
    expect(await asMigrator(sql`UPDATE marketing_content SET status = 'in_review' WHERE id = ${id}`)).toBeNull();
    expect(await asMigrator(sql`UPDATE marketing_content SET status = 'published' WHERE id = ${id}`)).toBe("23514");
    expect(await asMigrator(sql`UPDATE marketing_content SET status = 'published', proof_url = 'http://x.example/p', published_at = now() WHERE id = ${id}`)).toBe("23514");
    expect(await asMigrator(sql`UPDATE marketing_content SET reach = 1 WHERE id = ${id}`)).toBe("23514");
    expect(await asMigrator(sql`UPDATE marketing_content SET status = 'published', proof_url = 'https://x.example/p', published_at = now() WHERE id = ${id}`)).toBeNull();
    expect(await asMigrator(sql`UPDATE marketing_content SET reach = 10, clicks = 2 WHERE id = ${id}`)).toBeNull();
    expect(await asMigrator(sql`UPDATE marketing_content SET title = 'Changed' WHERE id = ${id}`)).toBe("23514");
    expect(await asMigrator(sql`UPDATE marketing_content SET status = 'cancelled', proof_url = NULL, published_at = NULL WHERE id = ${id}`)).toBe("23514");
    const cancelled = await content();
    expect(await asMigrator(sql`UPDATE marketing_content SET status = 'cancelled' WHERE id = ${cancelled}`)).toBeNull();
    expect(await asMigrator(sql`UPDATE marketing_content SET title = 'Revived' WHERE id = ${cancelled}`)).toBe("23514");
  });

  it("finished campaigns are read-only and refuse new or re-linked content", async () => {
    const id = await campaign();
    expect(await asMigrator(sql`UPDATE marketing_campaigns SET status = 'completed' WHERE id = ${id}`)).toBe("23514");
    for (const status of ["planned", "active", "completed"]) {
      expect(await asMigrator(sql`UPDATE marketing_campaigns SET status = ${status}::marketing_campaign_status WHERE id = ${id}`)).toBeNull();
    }
    expect(await asMigrator(sql`UPDATE marketing_campaigns SET name = 'Again' WHERE id = ${id}`)).toBe("23514");
    expect(await asMigrator(sql`INSERT INTO marketing_content (title, channel, campaign_id, created_by) VALUES ('X', 'youtube', ${id}, ${cmoId})`)).toBe("23514");
    const loose = await content();
    expect(await asMigrator(sql`UPDATE marketing_content SET campaign_id = ${id} WHERE id = ${loose}`)).toBe("23514");
    expect(await asMigrator(sql`INSERT INTO marketing_campaigns (name, starts_on, ends_on, created_by) VALUES ('Dates', '2026-02-01', '2026-01-01', ${cmoId})`)).toBe("23514");
  });

  it("asset links are https-only, removable once, and nothing in Marketing can be deleted, even by the owner", async () => {
    const contentId = await content();
    expect(await asMigrator(sql`INSERT INTO marketing_asset_links (content_id, label, url, kind, created_by) VALUES (${contentId}, 'A', 'ftp://x/a', 'image', ${cmoId})`)).toBe("23514");
    const asset = await one("INSERT INTO marketing_asset_links (content_id, label, url, kind, created_by) VALUES ($1, 'A', 'https://x.example/a.png', 'image', $2) RETURNING id", [
      contentId,
      cmoId,
    ]);
    expect(await asMigrator(sql`UPDATE marketing_asset_links SET url = 'https://x.example/b.png' WHERE id = ${asset}`)).toBe("23514");
    expect(await asMigrator(sql`UPDATE marketing_asset_links SET removed_at = now() WHERE id = ${asset}`)).toBe("23514");
    expect(await asMigrator(sql`UPDATE marketing_asset_links SET removed_at = now(), removed_by = ${cmoId} WHERE id = ${asset}`)).toBeNull();
    expect(await asMigrator(sql`UPDATE marketing_asset_links SET removed_at = now(), removed_by = ${cmoId} WHERE id = ${asset}`)).toBe("23514");
    for (const table of ["marketing_asset_links", "marketing_content", "marketing_campaigns"]) {
      expect(await asMigrator(sql`DELETE FROM ${sql.identifier(table)}`)).toBe("23514");
      expect(await asMigrator(sql`TRUNCATE ${sql.identifier(table)} CASCADE`)).toBe("23514");
    }
  });
});
