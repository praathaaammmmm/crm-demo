import { canTransition, type AcceptanceRequest, type CreateVersionRequest, type ProposalStatus, type ProposalListQuery, type UserTransition, type VersionActionRequest } from "@crm/contracts/growth-proposals";
import type { Database } from "@crm/database/client";
import type { AuthSession, Ctx, Tx } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { recordAudit } from "../audit/index.js";
import { GROWTH_AUDIT } from "./growth.audit.js";
import * as leadRepo from "./leads.repository.js";
import * as policy from "./growth.policy.js";
import * as repo from "./proposals.repository.js";
import { guarded } from "./growth.service.js";

type User = AuthSession["user"];
export interface ProposalDeps { db: Database; orgTimezone: string }
export interface WonLeadCursor { wonAt: string; id: string }

const audit = (action: string, proposalId: string, versionNo: number, extra: Record<string, unknown> = {}) =>
  ({ action, entityType: "growth_proposal", entityId: proposalId, after: { versionNo, ...extra } } as const);

async function current(tx: Parameters<typeof repo.findByLead>[0], leadId: string) {
  const proposal = await repo.findByLead(tx, leadId);
  if (!proposal) throw errors.notFound();
  return proposal;
}

const assertEditableLead = (lead: { archivedAt: Date | null; stage: string }) => {
  if (lead.archivedAt !== null) throw errors.conflict("An archived lead cannot change proposals");
  if (lead.stage === "won") throw errors.conflict("A won lead is final");
};

async function lockProposal(tx: Tx, deps: ProposalDeps, proposalId: string) {
  const proposal = await repo.findById(tx, proposalId);
  if (!proposal) throw errors.notFound();
  const lead = await leadRepo.lockLead(tx, proposal.leadId, deps.orgTimezone);
  if (!lead) throw errors.notFound();
  assertEditableLead(lead);
  return { proposal: assertedCurrent(proposal), lead };
}

function assertedCurrent(proposal: Awaited<ReturnType<typeof current>>): Awaited<ReturnType<typeof current>> & { status: ProposalStatus; currentVersionId: string; currentVersionNo: number } {
  if (proposal.status === null || proposal.currentVersionId === null || proposal.currentVersionNo === null) {
    throw errors.conflict("The proposal is not ready for this action");
  }
  return proposal as Awaited<ReturnType<typeof current>> & { status: ProposalStatus; currentVersionId: string; currentVersionNo: number };
}

export async function detail(deps: ProposalDeps, user: User, leadId: string) {
  policy.assertCanRead(user);
  const lead = await leadRepo.findLead(deps.db, leadId, deps.orgTimezone);
  if (!lead) throw errors.notFound();
  const proposal = await repo.findByLead(deps.db, leadId);
  if (!proposal) return { proposal: null, versions: [], events: [], acceptances: [] };
  return { proposal, versions: await repo.versions(deps.db, proposal.id), events: await repo.events(deps.db, proposal.id), acceptances: await repo.acceptances(deps.db, proposal.id) };
}

export async function list(deps: ProposalDeps, user: User, query: ProposalListQuery) {
  policy.assertCanRead(user);
  const rows = await repo.listProposals(deps.db, { statuses: query.status === undefined ? undefined : [query.status], leadId: query.leadId, cursor: query.cursor, limit: query.limit });
  const items = rows.slice(0, query.limit);
  return { items, nextCursor: rows.length > query.limit ? items.at(-1)?.id ?? null : null };
}

export async function queue(deps: ProposalDeps, user: User, query: Pick<ProposalListQuery, "cursor" | "limit">) {
  policy.assertCanApproveProposals(user);
  const rows = await repo.listProposals(deps.db, { statuses: ["pending_approval", "acceptance_pending"], leadId: undefined, cursor: query.cursor, limit: query.limit });
  const items = rows.slice(0, query.limit);
  return { items, nextCursor: rows.length > query.limit ? items.at(-1)?.id ?? null : null };
}

/**
 * Phase 8 read boundary. It deliberately delegates to the read-only repository
 * query: it neither creates downstream records nor changes Growth state.
 */
export function wonLeadsForConversion(db: Database, after: WonLeadCursor | undefined, limit: number) {
  return repo.wonLeads(db, after, limit);
}

export async function createVersion(deps: ProposalDeps, ctx: Ctx, user: User, leadId: string, input: CreateVersionRequest) {
  policy.assertCanManage(user);
  return guarded(deps.db, async (tx) => {
    const lead = await leadRepo.lockLead(tx, leadId, deps.orgTimezone);
    if (!lead) throw errors.notFound();
    assertEditableLead(lead);
    const existing = await repo.findByLead(tx, leadId);
    if ((existing?.currentVersionNo ?? null) !== input.expectedVersionNo) throw errors.conflict("The proposal changed; refresh and try again");
    const proposalId = existing?.id ?? (await repo.nextProposalId(tx));
    const version = await repo.insertVersion(tx, { proposalId, leadId, documentUrl: input.documentUrl, amountMinor: input.amountMinor, validUntil: input.validUntil, summary: input.summary, createdBy: user.id });
    await recordAudit(tx, ctx, audit(GROWTH_AUDIT.proposalVersionCreated, proposalId, version.versionNo));
    return current(tx, leadId);
  });
}

