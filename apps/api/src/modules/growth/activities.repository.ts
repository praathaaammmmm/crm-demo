import { growthActivities } from "@crm/database/schema";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";

export type ActivityRow = typeof growthActivities.$inferSelect;

export async function findActivity(db: Executor, id: string): Promise<ActivityRow | null> {
  const rows = await db.select().from(growthActivities).where(eq(growthActivities.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function lockActivity(tx: Tx, id: string): Promise<ActivityRow | null> {
  const rows = await tx.select().from(growthActivities).where(eq(growthActivities.id, id)).limit(1).for("update");
  return rows[0] ?? null;
}

/** Newest first, keyset paged by (occurred_at, id). */
export function listActivities(
  db: Executor,
  filter: { leadId?: string; companyId?: string; includeVoided: boolean; cursor: string | undefined; limit: number },
) {
  const conditions: SQL[] = [];
  if (filter.leadId !== undefined) conditions.push(eq(growthActivities.leadId, filter.leadId));
  if (filter.companyId !== undefined) conditions.push(eq(growthActivities.companyId, filter.companyId));
  if (!filter.includeVoided) conditions.push(isNull(growthActivities.voidedAt));
  if (filter.cursor !== undefined) {
    conditions.push(
      sql`(${growthActivities.occurredAt}, ${growthActivities.id}) < (SELECT occurred_at, id FROM growth_activities WHERE id = ${filter.cursor})`,
    );
  }
  return db
    .select()
    .from(growthActivities)
    .where(and(...conditions))
    .orderBy(desc(growthActivities.occurredAt), desc(growthActivities.id))
    .limit(filter.limit + 1);
}

/** Explicit column list: crm_app may insert only these columns. The database derives company_id when omitted. */
export async function insertActivity(
  tx: Tx,
  input: {
    leadId: string | null;
    companyId: string | null;
    contactId: string | null;
    kind: string;
    direction: string;
    outcome: string | null;
    occurredAt: string;
    summary: string;
    proofUrl: string | null;
    authorId: string;
  },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO growth_activities (lead_id, company_id, contact_id, kind, direction, outcome, occurred_at, summary, proof_url, author_id)
    VALUES (${input.leadId}, ${input.companyId}, ${input.contactId}, ${input.kind}::growth_activity_kind,
            ${input.direction}::growth_activity_direction, ${input.outcome}::growth_activity_outcome, ${input.occurredAt}::timestamptz,
            ${input.summary}, ${input.proofUrl}, ${input.authorId})
    RETURNING id
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Activity insert returned no row");
  return row.id;
}

export async function voidActivity(tx: Tx, id: string, voidedBy: string, reason: string): Promise<void> {
  await tx.update(growthActivities).set({ voidedAt: sql`now()`, voidedBy, voidReason: reason }).where(eq(growthActivities.id, id));
}
