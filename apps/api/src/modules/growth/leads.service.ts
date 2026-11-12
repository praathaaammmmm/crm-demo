import {
  canMoveStage,
  canReopen,
  type CreateLeadRequest,
  type GrowthStage,
  type LeadListQuery,
  type ReassignRequest,
  type ReopenRequest,
  type StageMoveRequest,
  type UpdateLeadRequest,
} from "@crm/contracts/growth-leads";
import { isActiveProposal } from "@crm/contracts/growth-proposals";
import type { Database } from "@crm/database/client";
import type { AuthSession, Ctx, Executor, Tx } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { recordAudit } from "../audit/index.js";
import { GROWTH_AUDIT } from "./growth.audit.js";
import * as policy from "./growth.policy.js";
import * as growthRepo from "./growth.repository.js";
import { assertOwnerIsActiveCgo, guarded, page } from "./growth.service.js";
import * as repo from "./leads.repository.js";
import * as proposalRepo from "./proposals.repository.js";
import type { LeadRow, StageChangeRow } from "./leads.repository.js";

type User = AuthSession["user"];

export interface LeadDeps {
  db: Database;
  /** Defines "today" for follow-ups and overdue leads. */
  orgTimezone: string;
}

/** Allowlisted lead fields for audit snapshots: no name, notes or contact data. */
const leadSnapshot = (lead: LeadRow): Record<string, unknown> => ({
  companyId: lead.companyId,
  primaryContactId: lead.primaryContactId,
  ownerId: lead.ownerId,
  source: lead.source,
  priority: lead.priority,
  stage: lead.stage,
  estimatedValueMinor: lead.estimatedValueMinor,
  currency: lead.currency,
  expectedCloseOn: lead.expectedCloseOn,
  nextFollowUpOn: lead.nextFollowUpOn,
});

/** A follow-up date, when set, must be today or later in the organisation's time zone. */
export async function assertFollowUpNotPast(db: Executor, date: string | null | undefined, timeZone: string): Promise<void> {
  if (date === undefined || date === null) return;
  if (date < (await repo.todayIn(db, timeZone))) throw errors.validation("The next follow-up date cannot be in the past");
}

/** New or changed links must name an existing, non-archived company and a contact of that company. */
async function assertLinks(db: Executor, companyId: string | null, contactId: string | null): Promise<void> {
  if (contactId !== null && companyId === null) throw errors.validation("A primary contact needs its company");
  if (companyId !== null) {
    const company = await growthRepo.findCompany(db, companyId);
    if (!company) throw errors.conflict("The company does not exist");
    if (company.archivedAt !== null) throw errors.conflict("A lead cannot be linked to an archived company");
  }
  if (contactId !== null) {
    const contact = await growthRepo.findContact(db, contactId);
    if (contact?.companyId !== companyId) throw errors.conflict("The primary contact must belong to the lead's company");
    if (contact.archivedAt !== null) throw errors.conflict("A lead cannot be linked to an archived contact");
  }
}

const assertNotArchived = (lead: LeadRow) => {
  if (lead.stage === "won") throw errors.conflict("A won lead is final");
  if (lead.archivedAt !== null) throw errors.conflict("An archived lead is read-only");
};

/** A lead cannot become lost or archived while its proposal is active (withdraw it first); the database agrees. */
async function assertNoActiveProposal(tx: Tx, leadId: string): Promise<void> {
  if (isActiveProposal(await proposalRepo.statusForLead(tx, leadId))) throw errors.conflict("Withdraw the active proposal first");
}

async function lockExisting(tx: Tx, id: string, timeZone: string): Promise<LeadRow> {
  const lead = await repo.lockLead(tx, id, timeZone);
  if (!lead) throw errors.notFound();
  return lead;
}

async function reload(tx: Tx, id: string, timeZone: string): Promise<LeadRow> {
  const lead = await repo.findLead(tx, id, timeZone);
  if (!lead) throw new Error("Lead not found after change");
  return lead;
}

