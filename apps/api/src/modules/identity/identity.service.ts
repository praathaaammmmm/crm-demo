import type { Database } from "@crm/database/client";
import type { ChangePasswordRequest, LoginRequest } from "@crm/contracts/identity";
import type { AuthSession, Ctx, Tx } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { recordAudit } from "../audit/index.js";
import { IDENTITY_AUDIT } from "./identity.audit.js";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyAgainstDummy,
  verifyPassword,
} from "./identity.crypto.js";
import * as repo from "./identity.repository.js";

/** One message for every login failure, so callers cannot learn which part was wrong. */
const invalidCredentials = () => errors.unauthenticated("Invalid email or password");

export interface LoginResult {
  /** Raw session token: only ever placed in the HttpOnly cookie. */
  token: string;
  session: AuthSession;
}

/**
 * `countFailures: false` (public demo only) skips the failed-attempt counter and lockout so anyone can't
 * lock the shared demo accounts; the per-IP login rate limit still applies.
 */
export async function login(
  db: Database,
  ctx: Ctx,
  input: LoginRequest,
  options: { countFailures: boolean } = { countFailures: true },
): Promise<LoginResult> {
  const user = await repo.findUserForLogin(db, input.email);
  if (!user) {
    await verifyAgainstDummy(input.password);
    throw invalidCredentials();
  }

  const passwordMatches = await verifyPassword(user.passwordHash, input.password);
  const locked = user.lockedUntil !== null && user.lockedUntil > new Date();
  if (locked || user.status !== "active") throw invalidCredentials();

  if (!passwordMatches) {
    if (!options.countFailures) throw invalidCredentials();
    await db.transaction(async (tx) => {
      const { justLocked } = await repo.recordFailedLogin(tx, user.id);
      if (justLocked) {
        await recordAudit(tx, { actor: { type: "anonymous" }, requestId: ctx.requestId }, {
          action: IDENTITY_AUDIT.accountLocked,
          entityType: "user",
          entityId: user.id,
        });
      }
    });
    throw invalidCredentials();
  }

  const { token, tokenHash } = createSessionToken();
  const session = await db.transaction(async (tx) => {
    if (user.failedLoginCount > 0 || user.lockedUntil !== null) await repo.resetFailedLogins(tx, user.id);
    const created = await repo.insertSession(tx, user.id, tokenHash);
    await repo.insertLoginAttendance(tx, created.id);
    return created;
  });

  return {
    token,
    session: {
      sessionId: session.id,
      sessionExpiresAt: session.expiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin,
        mustChangePassword: user.mustChangePassword,
      },
    },
  };
}

/** Looks up an active session for a cookie value. Read-only: records no activity. */
export async function resolveSession(db: Database, token: string | undefined): Promise<AuthSession | null> {
  const tokenHash = hashSessionToken(token);
  return tokenHash ? repo.findActiveSession(db, tokenHash) : null;
}

/**
 * Replaces the caller's password, clears the must-change flag, and ends every other session.
 * The current session stays valid.
 */
export async function changePassword(
  db: Database,
  ctx: Ctx,
  session: AuthSession,
  input: ChangePasswordRequest,
): Promise<void> {
  const currentHash = await repo.findPasswordHash(db, session.user.id);
  if (currentHash === null) throw errors.unauthenticated();
  if (!(await verifyPassword(currentHash, input.currentPassword))) {
    throw errors.validation("Current password is incorrect");
  }

  const newHash = await hashPassword(input.newPassword);
  await db.transaction(async (tx) => {
    await repo.updatePassword(tx, session.user.id, newHash);
    await repo.revokeSessions(tx, session.user.id, session.sessionId);
    await recordAudit(tx, ctx, {
      action: IDENTITY_AUDIT.passwordChanged,
      entityType: "user",
      entityId: session.user.id,
    });
  });
}

/**
 * Ends all of a user's active sessions with attendance `session_end`, inside the caller's transaction.
 * Used when a user's role or status changes.
 */
export function revokeUserSessions(tx: Tx, userId: string): Promise<number> {
  return repo.revokeSessions(tx, userId, null);
}

/** Idempotent: an unknown, ended or expired session is left unchanged. */
export async function logout(db: Database, token: string | undefined): Promise<void> {
  const tokenHash = hashSessionToken(token);
  if (tokenHash) await repo.endSessionAsLogout(db, tokenHash);
}
