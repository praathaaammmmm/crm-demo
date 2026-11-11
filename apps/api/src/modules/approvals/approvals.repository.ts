import { approvalRequests } from "@crm/database/schema";
import type { ApprovalType } from "@crm/permissions";
import { and, asc, eq, gt, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";

export type ApprovalRow = typeof approvalRequests.$inferSelect;
export type ApprovalStatus = ApprovalRow["status"];

// Explicit column list: crm_app may insert only these columns.
export async function insertRequest(
  tx: Tx,
  input: {
    type: ApprovalType;
    targetUserId: string;
    payload: Record<string, unknown>;
    reason: string;
    requestedBy: string;
  },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO approval_requests (type, target_user_id, payload, reason, requested_by)
    VALUES (${input.type}::approval_type, ${input.targetUserId}, ${JSON.stringify(input.payload)}::jsonb,
            ${input.reason}, ${input.requestedBy})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Approval insert returned no row");
  return row.id;
}

export async function findById(db: Executor, id: string): Promise<ApprovalRow | null> {
  const rows = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Locks the request row until the transaction ends, so two decisions cannot race. */
export async function findByIdForUpdate(tx: Tx, id: string): Promise<ApprovalRow | null> {
  const rows = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1).for("update");
  return rows[0] ?? null;
}

export async function markDecided(
  tx: Tx,
  id: string,
  decision: { status: Exclude<ApprovalStatus, "pending">; decidedBy: string | null; decisionNote: string | null },
): Promise<ApprovalRow> {
  const rows = await tx
    .update(approvalRequests)
    .set({
      status: decision.status,
      decidedBy: decision.decidedBy,
      decidedAt: sql`now()`,
      decisionNote: decision.decisionNote,
    })
    .where(eq(approvalRequests.id, id))
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Approval update returned no row");
  return row;
}

export async function list(
  db: Executor,
  filter: { requestedBy: string | null; status: ApprovalStatus | undefined; cursor: string | undefined; limit: number },
): Promise<ApprovalRow[]> {
  const conditions: SQL[] = [];
  if (filter.requestedBy !== null) conditions.push(eq(approvalRequests.requestedBy, filter.requestedBy));
  if (filter.status !== undefined) conditions.push(eq(approvalRequests.status, filter.status));
  if (filter.cursor !== undefined) conditions.push(gt(approvalRequests.id, filter.cursor));
  return db
    .select()
    .from(approvalRequests)
    .where(and(...conditions))
    .orderBy(asc(approvalRequests.id))
    .limit(filter.limit + 1);
}