const transition = async (deps: ProposalDeps, ctx: Ctx, user: User, proposalId: string, input: VersionActionRequest, action: UserTransition, auditAction: string) =>
  guarded(deps.db, async (tx) => {
    const { proposal } = await lockProposal(tx, deps, proposalId);
    if (proposal.currentVersionNo !== input.versionNo) throw errors.conflict("This is not the current proposal version");
    if (!canTransition(action, proposal.status)) throw errors.conflict("This proposal action is not allowed in its current state");
    const to = ({ submit: "pending_approval", approve: "approved", reject: "rejected", send: "sent", withdraw: "withdrawn" } as const)[action];
    await repo.insertEvent(tx, { proposalId: proposal.id, versionId: proposal.currentVersionId, from: proposal.status, to, actorId: user.id, note: input.note ?? null });
    await recordAudit(tx, ctx, audit(auditAction, proposal.id, input.versionNo, { status: to }));
    return repo.findById(tx, proposalId).then((row) => row ?? proposal);
  });

export const submit = (d: ProposalDeps, c: Ctx, u: User, id: string, i: VersionActionRequest) => { policy.assertCanManage(u); return transition(d,c,u,id,i,"submit",GROWTH_AUDIT.proposalSubmitted); };
export const approve = (d: ProposalDeps, c: Ctx, u: User, id: string, i: VersionActionRequest) => { policy.assertCanApproveProposals(u); return transition(d,c,u,id,i,"approve",GROWTH_AUDIT.proposalApproved); };
export const reject = (d: ProposalDeps, c: Ctx, u: User, id: string, i: VersionActionRequest) => { policy.assertCanApproveProposals(u); return transition(d,c,u,id,i,"reject",GROWTH_AUDIT.proposalRejected); };
export const send = (d: ProposalDeps, c: Ctx, u: User, id: string, i: VersionActionRequest) => { policy.assertCanManage(u); return transition(d,c,u,id,i,"send",GROWTH_AUDIT.proposalSent); };
export const withdraw = (d: ProposalDeps, c: Ctx, u: User, id: string, i: VersionActionRequest) => { policy.assertCanManage(u); return transition(d,c,u,id,i,"withdraw",GROWTH_AUDIT.proposalWithdrawn); };

export async function accept(deps: ProposalDeps, ctx: Ctx, user: User, proposalId: string, input: AcceptanceRequest) {
  policy.assertCanManage(user);
  return guarded(deps.db, async (tx) => {
    const { proposal } = await lockProposal(tx, deps, proposalId);
    if (proposal.currentVersionNo !== input.versionNo) throw errors.conflict("This is not the current proposal version");
    if (proposal.status !== "sent") throw errors.conflict("Only a sent proposal can be accepted");
    await repo.insertAcceptance(tx, { proposalId: proposal.id, versionId: proposal.currentVersionId, leadId: proposal.leadId, method: input.method, evidenceUrl: input.evidenceUrl ?? null, note: input.note ?? null, acceptedOn: input.acceptedOn, recordedBy: user.id });
    await recordAudit(tx, ctx, audit(GROWTH_AUDIT.proposalAcceptanceRecorded, proposal.id, input.versionNo, { method: input.method }));
    return repo.findById(tx, proposalId).then((row) => row ?? proposal);
  });
}

export async function confirm(deps: ProposalDeps, ctx: Ctx, user: User, proposalId: string, input: VersionActionRequest, decision: "confirmed" | "refused") {
  policy.assertCanApproveProposals(user);
  return guarded(deps.db, async (tx) => {
    const { proposal } = await lockProposal(tx, deps, proposalId);
    if (proposal.currentVersionNo !== input.versionNo) throw errors.conflict("This is not the current proposal version");
    const acceptance = await repo.acceptanceForVersion(tx, proposal.currentVersionId);
    if (!acceptance || proposal.status !== "acceptance_pending") throw errors.conflict("No acceptance is awaiting confirmation");
    await repo.insertConfirmation(tx, { acceptanceId: acceptance.id, decision, note: input.note ?? null, actorId: user.id });
    await recordAudit(tx, ctx, audit(GROWTH_AUDIT.proposalConfirmationDecided, proposal.id, input.versionNo, { decision }));
    return repo.findById(tx, proposalId).then((row) => row ?? proposal);
  });
}

export async function markWon(deps: ProposalDeps, ctx: Ctx, user: User, leadId: string, versionNo: number) {
  policy.assertCanManage(user);
  return guarded(deps.db, async (tx) => {
    const lead = await leadRepo.lockLead(tx, leadId, deps.orgTimezone);
    if (!lead) throw errors.notFound();
    assertEditableLead(lead);
    const proposal = assertedCurrent(await current(tx, leadId));
    if (proposal.currentVersionNo !== versionNo) throw errors.conflict("This is not the current proposal version");
    if (proposal.status !== "accepted") throw errors.conflict("Only an accepted proposal can win the lead");
    const revision = await leadRepo.markLeadWon(tx, leadId, proposal.currentVersionId);
    await leadRepo.insertStageChange(tx, { leadId, fromStage: lead.stage, toStage: "won", actorId: user.id, note: null, lostReason: null, stageRevision: revision });
    await recordAudit(tx, ctx, audit(GROWTH_AUDIT.leadMarkedWon, proposal.id, versionNo));
    return current(tx, leadId);
  });
}
