import type { AcceptanceMethod, ProposalStatus } from "@crm/contracts/growth-proposals";
import {
  growthLeads,
  growthProposalAcceptances,
  growthProposalConfirmations,
  growthProposalEvents,
  growthProposals,
  growthProposalVersions,
} from "@crm/database/schema";
import { and, asc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";

/**
 * Reads, plus inserts limited to the columns crm_app may write. Nothing here updates growth_proposals or inserts
 * internal transitions: the database derives those from versions, acceptances, confirmations and the won lead.
 */

const proposalColumns = {
  id: growthProposals.id,
  leadId: growthProposals.leadId,
  leadName: growthLeads.name,
  ownerId: growthLeads.ownerId,
  status: growthProposals.status,
  currentVersionId: growthProposals.currentVersionId,
  currentVersionNo: growthProposals.currentVersionNo,
  amountMinor: growthProposalVersions.amountMinor,
  validUntil: growthProposalVersions.validUntil,
  createdAt: growthProposals.createdAt,
  updatedAt: growthProposals.updatedAt,
};

const proposalQuery = (db: Executor) =>
  db
    .select(proposalColumns)
    .from(growthProposals)
    .innerJoin(growthLeads, eq(growthLeads.id, growthProposals.leadId))
    .innerJoin(growthProposalVersions, eq(growthProposalVersions.id, growthProposals.currentVersionId));

export type ProposalRow = Awaited<ReturnType<typeof proposalQuery>>[number];

export async function statusForLead(db: Executor, leadId: string): Promise<ProposalStatus | null> {
  const rows = await db.select({ status: growthProposals.status }).from(growthProposals).where(eq(growthProposals.leadId, leadId)).limit(1);
  return rows[0]?.status ?? null;
}

export async function findByLead(db: Executor, leadId: string): Promise<ProposalRow | null> {
  const rows = await proposalQuery(db).where(eq(growthProposals.leadId, leadId)).limit(1);
  return rows[0] ?? null;
}

export async function findById(db: Executor, id: string): Promise<ProposalRow | null> {
  const rows = await proposalQuery(db).where(eq(growthProposals.id, id)).limit(1);
  return rows[0] ?? null;
}

export function listProposals(
  db: Executor,
  filter: { statuses: ProposalStatus[] | undefined; leadId: string | undefined; cursor: string | undefined; limit: number },
) {
  const conditions: SQL[] = [];
  if (filter.statuses !== undefined) conditions.push(inArray(growthProposals.status, filter.statuses));
  if (filter.leadId !== undefined) conditions.push(eq(growthProposals.leadId, filter.leadId));
  if (filter.cursor !== undefined) conditions.push(gt(growthProposals.id, filter.cursor));
  return proposalQuery(db)
    .where(and(...conditions))
    .orderBy(asc(growthProposals.id))
    .limit(filter.limit + 1);
}

/** Every version, oldest first, with its status from its latest event. */
export function versions(db: Executor, proposalId: string) {
  return db
    .select({
      id: growthProposalVersions.id,
      versionNo: growthProposalVersions.versionNo,
      status: sql<ProposalStatus>`(SELECT e.to_status FROM growth_proposal_events e
                                   WHERE e.version_id = growth_proposal_versions.id ORDER BY e.seq DESC LIMIT 1)`,
      documentUrl: growthProposalVersions.documentUrl,
      amountMinor: growthProposalVersions.amountMinor,
      validUntil: growthProposalVersions.validUntil,
      summary: growthProposalVersions.summary,
      createdBy: growthProposalVersions.createdBy,
      createdAt: growthProposalVersions.createdAt,
    })
    .from(growthProposalVersions)
    .where(eq(growthProposalVersions.proposalId, proposalId))
    .orderBy(asc(growthProposalVersions.versionNo));
}

export function events(db: Executor, proposalId: string) {
  return db
    .select({
      id: growthProposalEvents.id,
      seq: growthProposalEvents.seq,
      versionNo: growthProposalVersions.versionNo,
      fromStatus: growthProposalEvents.fromStatus,
      toStatus: growthProposalEvents.toStatus,
      actorId: growthProposalEvents.actorId,
      note: growthProposalEvents.note,
      createdAt: growthProposalEvents.createdAt,
    })
    .from(growthProposalEvents)
    .innerJoin(growthProposalVersions, eq(growthProposalVersions.id, growthProposalEvents.versionId))
    .where(eq(growthProposalEvents.proposalId, proposalId))
    .orderBy(asc(growthProposalEvents.seq));
}

export function acceptances(db: Executor, proposalId: string) {
  return db
    .select({
      id: growthProposalAcceptances.id,
      versionId: growthProposalAcceptances.versionId,
      versionNo: growthProposalVersions.versionNo,
      method: growthProposalAcceptances.method,
      evidenceUrl: growthProposalAcceptances.evidenceUrl,
      note: growthProposalAcceptances.note,
      acceptedOn: growthProposalAcceptances.acceptedOn,
      late: growthProposalAcceptances.late,
      needsConfirmation: growthProposalAcceptances.needsConfirmation,
      recordedBy: growthProposalAcceptances.recordedBy,
      recordedAt: growthProposalAcceptances.recordedAt,
      decision: growthProposalConfirmations.decision,
      decisionNote: growthProposalConfirmations.note,
      decidedBy: growthProposalConfirmations.actorId,
      decidedAt: growthProposalConfirmations.createdAt,
    })
    .from(growthProposalAcceptances)
    .innerJoin(growthProposalVersions, eq(growthProposalVersions.id, growthProposalAcceptances.versionId))
    .leftJoin(growthProposalConfirmations, eq(growthProposalConfirmations.acceptanceId, growthProposalAcceptances.id))
    .where(eq(growthProposalAcceptances.proposalId, proposalId))
    .orderBy(asc(growthProposalVersions.versionNo));
}
export type AcceptanceRow = Awaited<ReturnType<typeof acceptances>>[number];

export async function acceptanceForVersion(db: Executor, versionId: string): Promise<AcceptanceRow | null> {
  const rows = await db
    .select({ proposalId: growthProposalAcceptances.proposalId })
    .from(growthProposalAcceptances)
    .where(eq(growthProposalAcceptances.versionId, versionId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return (await acceptances(db, row.proposalId)).find((acceptance) => acceptance.versionId === versionId) ?? null;
}

/** Proposal cache IDs are generated by PostgreSQL inside the caller's transaction. */
export async function nextProposalId(tx: Tx): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`SELECT uuidv7() AS id`);
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Proposal UUIDv7 generation returned no id");
  return id;
}

export async function insertVersion(
  tx: Tx,
  input: { proposalId: string; leadId: string; documentUrl: string; amountMinor: number; validUntil: string; summary: string; createdBy: string },
): Promise<{ id: string; versionNo: number }> {
  const result = await tx.execute<{ id: string; version_no: number }>(sql`
    INSERT INTO growth_proposal_versions (proposal_id, lead_id, document_url, amount_minor, valid_until, summary, created_by)
    VALUES (${input.proposalId}, ${input.leadId}, ${input.documentUrl}, ${input.amountMinor}, ${input.validUntil}::date,
            ${input.summary}, ${input.createdBy})
    RETURNING id, version_no
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Version insert returned no row");
  return { id: row.id, versionNo: row.version_no };
}

/** User transitions only (submit, approve, reject, send, withdraw). */
export async function insertEvent(
  tx: Tx,
  input: { proposalId: string; versionId: string; from: ProposalStatus; to: ProposalStatus; actorId: string; note: string | null },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO growth_proposal_events (proposal_id, version_id, from_status, to_status, actor_id, note)
    VALUES (${input.proposalId}, ${input.versionId}, ${input.from}::growth_proposal_status, ${input.to}::growth_proposal_status,
            ${input.actorId}, ${input.note})
  `);
}

export async function insertAcceptance(
  tx: Tx,
  input: {
    proposalId: string;
    versionId: string;
    leadId: string;
    method: AcceptanceMethod;
    evidenceUrl: string | null;
    note: string | null;
    acceptedOn: string;
    recordedBy: string;
  },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO growth_proposal_acceptances (proposal_id, version_id, lead_id, method, evidence_url, note, accepted_on, recorded_by)
    VALUES (${input.proposalId}, ${input.versionId}, ${input.leadId}, ${input.method}::growth_acceptance_method,
            ${input.evidenceUrl}, ${input.note}, ${input.acceptedOn}::date, ${input.recordedBy})
  `);
}

export async function insertConfirmation(
  tx: Tx,
  input: { acceptanceId: string; decision: "confirmed" | "refused"; note: string | null; actorId: string },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO growth_proposal_confirmations (acceptance_id, decision, note, actor_id)
    VALUES (${input.acceptanceId}, ${input.decision}::growth_confirmation_decision, ${input.note}, ${input.actorId})
  `);
}

/** Phase 8 boundary: won leads in (won_at, id) order. Read-only. */
export function wonLeads(db: Executor, after: { wonAt: string; id: string } | undefined, limit: number) {
  const conditions: SQL[] = [eq(growthLeads.stage, "won")];
  if (after !== undefined) {
    conditions.push(sql`(${growthLeads.wonAt}, ${growthLeads.id}) > (${after.wonAt}::timestamptz, ${after.id}::uuid)`);
  }
  return db
    .select({
      leadId: growthLeads.id,
      companyId: growthLeads.companyId,
      primaryContactId: growthLeads.primaryContactId,
      wonAt: sql<string>`to_char(${growthLeads.wonAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      amountMinor: growthLeads.wonAmountMinor,
      currency: growthLeads.wonCurrency,
      proposalVersionId: growthLeads.wonVersionId,
      versionNo: growthProposalVersions.versionNo,
    })
    .from(growthLeads)
    .innerJoin(growthProposalVersions, eq(growthProposalVersions.id, growthLeads.wonVersionId))
    .where(and(...conditions))
    .orderBy(asc(growthLeads.wonAt), asc(growthLeads.id))
    .limit(limit);
}
