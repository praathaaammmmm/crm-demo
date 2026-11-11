import {
  canAssigneeMove,
  canCompleteFrom,
  canReviewFrom,
  canSubmitFrom,
  isOpenStatus,
  TASK_WORKFLOW,
  type TaskStatus,
} from "@crm/contracts/tasks";
import { can, type Role } from "@crm/permissions";

/**
 * Which task actions to show. Built only from the shared TASK_WORKFLOW map and the permission model;
 * the API enforces every rule again (permissions, locking, proof requirement, notes).
 */

export interface AssigneeMove {
  to: TaskStatus;
  label: string;
  needsNote: boolean;
}

export interface TaskActions {
  isAssignee: boolean;
  moves: AssigneeMove[];
  canAddUpdates: boolean;
  canSubmit: boolean;
  /** Why Submit is unavailable while the status allows it, e.g. no proof yet. */
  submitHint: string | null;
  canReview: boolean;
  canMarkComplete: boolean;
  canEdit: boolean;
  readOnly: boolean;
}

function moveLabel(from: TaskStatus, to: TaskStatus): string {
  if (to === "blocked") return "Mark blocked";
  if (to === "in_progress") return from === "todo" ? "Start" : "Resume";
  return `Move to ${TASK_WORKFLOW.statuses[to].label}`;
}

export function taskActionsFor(input: {
  role: Role;
  viewerId: string;
  task: { status: TaskStatus; assigneeId: string };
  proofCount: number;
}): TaskActions {
  const { role, viewerId, task, proofCount } = input;
  const open = isOpenStatus(task.status);
  const isAssignee = task.assigneeId === viewerId && can({ role }, "tasks:update_assigned");
  const reviewer = can({ role }, "tasks:review");

  const moves: AssigneeMove[] = isAssignee
    ? TASK_WORKFLOW.columns
        .filter((to) => canAssigneeMove(task.status, to))
        .map((to) => ({ to, label: moveLabel(task.status, to), needsNote: TASK_WORKFLOW.noteRequiredOn.includes(to) }))
    : [];

  const submittable = isAssignee && canSubmitFrom(task.status);
  return {
    isAssignee,
    moves,
    canAddUpdates: isAssignee && open,
    canSubmit: submittable && proofCount > 0,
    submitHint: submittable && proofCount === 0 ? "Add at least one proof of work before submitting." : null,
    canReview: reviewer && canReviewFrom(task.status),
    canMarkComplete: reviewer && canCompleteFrom(task.status),
    canEdit: can({ role }, "tasks:manage") && open,
    readOnly: !open,
  };
}

/** Proof links are rendered as links only when they are valid https:// URLs. */
export function isSafeProofUrl(url: string | null): url is string {
  if (url === null || !url.startsWith("https://")) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
