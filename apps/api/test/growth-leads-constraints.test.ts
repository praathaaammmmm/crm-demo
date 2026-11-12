import { ACTIVITY_DIRECTIONS, ACTIVITY_KINDS, ACTIVITY_OUTCOMES, GROWTH_STAGES, LEAD_PRIORITIES, LEAD_SOURCES, LOST_REASONS } from "@crm/contracts/growth-leads";
import type { Tx } from "../src/platform/context.js";
import {
  growthActivityDirection,
  growthActivityKind,
  growthActivityOutcome,
  growthLeadSource,
  growthLostReason,
  growthPriority,
  growthStage,
} from "@crm/database/schema";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./db.js";
import { createSuperAdmin, createUser, pgErrorCode } from "./helpers.js";

describe("database: growth leads, stage history and activities", () => {
  let db: TestDatabase;
  let cgoId = "";
  let employeeId = "";
  let companyId = "";
  let otherCompanyId = "";
  let contactId = "";
  let otherContactId = "";

  const run = (statement: SQL) => pgErrorCode(db.migrator.execute(statement));
  const one = async <T extends object>(text: string, values: unknown[] = []): Promise<T> => {
    const [row] = await db.query<T>(text, values);
    if (!row) throw new Error("no row");
    return row;
  };
  const newLead = async (company: string | null = null): Promise<string> =>
    (await one<{ id: string }>("INSERT INTO growth_leads (name, source, owner_id, created_by, company_id) VALUES ('Lead', 'referral', $1, $1, $2) RETURNING id", [cgoId, company])).id;
  const newContact = async (company: string, email: string): Promise<string> =>
    (await one<{ id: string }>("INSERT INTO growth_contacts (company_id, full_name, email, owner_id) VALUES ($1, 'C', $2, $3) RETURNING id", [company, email, cgoId])).id;
  const leadState = (id: string) => one<{ stage: string; stage_revision: number; history: number }>(
    "SELECT stage, stage_revision, (SELECT count(*)::int FROM growth_stage_changes WHERE lead_id = $1) AS history FROM growth_leads WHERE id = $1",
    [id],
  );

  /** One transition inside a transaction: stage update, then (optionally) its matching history row. */
  async function step(tx: Tx, leadId: string, from: string, to: string, withHistory = true): Promise<number> {
    const lost = to === "lost";
    const result = await tx.execute<{ stage_revision: number }>(sql`
      UPDATE growth_leads SET stage = ${to}::growth_stage,
        lost_reason = ${lost ? "price" : null}::growth_lost_reason, lost_note = ${lost ? "Too costly" : null},
        lost_at = ${lost ? sql`now()` : sql`NULL`}
      WHERE id = ${leadId} RETURNING stage_revision`);
    const revision = result.rows[0]?.stage_revision ?? -1;
    if (withHistory) {
      await tx.execute(sql`
        INSERT INTO growth_stage_changes (lead_id, from_stage, to_stage, actor_id, note, lost_reason, stage_revision)
        VALUES (${leadId}, ${from}::growth_stage, ${to}::growth_stage, ${cgoId},
                ${lost || from === "lost" ? "Because" : null}, ${lost ? "price" : null}::growth_lost_reason, ${revision})`);
    }
    return revision;
  }

  const activity = (fields: { lead?: string | null; company?: string | null; contact?: string | null; direction: string; kind?: string; occurred?: SQL }) =>
    run(sql`INSERT INTO growth_activities (lead_id, company_id, contact_id, kind, direction, occurred_at, summary, author_id)
            VALUES (${fields.lead ?? null}, ${fields.company ?? null}, ${fields.contact ?? null}, ${fields.kind ?? "email"}::growth_activity_kind,
                    ${fields.direction}::growth_activity_direction, ${fields.occurred ?? sql`now()`}, 'Summary', ${cgoId})`);

  beforeAll(async () => {
    db = await createTestDatabase();
    await createSuperAdmin(db.migrator);
    cgoId = await createUser(db.migrator, { email: "cgo@example.test", name: "CGO", password: "test-cgo-password", role: "cgo" });
    employeeId = await createUser(db.migrator, { email: "e@example.test", name: "E", password: "test-e-password", role: "employee" });
    companyId = (await one<{ id: string }>("INSERT INTO growth_companies (name, owner_id, created_by) VALUES ('Alpha', $1, $1) RETURNING id", [cgoId])).id;
    otherCompanyId = (await one<{ id: string }>("INSERT INTO growth_companies (name, owner_id, created_by) VALUES ('Beta', $1, $1) RETURNING id", [cgoId])).id;
    contactId = await newContact(companyId, "a@example.test");
    otherContactId = await newContact(otherCompanyId, "b@example.test");
  });
  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });

  it("contract enums match the database enums", () => {
    expect([...GROWTH_STAGES]).toEqual(growthStage.enumValues);
    expect([...LEAD_SOURCES]).toEqual(growthLeadSource.enumValues);
    expect([...LEAD_PRIORITIES]).toEqual(growthPriority.enumValues);
    expect([...LOST_REASONS]).toEqual(growthLostReason.enumValues);
    expect([...ACTIVITY_KINDS]).toEqual(growthActivityKind.enumValues);
    expect([...ACTIVITY_DIRECTIONS]).toEqual(growthActivityDirection.enumValues);
    expect([...ACTIVITY_OUTCOMES]).toEqual(growthActivityOutcome.enumValues);
  });

  it("lead checks: normalised name, INR value range, contact belongs to company, won blocked", async () => {
    const insert = (extra: SQL) => run(sql`INSERT INTO growth_leads (name, source, owner_id, created_by ${extra})`);
    expect(await insert(sql`) VALUES (' Pad', 'referral', ${cgoId}, ${cgoId}`)).toBe("23514");
    expect(await insert(sql`, estimated_value_minor) VALUES ('V', 'referral', ${cgoId}, ${cgoId}, -1`)).toBe("23514");
    expect(await insert(sql`, estimated_value_minor) VALUES ('V', 'referral', ${cgoId}, ${cgoId}, 100000000001`)).toBe("23514");
    expect(await insert(sql`, currency) VALUES ('C', 'referral', ${cgoId}, ${cgoId}, 'USD'`)).toBe("23514");
    expect(await insert(sql`, primary_contact_id) VALUES ('P', 'referral', ${cgoId}, ${cgoId}, ${contactId}`)).toBe("23514");
    expect(await insert(sql`, company_id, primary_contact_id) VALUES ('P', 'referral', ${cgoId}, ${cgoId}, ${otherCompanyId}, ${contactId}`)).toBe("23503");
    expect(await insert(sql`) VALUES ('E', 'referral', ${employeeId}, ${cgoId}`)).toBe("23514");
    const lead = await newLead();
    expect(await run(sql`UPDATE growth_leads SET owner_id = ${employeeId} WHERE id = ${lead}`)).toBe("23514");
    expect(await pgErrorCode(db.migrator.transaction((tx) => step(tx, lead, "new", "won")))).toBe("23514");
  });

  it("link, lost and archive guards", async () => {
    const archivedCompany = (await one<{ id: string }>("INSERT INTO growth_companies (name, owner_id, created_by) VALUES ('Gone', $1, $1) RETURNING id", [cgoId])).id;
    await db.query("UPDATE growth_companies SET archived_at = now() WHERE id = $1", [archivedCompany]);
    expect(await run(sql`INSERT INTO growth_leads (name, source, owner_id, created_by, company_id) VALUES ('A', 'referral', ${cgoId}, ${cgoId}, ${archivedCompany})`)).toBe("23514");

    const lost = await newLead();
    await db.migrator.transaction((tx) => step(tx, lost, "new", "lost"));
    expect(await run(sql`UPDATE growth_leads SET priority = 'high' WHERE id = ${lost}`)).toBe("23514");
    expect(await run(sql`UPDATE growth_leads SET version = version + 1, updated_at = now() WHERE id = ${lost}`)).toBeNull();

    const archived = await newLead();
    expect(await run(sql`UPDATE growth_leads SET archived_at = now() WHERE id = ${archived}`)).toBeNull();
    expect(await run(sql`UPDATE growth_leads SET priority = 'high' WHERE id = ${archived}`)).toBe("23514");
    expect(await run(sql`UPDATE growth_leads SET archived_at = NULL WHERE id = ${archived}`)).toBe("23514");
  });

  it("stage revisions: start at 0 in new, +1 per stage change, never changed alone", async () => {
    expect(await run(sql`INSERT INTO growth_leads (name, source, owner_id, created_by, stage) VALUES ('S', 'referral', ${cgoId}, ${cgoId}, 'contacted')`)).toBe("23514");
    const supplied = (await one<{ id: string; stage_revision: number }>(
      "INSERT INTO growth_leads (name, source, owner_id, created_by, stage_revision) VALUES ('R', 'referral', $1, $1, 7) RETURNING id, stage_revision",
      [cgoId],
    ));
    expect(supplied.stage_revision).toBe(0);
    expect(await run(sql`UPDATE growth_leads SET stage_revision = 5 WHERE id = ${supplied.id}`)).toBe("23514");
    const revision = await db.migrator.transaction(async (tx) => {
      const result = await tx.execute<{ stage_revision: number }>(
        sql`UPDATE growth_leads SET stage = 'contacted', stage_revision = 9 WHERE id = ${supplied.id} RETURNING stage_revision`,
      );
      const rev = result.rows[0]?.stage_revision ?? -1;
      await tx.execute(sql`INSERT INTO growth_stage_changes (lead_id, from_stage, to_stage, actor_id, stage_revision) VALUES (${supplied.id}, 'new', 'contacted', ${cgoId}, ${rev})`);
      return rev;
    });
    expect(revision).toBe(1);
  });

  it("new → contacted → new → contacted → new in one transaction with four history rows commits", async () => {
    const lead = await newLead();
    await db.migrator.transaction(async (tx) => {
      expect(await step(tx, lead, "new", "contacted")).toBe(1);
      expect(await step(tx, lead, "contacted", "new")).toBe(2);
      expect(await step(tx, lead, "new", "contacted")).toBe(3);
      expect(await step(tx, lead, "contacted", "new")).toBe(4);
    });
    expect(await leadState(lead)).toEqual({ stage: "new", stage_revision: 4, history: 4 });
  });

  it.each([1, 2, 3, 4])("missing history for revision %i fails at commit and leaves the lead unchanged", async (missing) => {
    const lead = await newLead();
    const sequence: [string, string][] = [
      ["new", "contacted"],
      ["contacted", "new"],
      ["new", "contacted"],
      ["contacted", "new"],
    ];
    const code = await pgErrorCode(
      db.migrator.transaction(async (tx) => {
        for (const [index, [from, to]] of sequence.entries()) await step(tx, lead, from, to, index + 1 !== missing);
      }),
    );
    expect(code).toBe("23514");
    expect(await leadState(lead)).toEqual({ stage: "new", stage_revision: 0, history: 0 });
  });

  it("history rows must match the current revision and stage; duplicates are refused", async () => {
    const lead = await newLead();
    const mismatch = await pgErrorCode(
      db.migrator.transaction(async (tx) => {
        await tx.execute(sql`UPDATE growth_leads SET stage = 'contacted' WHERE id = ${lead}`);
        await tx.execute(sql`INSERT INTO growth_stage_changes (lead_id, from_stage, to_stage, actor_id, stage_revision) VALUES (${lead}, 'new', 'qualified', ${cgoId}, 1)`);
      }),
    );
    expect(mismatch).toBe("23514");
    const ahead = await pgErrorCode(
      db.migrator.transaction(async (tx) => {
        await tx.execute(sql`UPDATE growth_leads SET stage = 'contacted' WHERE id = ${lead}`);
        await tx.execute(sql`INSERT INTO growth_stage_changes (lead_id, from_stage, to_stage, actor_id, stage_revision) VALUES (${lead}, 'new', 'contacted', ${cgoId}, 2)`);
      }),
    );
    expect(ahead).toBe("23514");
    const duplicate = await pgErrorCode(
      db.migrator.transaction(async (tx) => {
        await step(tx, lead, "new", "contacted");
        await tx.execute(sql`INSERT INTO growth_stage_changes (lead_id, from_stage, to_stage, actor_id, stage_revision) VALUES (${lead}, 'new', 'contacted', ${cgoId}, 1)`);
      }),
    );
    expect(duplicate).toBe("23505");
  });

  it("valid lost and reopen transitions commit; history is append-only for every role", async () => {
    const lead = await newLead();
    await db.migrator.transaction(async (tx) => {
      await step(tx, lead, "new", "contacted");
      await step(tx, lead, "contacted", "qualified");
      await step(tx, lead, "qualified", "lost");
      await step(tx, lead, "lost", "proposal");
    });
    expect(await leadState(lead)).toEqual({ stage: "proposal", stage_revision: 4, history: 4 });
    expect(await run(sql`UPDATE growth_stage_changes SET note = 'x' WHERE lead_id = ${lead}`)).toBe("23514");
    expect(await run(sql`DELETE FROM growth_stage_changes WHERE lead_id = ${lead}`)).toBe("23514");
    expect(await run(sql`TRUNCATE growth_stage_changes`)).toBe("23514");
  });

  it("activities: every outbound needs a contact; inbound other may have none", async () => {
    for (const kind of ACTIVITY_KINDS) expect(await activity({ company: companyId, direction: "outbound", kind })).toBe("23514");
    expect(await activity({ company: companyId, direction: "inbound", kind: "other" })).toBeNull();
  });

  it("activities: linked companies must agree, company_id is derived, leads without a company are inbound-only", async () => {
    const lead = await newLead(companyId);
    expect(await activity({ lead, company: otherCompanyId, direction: "inbound" })).toBe("23514");
    expect(await activity({ company: companyId, contact: otherContactId, direction: "outbound" })).toBe("23514");
    expect(await activity({ lead, contact: otherContactId, direction: "outbound" })).toBe("23514");
    const derived = await one<{ company_id: string }>(
      `INSERT INTO growth_activities (lead_id, contact_id, kind, direction, occurred_at, summary, author_id)
       VALUES ($1, $2, 'email', 'outbound', now(), 'S', $3) RETURNING company_id`,
      [lead, contactId, cgoId],
    );
    expect(derived.company_id).toBe(companyId);
    const fromContact = await one<{ company_id: string }>(
      "INSERT INTO growth_activities (contact_id, kind, direction, occurred_at, summary, author_id) VALUES ($1, 'call', 'outbound', now(), 'S', $2) RETURNING company_id",
      [contactId, cgoId],
    );
    expect(fromContact.company_id).toBe(companyId);

    const loose = await newLead(null);
    expect(await activity({ lead: loose, direction: "inbound" })).toBeNull();
    expect(await activity({ lead: loose, contact: contactId, direction: "inbound" })).toBe("23514");
    expect(await activity({ lead: loose, company: companyId, direction: "inbound" })).toBe("23514");
    expect(await activity({ lead: loose, contact: contactId, direction: "outbound" })).toBe("23514");
  });

  it("activities: do-not-contact blocks outbound only; archived links and bad times are refused", async () => {
    const dnc = await newContact(companyId, "dnc@example.test");
    await db.query("UPDATE growth_contacts SET do_not_contact = true WHERE id = $1", [dnc]);
    expect(await activity({ contact: dnc, direction: "outbound" })).toBe("23514");
    expect(await activity({ contact: dnc, direction: "inbound" })).toBeNull();
    const gone = await newContact(companyId, "gone@example.test");
    await db.query("UPDATE growth_contacts SET archived_at = now() WHERE id = $1", [gone]);
    expect(await activity({ contact: gone, direction: "inbound" })).toBe("23514");
    expect(await activity({ company: companyId, direction: "inbound", occurred: sql`now() + interval '10 minutes'` })).toBe("23514");
    expect(await activity({ company: companyId, direction: "inbound", occurred: sql`now() - interval '400 days'` })).toBe("23514");
  });

  it("activities: void once only; never edited, deleted or truncated", async () => {
    const id = (await one<{ id: string }>(
      "INSERT INTO growth_activities (company_id, kind, direction, occurred_at, summary, author_id) VALUES ($1, 'email', 'inbound', now(), 'S', $2) RETURNING id",
      [companyId, cgoId],
    )).id;
    expect(await run(sql`UPDATE growth_activities SET summary = 'Changed' WHERE id = ${id}`)).toBe("23514");
    expect(await run(sql`UPDATE growth_activities SET voided_at = now(), voided_by = ${cgoId}, void_reason = 'Dup' WHERE id = ${id}`)).toBeNull();
    expect(await run(sql`UPDATE growth_activities SET voided_at = NULL, voided_by = NULL, void_reason = NULL WHERE id = ${id}`)).toBe("23514");
    expect(await run(sql`UPDATE growth_activities SET void_reason = 'Again' WHERE id = ${id}`)).toBe("23514");
    expect(await run(sql`DELETE FROM growth_activities WHERE id = ${id}`)).toBe("23514");
    expect(await run(sql`TRUNCATE growth_activities`)).toBe("23514");
  });

  it("an outbound insert waits for a concurrent do-not-contact change and is then refused", async () => {
    const target = await newContact(companyId, "race@example.test");
    let release: () => void = () => undefined;
    let markLocked: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const isLocked = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    const changer = db.migrator.transaction(async (tx) => {
      await tx.execute(sql`UPDATE growth_contacts SET do_not_contact = true WHERE id = ${target}`);
      markLocked();
      await held;
    });
    await isLocked;
    const insert = activity({ contact: target, direction: "outbound" });
    release();
    await changer;
    expect(await insert).toBe("23514");
  });
});