/** One transition: the stage update returns its revision, and the matching history row is written at once. */
async function transition(
  tx: Tx,
  ctx: Ctx,
  user: User,
  lead: LeadRow,
  to: GrowthStage,
  details: { note: string | null; lostReason: string | null; action: string },
): Promise<number> {
  const revision = await repo.updateStage(tx, lead.id, { to, lostReason: details.lostReason, lostNote: details.note });
  await repo.insertStageChange(tx, {
    leadId: lead.id,
    fromStage: lead.stage,
    toStage: to,
    actorId: user.id,
    note: details.note,
    lostReason: to === "lost" ? details.lostReason : null,
    stageRevision: revision,
  });
  await recordAudit(tx, ctx, {
    action: details.action,
    entityType: "growth_lead",
    entityId: lead.id,
    before: { stage: lead.stage, lostReason: lead.lostReason },
    after: { stage: to, lostReason: to === "lost" ? details.lostReason : null, stageRevision: revision },
  });
  return revision;
}

export async function listLeads(deps: LeadDeps, user: User, query: LeadListQuery) {
  policy.assertCanRead(user);
  const rows = await repo.listLeads(
    deps.db,
    {
      stage: query.stage,
      owner: query.owner,
      source: query.source,
      overdue: query.overdue === undefined ? undefined : query.overdue === "true",
      stale: query.stale === undefined ? undefined : query.stale === "true",
      archived: query.archived === "true",
      companyId: query.companyId,
      cursor: query.cursor,
      limit: query.limit,
    },
    deps.orgTimezone,
  );
  return page(rows, query.limit);
}

export async function getLead(deps: LeadDeps, user: User, id: string): Promise<{ lead: LeadRow; history: StageChangeRow[] }> {
  policy.assertCanRead(user);
  const lead = await repo.findLead(deps.db, id, deps.orgTimezone);
  if (!lead) throw errors.notFound();
  return { lead, history: await repo.stageHistory(deps.db, id) };
}

/** CGO only; the caller becomes the owner and the lead starts in stage new. */
export async function createLead(deps: LeadDeps, ctx: Ctx, user: User, input: CreateLeadRequest): Promise<LeadRow> {
  policy.assertCanManage(user);
  await assertOwnerIsActiveCgo(deps.db, user);
  await assertFollowUpNotPast(deps.db, input.nextFollowUpOn, deps.orgTimezone);
  return guarded(deps.db, async (tx) => {
    await assertLinks(tx, input.companyId ?? null, input.primaryContactId ?? null);
    const id = await repo.insertLead(tx, {
      name: input.name,
      companyId: input.companyId ?? null,
      primaryContactId: input.primaryContactId ?? null,
      source: input.source,
      sourceDetail: input.sourceDetail ?? null,
      ownerId: user.id,
      priority: input.priority,
      estimatedValueMinor: input.estimatedValueMinor ?? null,
      expectedCloseOn: input.expectedCloseOn ?? null,
      nextFollowUpOn: input.nextFollowUpOn ?? null,
      createdBy: user.id,
    });
    const created = await reload(tx, id, deps.orgTimezone);
    await recordAudit(tx, ctx, { action: GROWTH_AUDIT.leadCreated, entityType: "growth_lead", entityId: id, after: leadSnapshot(created) });
    return created;
  });
}

/** CGO only; not on lost or archived leads. Stage, owner and lost details have their own endpoints. */
export async function updateLead(deps: LeadDeps, ctx: Ctx, user: User, id: string, input: UpdateLeadRequest): Promise<LeadRow> {
  policy.assertCanManage(user);
  if (input.nextFollowUpOn !== undefined) await assertFollowUpNotPast(deps.db, input.nextFollowUpOn, deps.orgTimezone);
  return guarded(deps.db, async (tx) => {
    const before = await lockExisting(tx, id, deps.orgTimezone);
    assertNotArchived(before);
    if (before.stage === "lost") throw errors.conflict("A lost lead can only be reopened, reassigned or archived");
    const companyId = input.companyId === undefined ? before.companyId : input.companyId;
    const contactId =
      input.primaryContactId === undefined ? (input.companyId === null ? null : before.primaryContactId) : input.primaryContactId;
    if (companyId !== before.companyId || contactId !== before.primaryContactId) await assertLinks(tx, companyId, contactId);
    await repo.updateLeadFields(tx, id, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(companyId === before.companyId ? {} : { companyId }),
      ...(contactId === before.primaryContactId ? {} : { primaryContactId: contactId }),
      ...(input.source === undefined ? {} : { source: input.source }),
      ...(input.sourceDetail === undefined ? {} : { sourceDetail: input.sourceDetail }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.estimatedValueMinor === undefined ? {} : { estimatedValueMinor: input.estimatedValueMinor }),
      ...(input.expectedCloseOn === undefined ? {} : { expectedCloseOn: input.expectedCloseOn }),
      ...(input.nextFollowUpOn === undefined ? {} : { nextFollowUpOn: input.nextFollowUpOn }),
    });
    const after = await reload(tx, id, deps.orgTimezone);
    await recordAudit(tx, ctx, {
      action: GROWTH_AUDIT.leadUpdated,
      entityType: "growth_lead",
      entityId: id,
      before: leadSnapshot(before),
      after: { ...leadSnapshot(after), nameChanged: before.name !== after.name, sourceDetailChanged: before.sourceDetail !== after.sourceDetail, version: after.version },
    });
    return after;
  });
}

