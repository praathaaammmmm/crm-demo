import { canMoveStage, isOpenStage, OPEN_STAGES, type GrowthStage, type OpenStage } from "@crm/contracts/growth-leads";
import { can, type Role } from "@crm/permissions";

/** UI visibility only for Growth leads and activities. The API and database enforce every rule again. */

export interface LeadActions {
  canEdit: boolean;
  canMove: boolean;
  /** Open stages the lead can move to (never its current stage, never won). */
  moveTargets: OpenStage[];
  canMarkLost: boolean;
  canArchive: boolean;
  canLogActivity: boolean;
  canReopen: boolean;
  canReassign: boolean;
  readOnly: boolean;
}

interface LeadState {
  stage: GrowthStage;
  archivedAt: string | null;
}

export const canCreateLead = (role: Role): boolean => can({ role }, "growth:manage");

export function leadActionsFor(input: { role: Role; lead: LeadState }): LeadActions {
  const manager = can({ role: input.role }, "growth:manage");
  const archived = input.lead.archivedAt !== null;
  const open = isOpenStage(input.lead.stage);
  const write = manager && !archived && open;
  return {
    canEdit: write,
    canMove: write,
    moveTargets: write ? OPEN_STAGES.filter((stage) => canMoveStage(input.lead.stage, stage)) : [],
    canMarkLost: write,
    canArchive: manager && !archived,
    canLogActivity: write,
    canReopen: can({ role: input.role }, "growth:reopen") && !archived && input.lead.stage === "lost",
    canReassign: can({ role: input.role }, "growth:reassign") && !archived,
    readOnly: archived || !open,
  };
}

/** Activities: CGO logs and voids; voiding happens once. */
export function activityActionsFor(input: { role: Role; activity: { voidedAt: string | null } }): { canVoid: boolean } {
  return { canVoid: can({ role: input.role }, "growth:manage") && input.activity.voidedAt === null };
}
