import {
  DEFECT_STATUSES,
  canAssigneeMoveDefect,
  canManagerMoveDefect,
  defectMoveNeedsNote,
  isFinalDefect,
  type DefectStatus,
} from "@crm/contracts/quality";
import { can, type Role } from "@crm/permissions";

/** UI visibility only, driven by DEFECT_WORKFLOW. The API enforces every rule again. */

export interface DefectMove {
  to: DefectStatus;
  label: string;
  needsNote: boolean;
  /** The single primary action for this viewer, if any. */
  primary: boolean;
}

export interface DefectActions {
  moves: DefectMove[];
  canRespond: boolean;
  canEdit: boolean;
  readOnly: boolean;
  /** Shown when a manager is looking at a defect in their own task. */
  ownTaskNotice: boolean;
}

/**
 * Self-QA conflict: a quality manager acts only as an assignee on quality items of a task assigned to
 * them. The CEO/CTO can never be an assignee, so is never affected.
 */
export function canManageQualityFor(input: { role: Role; viewerId: string; assigneeId: string }): boolean {
  return can({ role: input.role }, "quality:manage") && input.assigneeId !== input.viewerId;
}

const MOVE_LABELS: Record<DefectStatus, string> = {
  open: "Reopen",
  in_progress: "Start fix",
  fixed: "Mark fixed",
  verified: "Verify fix",
  wont_fix: "Won't fix",
};

const PRIMARY: readonly DefectStatus[] = ["in_progress", "fixed", "verified"];

export function defectActionsFor(input: {
  role: Role;
  viewerId: string;
  defect: { status: DefectStatus; assigneeId: string };
}): DefectActions {
  const { role, viewerId, defect } = input;
  const subject = { role };
  const isAssignee = defect.assigneeId === viewerId && can(subject, "quality:respond_assigned");
  const isManager = can(subject, "quality:manage");
  const readOnly = isFinalDefect(defect.status);
  const ownTask = defect.assigneeId === viewerId;
  const managesThis = canManageQualityFor({ role, viewerId, assigneeId: defect.assigneeId });

  const moves: DefectMove[] = readOnly
    ? []
    : DEFECT_STATUSES.filter(
        (to) =>
          (isAssignee && canAssigneeMoveDefect(defect.status, to)) ||
          (managesThis && canManagerMoveDefect(defect.status, to)),
      ).map((to) => ({
        to,
        label: MOVE_LABELS[to],
        needsNote: defectMoveNeedsNote(defect.status, to),
        primary: PRIMARY.includes(to),
      }));

  return {
    moves,
    canRespond: !readOnly && (isAssignee || isManager),
    canEdit: !readOnly && managesThis,
    readOnly,
    ownTaskNotice: !readOnly && isManager && ownTask,
  };
}
