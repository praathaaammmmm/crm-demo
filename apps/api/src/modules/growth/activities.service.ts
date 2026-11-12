import { isOpenStage, type ActivityListQuery, type LogActivityRequest } from "@crm/contracts/growth-leads";
import type { AuthSession, Ctx, Tx } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { recordAudit } from "../audit/index.js";
import * as repo from "./activities.repository.js";
import type { ActivityRow } from "./activities.repository.js";
import { GROWTH_AUDIT } from "./growth.audit.js";
import * as policy from "./growth.policy.js";
import * as growthRepo from "./growth.repository.js";
import { guarded, page } from "./growth.service.js";
import * as leadsRepo from "./leads.repository.js";
import { assertFollowUpNotPast, type LeadDeps } from "./leads.service.js";

type User = AuthSession["user"];

const MINUTE_MS = 60_000;

/**
 * The canonical link rule, checked before writing (409); the database trigger enforces the same rule.
 * Returns the company to store: the one company implied by the lead, company and contact, if any.
 */
async function resolveCompany(tx: Tx, input: LogActivityRequest, timeZone: string): Promise<string | null> {
  let leadCompany: string | null = null;
  let leadWithoutCompany = false;
  if (input.leadId !== undefined) {
    const lead = await leadsRepo.findLead(tx, input.leadId, timeZone);
    if (!lead) throw errors.notFound();
    if (lead.archivedAt !== null) throw errors.conflict("Activities cannot be logged on an archived lead");
    leadCompany = lead.companyId;
    leadWithoutCompany = lead.companyId === null;
  }
  let contactCompany: string | null = null;
  if (input.contactId !== undefined) {
    const contact = await growthRepo.findContact(tx, input.contactId);
    if (!contact) throw errors.notFound();
    if (contact.archivedAt !== null || contact.companyArchived) throw errors.conflict("Activities cannot be logged for an archived contact");
    if (input.direction === "outbound" && contact.doNotContact) throw errors.conflict("This contact is marked do not contact");
    contactCompany = contact.companyId;
  }
  if (leadWithoutCompany) {
    if (input.direction !== "inbound" || input.contactId !== undefined || input.companyId !== undefined) {
      throw errors.conflict("A lead with no company allows only inbound activity without a contact");
    }
    return null;
  }
  const candidates = [...new Set([leadCompany, input.companyId ?? null, contactCompany].filter((value): value is string => value !== null))];
  if (candidates.length > 1) throw errors.conflict("The lead, company and contact belong to different companies");
  const companyId = candidates[0] ?? null;
  if (companyId !== null) {
    const company = await growthRepo.findCompany(tx, companyId);
    if (!company) throw errors.notFound();
    if (company.archivedAt !== null) throw errors.conflict("Activities cannot be logged for an archived company");
  }
  return companyId;
}

/** CGO only. Optionally sets the lead's next follow-up date in the same transaction. */
export async function logActivity(deps: LeadDeps, ctx: Ctx, user: User, input: LogActivityRequest): Promise<ActivityRow> {
  policy.assertCanManage(user);
  const occurred = Date.parse(input.occurredAt);
  if (occurred > Date.now() + 5 * MINUTE_MS) throw errors.validation("The activity time cannot be in the future");
  if (occurred < Date.now() - 365 * 24 * 60 * MINUTE_MS) throw errors.validation("The activity time is more than a year ago");
  if (input.nextFollowUpOn !== undefined) await assertFollowUpNotPast(deps.db, input.nextFollowUpOn, deps.orgTimezone);

  return guarded(deps.db, async (tx) => {
    const companyId = await resolveCompany(tx, input, deps.orgTimezone);
    let followUpChanged = false;
    if (input.leadId !== undefined && input.nextFollowUpOn !== undefined) {
      const lead = await leadsRepo.lockLead(tx, input.leadId, deps.orgTimezone);
      if (!lead) throw errors.notFound();
      if (!isOpenStage(lead.stage)) throw errors.conflict("Follow-ups can only be set on open leads");
      if (lead.nextFollowUpOn !== input.nextFollowUpOn) {
        await leadsRepo.updateLeadFields(tx, lead.id, { nextFollowUpOn: input.nextFollowUpOn });
        followUpChanged = true;
      }
    }
    const id = await repo.insertActivity(tx, {
      leadId: input.leadId ?? null,
      companyId,
      contactId: input.contactId ?? null,
      kind: input.kind,
      direction: input.direction,
      outcome: input.outcome ?? null,
      occurredAt: input.occurredAt,
      summary: input.summary,
      proofUrl: input.proofUrl ?? null,
      authorId: user.id,
    });
    await recordAudit(tx, ctx, {
      action: GROWTH_AUDIT.activityLogged,
      entityType: "growth_activity",
      entityId: id,
      after: {
        leadId: input.leadId ?? null,
        companyId,
        contactId: input.contactId ?? null,
        kind: input.kind,
        direction: input.direction,
        outcome: input.outcome ?? null,
        hasProof: input.proofUrl !== undefined,
        followUpChanged,
      },
    });
    const activity = await repo.findActivity(tx, id);
    if (!activity) throw new Error("Activity not found after insert");
    return activity;
  });
}

/** CGO only, once, with a reason. The activity stays visible as voided. */
export async function voidActivity(deps: LeadDeps, ctx: Ctx, user: User, id: string, reason: string): Promise<ActivityRow> {
  policy.assertCanManage(user);
  return guarded(deps.db, async (tx) => {
    const activity = await repo.lockActivity(tx, id);
    if (!activity) throw errors.notFound();
    if (activity.voidedAt !== null) throw errors.conflict("This activity is already voided");
    await repo.voidActivity(tx, id, user.id, reason);
    await recordAudit(tx, ctx, { action: GROWTH_AUDIT.activityVoided, entityType: "growth_activity", entityId: id, after: { voided: true } });
    const after = await repo.findActivity(tx, id);
    if (!after) throw new Error("Activity not found after void");
    return after;
  });
}

export async function listForLead(deps: LeadDeps, user: User, leadId: string, query: ActivityListQuery) {
  policy.assertCanReadActivities(user);
  if (!(await leadsRepo.findLead(deps.db, leadId, deps.orgTimezone))) throw errors.notFound();
  const rows = await repo.listActivities(deps.db, { leadId, includeVoided: query.includeVoided !== "false", cursor: query.cursor, limit: query.limit });
  return page(rows, query.limit);
}

export async function listForCompany(deps: LeadDeps, user: User, companyId: string, query: ActivityListQuery) {
  policy.assertCanReadActivities(user);
  if (!(await growthRepo.findCompany(deps.db, companyId))) throw errors.notFound();
  const rows = await repo.listActivities(deps.db, {
    companyId,
    includeVoided: query.includeVoided !== "false",
    cursor: query.cursor,
    limit: query.limit,
  });
  return page(rows, query.limit);
}
