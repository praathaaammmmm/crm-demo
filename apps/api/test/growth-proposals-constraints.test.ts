import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./db.js";
import { createSuperAdmin, createUser, pgErrorCode } from "./helpers.js";

describe("database: growth proposal cache, versions and events", () => {
  let db: TestDatabase;
  let cgoId = "";
  let ceoId = "";
  let leadNumber = 0;

  const run = (statement: SQL) => pgErrorCode(db.migrator.execute(statement));
  const nextLead = async (): Promise<string> => {
    leadNumber += 1;
    const rows = await db.query<{ id: string }>(
      "INSERT INTO growth_leads (name, source, owner_id, created_by) VALUES ($1, 'referral', $2, $2) RETURNING id",
      [`Proposal constraint ${String(leadNumber)}`, cgoId],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("Lead insert returned no id");
    return id;
  };
  const uuidv7 = async (): Promise<string> => {
    const rows = await db.query<{ id: string }>("SELECT uuidv7()::text AS id");
    const id = rows[0]?.id;
    if (!id) throw new Error("uuidv7 returned no id");
    return id;
  };
  const insertVersion = async (leadId: string, suppliedProposalId?: string): Promise<{ proposalId: string; versionId: string }> => {
    const proposalId = suppliedProposalId ?? (await uuidv7());
    const result = await db.migrator.execute<{ id: string }>(sql`
      INSERT INTO growth_proposal_versions (proposal_id, lead_id, document_url, amount_minor, valid_until, summary, created_by)
      VALUES (${proposalId}, ${leadId}, 'https://example.test/proposal.pdf', 500000, current_date + 30, 'Proposal scope', ${cgoId})
      RETURNING id
    `);
    const versionId = result.rows[0]?.id;
    if (!versionId) throw new Error("Version insert returned no id");
    return { proposalId, versionId };
  };
  const current = async (proposalId: string) => {
    const rows = await db.query<{
      status: string;
      current_version_id: string;
      current_version_no: number;
      event_seq: number;
      event_version_id: string;
      event_status: string;
    }>(
      `SELECT p.status, p.current_version_id, p.current_version_no, p.event_seq,
              e.version_id AS event_version_id, e.to_status AS event_status
         FROM growth_proposals p
         JOIN growth_proposal_events e ON e.proposal_id = p.id AND e.seq = p.event_seq
        WHERE p.id = $1`,
      [proposalId],
    );
    const row = rows[0];
    if (!row) throw new Error("Proposal cache was not created");
    return row;
  };
  const sentProposal = async (): Promise<{ leadId: string; proposalId: string; versionId: string }> => {
    const leadId = await nextLead();
    const proposal = await insertVersion(leadId);
    for (const [from, to, actorId] of [
      ["draft", "pending_approval", cgoId],
      ["pending_approval", "approved", ceoId],
      ["approved", "sent", cgoId],
    ] as const) {
      await db.migrator.execute(sql`
        INSERT INTO growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id)
        VALUES (${proposal.proposalId}, ${proposal.versionId}, ${from}::growth_proposal_status,
                ${to}::growth_proposal_status, ${actorId})
      `);
    }
    return { leadId, ...proposal };
  };
  const accept = async (
    proposal: { leadId: string; proposalId: string; versionId: string },
    method: "signed_document" | "verbal",
    evidenceUrl: string | null,
    note: string | null,
  ): Promise<string> => {
    const result = await db.migrator.execute<{ id: string }>(sql`
      INSERT INTO growth_proposal_acceptances (proposal_id, version_id, lead_id, method, evidence_url, note, accepted_on, recorded_by)
      VALUES (${proposal.proposalId}, ${proposal.versionId}, ${proposal.leadId}, ${method}::growth_acceptance_method,
              ${evidenceUrl}, ${note}, current_date, ${cgoId})
      RETURNING id
    `);
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Acceptance insert returned no id");
    return id;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    ceoId = (await createSuperAdmin(db.migrator)).userId;
    cgoId = await createUser(db.migrator, {
      email: "proposal-constraints-cgo@example.test",
      name: "Proposal Constraints CGO",
      password: "proposal-constraints-cgo-password",
      role: "cgo",
    });
  });

  afterAll(async () => {
    await (db as TestDatabase | undefined)?.close();
  });

  it("creates one cache row and exactly one immutable NULL → draft event for the first version", async () => {
    const leadId = await nextLead();
    const { proposalId, versionId } = await insertVersion(leadId);
    const cache = await current(proposalId);
    const events = await db.query<{ from_status: string | null; to_status: string; version_id: string }>(
      "SELECT from_status, to_status, version_id FROM growth_proposal_events WHERE proposal_id = $1 ORDER BY seq",
      [proposalId],
    );

    expect(cache).toMatchObject({
      status: "draft",
      current_version_id: versionId,
      current_version_no: 1,
      event_seq: 1,
      event_version_id: versionId,
      event_status: "draft",
    });
    expect(events).toEqual([{ from_status: null, to_status: "draft", version_id: versionId }]);
  });

  it("supersedes a draft before creating the next immutable draft event", async () => {
    const leadId = await nextLead();
    const first = await insertVersion(leadId);
    const second = await insertVersion(leadId, first.proposalId);
    const events = await db.query<{ from_status: string | null; to_status: string; version_id: string }>(
      "SELECT from_status, to_status, version_id FROM growth_proposal_events WHERE proposal_id = $1 ORDER BY seq",
      [first.proposalId],
    );

    expect(events).toEqual([
      { from_status: null, to_status: "draft", version_id: first.versionId },
      { from_status: "draft", to_status: "superseded", version_id: first.versionId },
      { from_status: null, to_status: "draft", version_id: second.versionId },
    ]);
  });

  it("keeps the cache status, version and sequence aligned with the latest immutable event", async () => {
    const leadId = await nextLead();
    const proposal = await insertVersion(leadId);
    await db.migrator.execute(sql`
      INSERT INTO growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id)
      VALUES (${proposal.proposalId}, ${proposal.versionId}, 'draft', 'pending_approval', ${cgoId})
    `);
    await db.migrator.execute(sql`
      INSERT INTO growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id)
      VALUES (${proposal.proposalId}, ${proposal.versionId}, 'pending_approval', 'approved', ${ceoId})
    `);

    expect(await current(proposal.proposalId)).toMatchObject({
      status: "approved",
      current_version_id: proposal.versionId,
      current_version_no: 1,
      event_seq: 3,
      event_version_id: proposal.versionId,
      event_status: "approved",
    });
  });

  it("refuses direct proposal cache writes, including the retired configuration bypass", async () => {
    const leadId = await nextLead();
    const proposalId = await uuidv7();
    expect(await pgErrorCode(db.migrator.execute(sql`
      INSERT INTO growth_proposals (id, lead_id, created_by) VALUES (${proposalId}, ${leadId}, ${cgoId})
    `))).toBe("23514");

    const proposal = await insertVersion(leadId);
    expect(await pgErrorCode(db.migrator.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.growth_proposals_write', 'true', true)`);
      await tx.execute(sql`UPDATE growth_proposals SET status = 'approved' WHERE id = ${proposal.proposalId}`);
    }))).toBe("23514");
  });

  it("refuses direct internal transitions and stale, wrong-status, or non-current user transitions", async () => {
    const leadId = await nextLead();
    const proposal = await insertVersion(leadId);
    expect(await run(sql`
      INSERT INTO growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id)
      VALUES (${proposal.proposalId}, ${proposal.versionId}, 'sent', 'accepted', ${cgoId})
    `)).toBe("23514");
    expect(await run(sql`
      INSERT INTO growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id)
      VALUES (${proposal.proposalId}, ${proposal.versionId}, 'approved', 'sent', ${cgoId})
    `)).toBe("23514");

    const replacement = await insertVersion(leadId, proposal.proposalId);
    expect(await run(sql`
      INSERT INTO growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id)
      VALUES (${proposal.proposalId}, ${proposal.versionId}, 'draft', 'pending_approval', ${cgoId})
    `)).toBe("23514");
    expect(await run(sql`
      INSERT INTO growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id)
      VALUES (${proposal.proposalId}, ${replacement.versionId}, 'approved', 'sent', ${cgoId})
    `)).toBe("23514");
  });

  it("makes proposal versions and events append-only, even for crm_migrator", async () => {
    const leadId = await nextLead();
    const proposal = await insertVersion(leadId);
    for (const statement of [
      sql`UPDATE growth_proposal_versions SET summary = 'Changed' WHERE id = ${proposal.versionId}`,
      sql`DELETE FROM growth_proposal_versions WHERE id = ${proposal.versionId}`,
      sql`UPDATE growth_proposal_events SET note = 'Changed' WHERE proposal_id = ${proposal.proposalId}`,
      sql`DELETE FROM growth_proposal_events WHERE proposal_id = ${proposal.proposalId}`,
    ]) {
      expect(await run(statement)).toBe("23514");
    }
    expect(await run(sql`TRUNCATE growth_proposal_events`)).toBe("23514");
  });

  it("refuses proposal/lead mismatches and concurrent first-proposal creation safely", async () => {
    const firstLead = await nextLead();
    const secondLead = await nextLead();
    const proposal = await insertVersion(firstLead);
    expect(await run(sql`
      INSERT INTO growth_proposal_versions (proposal_id, lead_id, document_url, amount_minor, valid_until, summary, created_by)
      VALUES (${proposal.proposalId}, ${secondLead}, 'https://example.test/mismatch.pdf', 1, current_date + 30, 'Mismatch', ${cgoId})
    `)).toBe("23514");

    const raceLead = await nextLead();
    const firstProposalId = await uuidv7();
    const secondProposalId = await uuidv7();
    let release: () => void = () => undefined;
    let inserted: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const insertedFirst = new Promise<void>((resolve) => { inserted = resolve; });
    const first = db.migrator.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO growth_proposal_versions (proposal_id, lead_id, document_url, amount_minor, valid_until, summary, created_by)
        VALUES (${firstProposalId}, ${raceLead}, 'https://example.test/first.pdf', 1, current_date + 30, 'First', ${cgoId})
      `);
      inserted();
      await held;
    });
    await insertedFirst;
    const second = pgErrorCode(db.migrator.execute(sql`
      INSERT INTO growth_proposal_versions (proposal_id, lead_id, document_url, amount_minor, valid_until, summary, created_by)
      VALUES (${secondProposalId}, ${raceLead}, 'https://example.test/second.pdf', 1, current_date + 30, 'Second', ${cgoId})
    `));
    release();
    await first;
    expect(await second).toBe("23514");
  });

  it("uses a UUIDv7 proposal id and derives cache ownership from the version creator", async () => {
    const leadId = await nextLead();
    const proposalId = await uuidv7();
    const proposal = await insertVersion(leadId, proposalId);
    const rows = await db.query<{ id: string; created_by: string }>(
      "SELECT id::text AS id, created_by::text AS created_by FROM growth_proposals WHERE id = $1",
      [proposal.proposalId],
    );

    expect(proposal.proposalId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(rows).toEqual([{ id: proposal.proposalId, created_by: cgoId }]);
  });

  it("refuses non-verbal acceptance without HTTPS evidence and verbal acceptance without a note", async () => {
    const nonVerbal = await sentProposal();
    expect(await run(sql`
      INSERT INTO growth_proposal_acceptances (proposal_id, version_id, lead_id, method, accepted_on, recorded_by)
      VALUES (${nonVerbal.proposalId}, ${nonVerbal.versionId}, ${nonVerbal.leadId}, 'signed_document', current_date, ${cgoId})
    `)).toBe("23514");

    const verbal = await sentProposal();
    expect(await run(sql`
      INSERT INTO growth_proposal_acceptances (proposal_id, version_id, lead_id, method, accepted_on, recorded_by)
      VALUES (${verbal.proposalId}, ${verbal.versionId}, ${verbal.leadId}, 'verbal', current_date, ${cgoId})
    `)).toBe("23514");
  });

  it("marks verbal acceptance as needing CEO confirmation and does not allow its transition to be inserted directly", async () => {
    const proposal = await sentProposal();
    expect(await run(sql`
      INSERT INTO growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id)
      VALUES (${proposal.proposalId}, ${proposal.versionId}, 'sent', 'acceptance_pending', ${cgoId})
    `)).toBe("23514");
    const acceptanceId = await accept(proposal, "verbal", null, "Accepted during a call");
    const acceptance = await db.query<{ needs_confirmation: boolean }>(
      "SELECT needs_confirmation FROM growth_proposal_acceptances WHERE id = $1",
      [acceptanceId],
    );
    expect(acceptance).toEqual([{ needs_confirmation: true }]);
    expect((await current(proposal.proposalId)).status).toBe("acceptance_pending");
    expect(await run(sql`
      INSERT INTO growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id)
      VALUES (${proposal.proposalId}, ${proposal.versionId}, 'acceptance_pending', 'acceptance_refused', ${ceoId})
    `)).toBe("23514");
  });

  it("requires a CEO confirmation actor and a refusal note", async () => {
    const proposal = await sentProposal();
    const acceptanceId = await accept(proposal, "verbal", null, "Accepted during a call");
    expect(await run(sql`
      INSERT INTO growth_proposal_confirmations (acceptance_id, decision, note, actor_id)
      VALUES (${acceptanceId}, 'confirmed', NULL, ${cgoId})
    `)).toBe("23514");
    expect(await run(sql`
      INSERT INTO growth_proposal_confirmations (acceptance_id, decision, note, actor_id)
      VALUES (${acceptanceId}, 'refused', NULL, ${ceoId})
    `)).toBe("23514");
    expect(await run(sql`
      INSERT INTO growth_proposal_confirmations (acceptance_id, decision, note, actor_id)
      VALUES (${acceptanceId}, 'refused', 'Written evidence required', ${ceoId})
    `)).toBeNull();
    expect((await current(proposal.proposalId)).status).toBe("acceptance_refused");
  });

  it("refuses won updates without an accepted current version, including pending and refused acceptances", async () => {
    const sent = await sentProposal();
    expect(await run(sql`UPDATE growth_leads SET stage = 'won', won_version_id = ${sent.versionId} WHERE id = ${sent.leadId}`)).toBe("23514");

    const pending = await sentProposal();
    const pendingAcceptance = await accept(pending, "verbal", null, "Accepted during a call");
    expect(await run(sql`UPDATE growth_leads SET stage = 'won', won_version_id = ${pending.versionId} WHERE id = ${pending.leadId}`)).toBe("23514");
    await db.migrator.execute(sql`
      INSERT INTO growth_proposal_confirmations (acceptance_id, decision, note, actor_id)
      VALUES (${pendingAcceptance}, 'refused', 'Written evidence required', ${ceoId})
    `);
    expect(await run(sql`UPDATE growth_leads SET stage = 'won', won_version_id = ${pending.versionId} WHERE id = ${pending.leadId}`)).toBe("23514");
  });

  it("refuses every won-field write while the lead is not won", async () => {
    const leadId = await nextLead();
    const versionId = await uuidv7();
    expect(await run(sql`UPDATE growth_leads SET won_at = now() WHERE id = ${leadId}`)).toBe("23514");
    expect(await run(sql`
      UPDATE growth_leads
         SET won_at = now(), won_version_id = ${versionId}, won_amount_minor = 500000, won_currency = 'INR'
       WHERE id = ${leadId}
    `)).toBe("23514");
  });

  it("derives the valid won snapshot from the accepted version and freezes the lead", async () => {
    const proposal = await sentProposal();
    await accept(proposal, "signed_document", "https://example.test/signed.pdf", null);
    const snapshot = await db.migrator.transaction(async (tx) => {
      const result = await tx.execute<{
        stage_revision: number;
        won_at: string;
        won_amount_minor: string;
        won_currency: string;
        won_version_id: string;
      }>(sql`
        UPDATE growth_leads
           SET stage = 'won', won_version_id = ${proposal.versionId}
         WHERE id = ${proposal.leadId}
        RETURNING stage_revision, won_at, won_amount_minor, won_currency, won_version_id
      `);
      const row = result.rows[0];
      if (!row) throw new Error("Won lead update returned no row");
      await tx.execute(sql`
        INSERT INTO growth_stage_changes (lead_id, from_stage, to_stage, actor_id, stage_revision)
        VALUES (${proposal.leadId}, 'new', 'won', ${cgoId}, ${row.stage_revision})
      `);
      return row;
    });
    expect(snapshot).toMatchObject({
      won_amount_minor: "500000",
      won_currency: "INR",
      won_version_id: proposal.versionId,
    });
    expect(snapshot.won_at).toMatch(/^\d{4}-\d{2}-\d{2} /);
    expect((await current(proposal.proposalId)).status).toBe("won");
    expect(await run(sql`UPDATE growth_leads SET priority = 'high' WHERE id = ${proposal.leadId}`)).toBe("23514");
  });
});