/** CGO only: between open stages, or to lost with a reason and note. Won is the proposal mark-won action. */
export async function moveStage(deps: LeadDeps, ctx: Ctx, user: User, id: string, input: StageMoveRequest): Promise<LeadRow> {
  policy.assertCanManage(user);
  return guarded(deps.db, async (tx) => {
    const lead = await lockExisting(tx, id, deps.orgTimezone);
    assertNotArchived(lead);
    if (input.to === "won") throw errors.conflict("Mark a lead won from its accepted proposal");
    if (!canMoveStage(lead.stage, input.to)) throw errors.conflict("This stage change is not allowed");
    if (input.to === "lost") await assertNoActiveProposal(tx, id);
    await transition(tx, ctx, user, lead, input.to, {
      note: input.note ?? null,
      lostReason: input.lostReason ?? null,
      action: GROWTH_AUDIT.leadStageChanged,
    });
    return reload(tx, id, deps.orgTimezone);
  });
}

/** CEO only: a lost, non-archived lead back to an open stage, with a note. */
export async function reopenLead(deps: LeadDeps, ctx: Ctx, user: User, id: string, input: ReopenRequest): Promise<LeadRow> {
  policy.assertCanReopen(user);
  return guarded(deps.db, async (tx) => {
    const lead = await lockExisting(tx, id, deps.orgTimezone);
    assertNotArchived(lead);
    if (!canReopen(lead.stage, input.to)) throw errors.conflict("Only a lost lead can be reopened, to an open stage");
    await transition(tx, ctx, user, lead, input.to, { note: input.note, lostReason: null, action: GROWTH_AUDIT.leadReopened });
    return reload(tx, id, deps.orgTimezone);
  });
}

/** CEO only: the new owner must be a different, active CGO; archived leads cannot be reassigned. */
export async function reassignLead(deps: LeadDeps, ctx: Ctx, user: User, id: string, input: ReassignRequest): Promise<LeadRow> {
  policy.assertCanReassign(user);
  return guarded(deps.db, async (tx) => {
    const lead = await lockExisting(tx, id, deps.orgTimezone);
    assertNotArchived(lead);
    if (input.ownerId === lead.ownerId) throw errors.conflict("The lead already has this owner");
    if (!(await growthRepo.isActiveCgo(tx, input.ownerId))) throw errors.conflict("Leads can only be assigned to an active CGO");
    await repo.updateLeadFields(tx, id, { ownerId: input.ownerId });
    await recordAudit(tx, ctx, {
      action: GROWTH_AUDIT.leadReassigned,
      entityType: "growth_lead",
      entityId: id,
      before: { ownerId: lead.ownerId },
      after: { ownerId: input.ownerId },
    });
    return reload(tx, id, deps.orgTimezone);
  });
}

export async function archiveLead(deps: LeadDeps, ctx: Ctx, user: User, id: string): Promise<LeadRow> {
  policy.assertCanManage(user);
  return guarded(deps.db, async (tx) => {
    const lead = await lockExisting(tx, id, deps.orgTimezone);
    assertNotArchived(lead);
    await assertNoActiveProposal(tx, id);
    await repo.archiveLead(tx, id);
    await recordAudit(tx, ctx, {
      action: GROWTH_AUDIT.leadArchived,
      entityType: "growth_lead",
      entityId: id,
      before: { archived: false, stage: lead.stage },
      after: { archived: true },
    });
    return reload(tx, id, deps.orgTimezone);
  });
}
