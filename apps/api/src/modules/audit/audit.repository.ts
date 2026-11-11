import { sql } from "drizzle-orm";
import type { Tx } from "../../platform/context.js";

export interface AuditRow {
  actorType: "user" | "system" | "bootstrap" | "anonymous";
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  requestId: string | null;
}

const toJson = (value: Record<string, unknown> | null) => (value === null ? null : JSON.stringify(value));

// Explicit column list: crm_app may insert only these columns (id and occurred_at come from the database).
export async function insertAuditEvent(tx: Tx, row: AuditRow): Promise<void> {
  await tx.execute(sql`
    INSERT INTO audit_events (actor_type, actor_user_id, action, entity_type, entity_id, before, after, request_id)
    VALUES (${row.actorType}::audit_actor_type, ${row.actorUserId}, ${row.action}, ${row.entityType}, ${row.entityId},
            ${toJson(row.before)}::jsonb, ${toJson(row.after)}::jsonb, ${row.requestId})
  `);
}
