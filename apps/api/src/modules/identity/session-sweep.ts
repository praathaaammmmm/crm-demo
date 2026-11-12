import { sql } from "drizzle-orm";
import type { Handler } from "../../platform/worker/handlers.js";

/**
 * identity.session_expiry_sweep: ends expired sessions at their configured expiry time (not the time the
 * sweep runs) and records attendance session_end at that same time. Running it again changes nothing.
 */
export const sessionExpirySweepHandler: Handler = async (tx) => {
  await tx.execute(sql`
    WITH due AS (
      SELECT id FROM sessions
      WHERE ended_at IS NULL AND expires_at <= now()
      ORDER BY expires_at
      LIMIT 500
      FOR UPDATE SKIP LOCKED
    ), ended AS (
      UPDATE sessions s SET ended_at = s.expires_at, end_reason = 'expired'
      FROM due WHERE s.id = due.id
      RETURNING s.id, s.user_id, s.expires_at
    )
    INSERT INTO attendance_events (session_id, user_id, kind, occurred_at)
    SELECT id, user_id, 'session_end'::attendance_kind, expires_at FROM ended
    ON CONFLICT DO NOTHING
  `);
  return "done";
};
