import { sessions, users } from "@crm/database/schema";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { AuthSession, Executor, Tx } from "../../platform/context.js";

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_MINUTES = 15;

export async function findUserForLogin(db: Executor, email: string) {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isSuperAdmin: users.isSuperAdmin,
      passwordHash: users.passwordHash,
      mustChangePassword: users.mustChangePassword,
      status: users.status,
      failedLoginCount: users.failedLoginCount,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows[0] ?? null;
}

/** Counts a failed login; the fifth consecutive failure locks the account and resets the count. */
export async function recordFailedLogin(tx: Tx, userId: string): Promise<{ justLocked: boolean }> {
  const rows = await tx
    .update(users)
    .set({
      failedLoginCount: sql`CASE WHEN ${users.failedLoginCount} + 1 >= ${LOCKOUT_THRESHOLD} THEN 0 ELSE ${users.failedLoginCount} + 1 END`,
      lockedUntil: sql`CASE WHEN ${users.failedLoginCount} + 1 >= ${LOCKOUT_THRESHOLD}
        THEN now() + make_interval(mins => ${LOCKOUT_MINUTES}) ELSE ${users.lockedUntil} END`,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, userId))
    .returning({ failedLoginCount: users.failedLoginCount });
  return { justLocked: rows[0]?.failedLoginCount === 0 };
}

export async function resetFailedLogins(tx: Tx, userId: string): Promise<void> {
  await tx
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: sql`now()` })
    .where(eq(users.id, userId));
}

// Explicit column list: crm_app may insert only user_id and token_hash; the database sets created_at and expires_at.
export async function insertSession(
  tx: Tx,
  userId: string,
  tokenHash: Buffer,
): Promise<{ id: string; expiresAt: Date }> {
  const result = await tx.execute<{ id: string; expires_at: string }>(sql`
    INSERT INTO sessions (user_id, token_hash) VALUES (${userId}, ${tokenHash})
    RETURNING id, expires_at
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Session insert returned no row");
  return { id: row.id, expiresAt: new Date(row.expires_at) };
}

/** Attendance `login` at exactly the session's database creation time. */
export async function insertLoginAttendance(tx: Tx, sessionId: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO attendance_events (user_id, session_id, kind, occurred_at)
    SELECT user_id, id, 'login'::attendance_kind, created_at FROM sessions WHERE id = ${sessionId}
  `);
}

export async function findActiveSession(db: Executor, tokenHash: Buffer): Promise<AuthSession | null> {
  const rows = await db
    .select({
      sessionId: sessions.id,
      sessionExpiresAt: sessions.expiresAt,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isSuperAdmin: users.isSuperAdmin,
      mustChangePassword: users.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.endedAt),
        gt(sessions.expiresAt, sql`now()`),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const { sessionId, sessionExpiresAt, ...user } = row;
  return { sessionId, sessionExpiresAt, user };
}

export async function findPasswordHash(db: Executor, userId: string): Promise<string | null> {
  const rows = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]?.passwordHash ?? null;
}

export async function updatePassword(tx: Tx, userId: string, passwordHash: string): Promise<void> {
  await tx
    .update(users)
    .set({ passwordHash, mustChangePassword: false, updatedAt: sql`now()` })
    .where(eq(users.id, userId));
}

/**
 * Ends a user's active, unexpired sessions as `revoked` (optionally keeping one) and records
 * attendance `session_end` at the same timestamp, in one statement. Returns how many were ended.
 */
export async function revokeSessions(tx: Tx, userId: string, exceptSessionId: string | null): Promise<number> {
  const result = await tx.execute<{ count: number }>(sql`
    WITH revoked AS (
      UPDATE sessions SET ended_at = now(), end_reason = 'revoked'
      WHERE user_id = ${userId} AND ended_at IS NULL AND expires_at > now()
        AND (${exceptSessionId}::uuid IS NULL OR id <> ${exceptSessionId}::uuid)
      RETURNING id, user_id, ended_at
    ), recorded AS (
      INSERT INTO attendance_events (user_id, session_id, kind, occurred_at)
      SELECT user_id, id, 'session_end'::attendance_kind, ended_at FROM revoked
      RETURNING 1
    )
    SELECT count(*)::int AS count FROM recorded
  `);
  return result.rows[0]?.count ?? 0;
}

/**
 * Ends an active, unexpired session as `logout` and records attendance `session_end` at the same
 * timestamp, in one statement. Already-ended or expired sessions are left unchanged.
 */
export async function endSessionAsLogout(db: Executor, tokenHash: Buffer): Promise<void> {
  await db.execute(sql`
    WITH ended AS (
      UPDATE sessions SET ended_at = now(), end_reason = 'logout'
      WHERE token_hash = ${tokenHash} AND ended_at IS NULL AND expires_at > now()
      RETURNING id, user_id, ended_at
    )
    INSERT INTO attendance_events (user_id, session_id, kind, occurred_at)
    SELECT user_id, id, 'session_end'::attendance_kind, ended_at FROM ended
  `);
}
