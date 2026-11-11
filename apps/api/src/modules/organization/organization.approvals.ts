import { roleChangePayloadSchema } from "@crm/contracts/approvals";
import type { AssignableRole } from "@crm/permissions";
import type { Ctx, Tx } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import type { ApprovalHandler, ApprovalHandlers, ApprovalTarget } from "../approvals/index.js";
import { recordAudit } from "../audit/index.js";
import { revokeUserSessions } from "../identity/index.js";
import { ORGANIZATION_AUDIT, userSnapshot } from "./organization.audit.js";
import * as repo from "./organization.repository.js";

/** Locks the target user and checks it can still be changed. The Super Admin can never be a target. */
async function lockChangeableUser(tx: Tx, target: ApprovalTarget) {
  const user = await repo.lockUser(tx, target.targetUserId);
  if (!user) throw errors.notFound();
  if (user.isSuperAdmin) throw errors.forbidden("The Super Admin cannot be changed through an approval");
  if (user.status !== "active") throw errors.conflict("The user is not active");
  return user;
}

function newRoleOf(target: ApprovalTarget): AssignableRole {
  const result = roleChangePayloadSchema.safeParse(target.payload);
  if (!result.success) throw errors.validation();
  return result.data.newRole;
}

const roleChange: ApprovalHandler = {
  async validate(tx, target) {
    const user = await lockChangeableUser(tx, target);
    if (user.role === newRoleOf(target)) throw errors.conflict("The user already has this role");
  },
  async execute(tx: Tx, ctx: Ctx, target) {
    const user = await lockChangeableUser(tx, target);
    const newRole = newRoleOf(target);
    await repo.setRole(tx, user.id, newRole);
    const sessionsRevoked = await revokeUserSessions(tx, user.id);
    await recordAudit(tx, ctx, {
      action: ORGANIZATION_AUDIT.roleChanged,
      entityType: "user",
      entityId: user.id,
      before: userSnapshot(user),
      after: { ...userSnapshot({ role: newRole, status: user.status }), sessionsRevoked },
    });
  },
};

const deactivate: ApprovalHandler = {
  async validate(tx, target) {
    await lockChangeableUser(tx, target);
  },
  async execute(tx: Tx, ctx: Ctx, target) {
    const user = await lockChangeableUser(tx, target);
    await repo.setDeactivated(tx, user.id);
    const sessionsRevoked = await revokeUserSessions(tx, user.id);
    await recordAudit(tx, ctx, {
      action: ORGANIZATION_AUDIT.deactivated,
      entityType: "user",
      entityId: user.id,
      before: userSnapshot(user),
      after: { ...userSnapshot({ role: user.role, status: "deactivated" }), sessionsRevoked },
    });
  },
};

/** Connected to the approvals module in app.ts, so approvals never imports organization. */
export const organizationApprovalHandlers: ApprovalHandlers = {
  "user.role_change": roleChange,
  "user.deactivate": deactivate,
};
