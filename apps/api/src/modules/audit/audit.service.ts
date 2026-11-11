import type { Ctx, Tx } from "../../platform/context.js";
import { insertAuditEvent } from "./audit.repository.js";

export interface AuditEventInput {
  action: string;
  entityType: string;
  entityId: string | null;
  /** Must come from the owning module's allowlisted snapshot function. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * Records an append-only audit event. Requires the caller's transaction, so the event
 * commits or rolls back together with the change it describes.
 */
export async function recordAudit(tx: Tx, ctx: Ctx, event: AuditEventInput): Promise<void> {
  await insertAuditEvent(tx, {
    actorType: ctx.actor.type,
    actorUserId: ctx.actor.type === "user" ? ctx.actor.userId : null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    before: event.before ?? null,
    after: event.after ?? null,
    requestId: ctx.requestId,
  });
}
