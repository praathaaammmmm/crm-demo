import type { CreateUserRequest, ResetAccessRequest } from "@crm/contracts/organization";
import type { PaginationQuery } from "@crm/contracts/common";
import type { Database } from "@crm/database/client";
import type { AuthSession, Ctx, Executor } from "../../platform/context.js";
import { errors, isUniqueViolation } from "../../platform/errors.js";
import { recordAudit } from "../audit/index.js";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, revokeUserSessions } from "../identity/index.js";
import { ORGANIZATION_AUDIT, userSnapshot } from "./organization.audit.js";
import * as policy from "./organization.policy.js";
import * as repo from "./organization.repository.js";
import type { UserRecord } from "./organization.repository.js";

type User = AuthSession["user"];

export const BOOTSTRAP_ROLE = "crm_migrator";
export const BOOTSTRAP_CONFIRMATION = "CREATE SUPER ADMIN";

export interface BootstrapInput {
  email: string;
  name: string;
  password: string;
  passwordConfirmation: string;
  confirmation: string;
}

/** Fails before anything is written: wrong database role or a Super Admin already exists. */
export async function assertBootstrapAllowed(db: Executor): Promise<void> {
  if ((await repo.currentDatabaseRole(db)) !== BOOTSTRAP_ROLE) {
    throw errors.forbidden(`Bootstrap must run as ${BOOTSTRAP_ROLE}`);
  }
  if (await repo.superAdminExists(db)) throw errors.conflict("A Super Admin already exists");
}

function validateBootstrapInput(input: BootstrapInput): void {
  if (input.confirmation !== BOOTSTRAP_CONFIRMATION) throw errors.validation("Confirmation was not given");
  if (input.password !== input.passwordConfirmation) throw errors.validation("Passwords do not match");
  if (input.password.length < PASSWORD_MIN_LENGTH || input.password.length > PASSWORD_MAX_LENGTH) {
    throw errors.validation(`Password must be ${String(PASSWORD_MIN_LENGTH)}-${String(PASSWORD_MAX_LENGTH)} characters`);
  }
  if (input.email !== input.email.trim().toLowerCase() || input.email.length < 3 || input.email.length > 254) {
    throw errors.validation("Email must be lower-case and 3-254 characters");
  }
  if (input.name.trim().length === 0 || input.name.length > 200) {
    throw errors.validation("Name must be 1-200 characters");
  }
}

/** Creates the one CEO/CTO Super Admin and its audit event in a single transaction. */
export async function bootstrapSuperAdmin(db: Database, input: BootstrapInput): Promise<{ userId: string }> {
  validateBootstrapInput(input);
  await assertBootstrapAllowed(db);
  const passwordHash = await hashPassword(input.password);
  const ctx: Ctx = { actor: { type: "bootstrap" }, requestId: null };

  return db.transaction(async (tx) => {
    if (await repo.superAdminExists(tx)) throw errors.conflict("A Super Admin already exists");
    const userId = await repo.insertSuperAdmin(tx, { email: input.email, name: input.name.trim(), passwordHash });
    await recordAudit(tx, ctx, {
      action: ORGANIZATION_AUDIT.superAdminBootstrapped,
      entityType: "user",
      entityId: userId,
      after: userSnapshot({ role: "ceo_cto", status: "active" }),
    });
    return { userId };
  });
}

/**
 * CEO only. Creates a user with a temporary password they must change at first login.
 * The reporting line is set to the CEO/CTO by the database.
 */
export async function createUser(db: Database, ctx: Ctx, actor: User, input: CreateUserRequest): Promise<UserRecord> {
  policy.assertCanCreateUser(actor);
  const passwordHash = await hashPassword(input.initialPassword);

  try {
    return await db.transaction(async (tx) => {
      const id = await repo.insertUser(tx, {
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash,
        createdBy: actor.id,
      });
      const created = await repo.findUserById(tx, id);
      if (!created) throw new Error("User not found after insert");
      await recordAudit(tx, ctx, {
        action: ORGANIZATION_AUDIT.userCreated,
        entityType: "user",
        entityId: id,
        after: userSnapshot(created),
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error, "users_email_unique")) throw errors.conflict("A user with this email already exists");
    throw error;
  }
}

/**
 * CEO only, never on the CEO/CTO or the caller's own account. In one transaction: replaces the password with a
 * temporary one the user must change, clears any lockout, restores a deactivated user, ends every session (with
 * attendance session_end) and records an audit event without the password, hash or email. Nothing is deleted.
 */
export async function resetAccess(
  db: Database,
  ctx: Ctx,
  actor: User,
  userId: string,
  input: ResetAccessRequest,
): Promise<UserRecord> {
  policy.assertCanResetAccess(actor);
  if (userId === actor.id) throw errors.forbidden("You cannot reset your own access");
  const passwordHash = await hashPassword(input.temporaryPassword);

  return db.transaction(async (tx) => {
    const user = await repo.lockUser(tx, userId);
    if (!user) throw errors.notFound();
    if (user.isSuperAdmin) throw errors.forbidden("The CEO/CTO account cannot be reset here");
    await repo.resetAccess(tx, user.id, passwordHash);
    const sessionsRevoked = await revokeUserSessions(tx, user.id);
    await recordAudit(tx, ctx, {
      action: ORGANIZATION_AUDIT.accessReset,
      entityType: "user",
      entityId: user.id,
      before: userSnapshot(user),
      after: { ...userSnapshot({ role: user.role, status: "active" }), mustChangePassword: true, sessionsRevoked },
    });
    const updated = await repo.findUserById(tx, user.id);
    if (!updated) throw new Error("User not found after reset");
    return updated;
  });
}

export type AssigneeCheck = "ok" | "not_found" | "inactive" | "super_admin";

/** Whether a user may be assigned work: an existing, active user who is not the CEO/CTO. */
export async function checkAssignee(db: Executor, userId: string): Promise<AssigneeCheck> {
  const user = await repo.findUserById(db, userId);
  if (!user) return "not_found";
  if (user.isSuperAdmin) return "super_admin";
  return user.status === "active" ? "ok" : "inactive";
}

export interface DirectoryEntry {
  id: string;
  name: string;
  role: UserRecord["role"];
  status: UserRecord["status"];
  email?: string;
}

/** Directory for CEO and requesters. Emails are included only for users:read_email. */
export async function listDirectory(
  db: Database,
  actor: User,
  query: PaginationQuery,
): Promise<{ items: DirectoryEntry[]; nextCursor: string | null }> {
  policy.assertCanReadDirectory(actor);
  const includeEmail = policy.canReadEmail(actor);
  const rows = await repo.listDirectory(db, { cursor: query.cursor, limit: query.limit });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(({ email, ...rest }) => (includeEmail ? { ...rest, email } : rest)),
    nextCursor: rows.length > query.limit && last ? last.id : null,
  };
}
