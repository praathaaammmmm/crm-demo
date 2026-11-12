import type { IncidentSeverity, IncidentStatus } from "@crm/contracts/operations";
import { opsIncidents, opsIncidentUpdates } from "@crm/database/schema";
import { and, asc, eq, ne, sql, type SQL } from "drizzle-orm";
import type { Executor, Tx } from "../../platform/context.js";
import { insertedId } from "./inserted-id.js";

export type IncidentRow = typeof opsIncidents.$inferSelect;
export type IncidentUpdateRow = typeof opsIncidentUpdates.$inferSelect;

export async function findIncident(db: Executor, id: string): Promise<IncidentRow | null> {
  const rows = await db.select().from(opsIncidents).where(eq(opsIncidents.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function lockIncident(tx: Tx, id: string): Promise<IncidentRow | null> {
  const rows = await tx.select().from(opsIncidents).where(eq(opsIncidents.id, id)).limit(1).for("update");
  return rows[0] ?? null;
}

export function listIncidents(
  db: Executor,
  filter: { status: IncidentStatus | undefined; severity: IncidentSeverity | undefined; open: boolean | undefined; cursor: string | undefined; limit: number },
) {
  const conditions: SQL[] = [];
  if (filter.status !== undefined) conditions.push(eq(opsIncidents.status, filter.status));
  if (filter.severity !== undefined) conditions.push(eq(opsIncidents.severity, filter.severity));
  if (filter.open === true) conditions.push(ne(opsIncidents.status, "resolved"));
  if (filter.open === false) conditions.push(eq(opsIncidents.status, "resolved"));
  if (filter.cursor !== undefined) conditions.push(sql`${opsIncidents.id} > ${filter.cursor}`);
  return db
    .select()
    .from(opsIncidents)
    .where(and(...conditions))
    .orderBy(asc(opsIncidents.id))
    .limit(filter.limit + 1);
}

/** Owners must be active users. */
export async function isActiveUser(db: Executor, userId: string): Promise<boolean> {
  const result = await db.execute<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM users WHERE id = ${userId} AND status = 'active') AS ok`);
  return result.rows[0]?.ok === true;
}

export async function insertIncident(
  tx: Tx,
  input: { title: string; severity: IncidentSeverity; ownerId: string; summary: string | null; startedAt: Date | undefined; createdBy: string },
): Promise<string> {
  // started_at falls back to the column default (now()) when not given.
  const startedAt = input.startedAt === undefined ? sql`DEFAULT` : sql`${input.startedAt.toISOString()}::timestamptz`;
  const result = await tx.execute<{ id: string }>(sql`
    INSERT INTO ops_incidents (title, severity, owner_id, summary, started_at, created_by)
    VALUES (${input.title}, ${input.severity}::ops_incident_severity, ${input.ownerId}, ${input.summary}, ${startedAt}, ${input.createdBy})
    RETURNING id
  `);
  return insertedId(result.rows, "Incident");
}

export async function updateIncident(
  tx: Tx,
  id: string,
  fields: Partial<Pick<typeof opsIncidents.$inferInsert, "title" | "severity" | "ownerId" | "summary" | "status" | "resolution" | "postIncidentNote">> & {
    resolve?: boolean;
  },
): Promise<void> {
  const { resolve, ...columns } = fields;
  await tx
    .update(opsIncidents)
    .set({ ...columns, ...(resolve ? { resolvedAt: sql`now()` } : {}), updatedAt: sql`now()` })
    .where(eq(opsIncidents.id, id));
}

export async function insertIncidentUpdate(
  tx: Tx,
  input: { incidentId: string; kind: "note" | "status"; fromStatus: IncidentStatus | null; toStatus: IncidentStatus | null; note: string | null; actorId: string },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO ops_incident_updates (incident_id, kind, from_status, to_status, note, actor_id)
    VALUES (${input.incidentId}, ${input.kind}::ops_incident_entry_kind, ${input.fromStatus}::ops_incident_status,
            ${input.toStatus}::ops_incident_status, ${input.note}, ${input.actorId})
  `);
}

/** Oldest first. */
export function timeline(db: Executor, incidentId: string): Promise<IncidentUpdateRow[]> {
  return db.select().from(opsIncidentUpdates).where(eq(opsIncidentUpdates.incidentId, incidentId)).orderBy(asc(opsIncidentUpdates.createdAt), asc(opsIncidentUpdates.id));
}
