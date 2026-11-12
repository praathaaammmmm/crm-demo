import {
  canMoveIncident,
  type CreateIncidentRequest,
  type IncidentListQuery,
  type IncidentStatusRequest,
  type UpdateIncidentRequest,
} from "@crm/contracts/operations";
import type { Database } from "@crm/database/client";
import type { AuthSession, Ctx, Tx } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { defined } from "../../platform/defined.js";
import { guardedTransaction, pageOf } from "../../platform/transactions.js";
import { recordAudit } from "../audit/index.js";
import * as repo from "./incidents.repository.js";
import type { IncidentRow, IncidentUpdateRow } from "./incidents.repository.js";
import { changedFlags, OPERATIONS_AUDIT } from "./operations.audit.js";
import * as policy from "./operations.policy.js";

type User = AuthSession["user"];

export interface OperationsDeps {
  db: Database;
}

const ENTITY = "ops_incident";
const FIELDS = ["title", "severity", "ownerId", "summary"] as const;

async function lockExisting(tx: Tx, id: string): Promise<IncidentRow> {
  const incident = await repo.lockIncident(tx, id);
  if (!incident) throw errors.notFound();
  return incident;
}

async function reload(tx: Tx, id: string): Promise<IncidentRow> {
  const incident = await repo.findIncident(tx, id);
  if (!incident) throw new Error("Incident not found after change");
  return incident;
}

async function assertOwner(db: Database | Tx, ownerId: string): Promise<void> {
  if (!(await repo.isActiveUser(db, ownerId))) throw errors.conflict("The owner must be an active user");
}

const assertOpen = (incident: IncidentRow) => {
  if (incident.status === "resolved") throw errors.conflict("A resolved incident is closed");
};

export async function listIncidents(deps: OperationsDeps, user: User, query: IncidentListQuery) {
  policy.assertCanRead(user);
  const rows = await repo.listIncidents(deps.db, {
    status: query.status,
    severity: query.severity,
    open: query.open === undefined ? undefined : query.open === "true",
    cursor: query.cursor,
    limit: query.limit,
  });
  return pageOf(rows, query.limit);
}

export async function getIncident(deps: OperationsDeps, user: User, id: string): Promise<{ incident: IncidentRow; timeline: IncidentUpdateRow[] }> {
  policy.assertCanRead(user);
  const incident = await repo.findIncident(deps.db, id);
  if (!incident) throw errors.notFound();
  return { incident, timeline: await repo.timeline(deps.db, id) };
}

/** VP only. A start time may be in the past (the incident was noticed late) but not in the future. */
export async function createIncident(deps: OperationsDeps, ctx: Ctx, user: User, input: CreateIncidentRequest): Promise<IncidentRow> {
  policy.assertCanManage(user);
  const startedAt = input.startedAt === undefined ? undefined : new Date(input.startedAt);
  if (startedAt !== undefined && startedAt.getTime() > Date.now() + 5 * 60_000) throw errors.validation("The start time cannot be in the future");
  await assertOwner(deps.db, input.ownerId);
  return guardedTransaction(deps.db, async (tx) => {
    const id = await repo.insertIncident(tx, {
      title: input.title,
      severity: input.severity,
      ownerId: input.ownerId,
      summary: input.summary ?? null,
      startedAt,
      createdBy: user.id,
    });
    const incident = await reload(tx, id);
    await recordAudit(tx, ctx, {
      action: OPERATIONS_AUDIT.incidentCreated,
      entityType: ENTITY,
      entityId: id,
      after: { severity: incident.severity, status: incident.status, ownerId: incident.ownerId },
    });
    return incident;
  });
}

export async function updateIncident(deps: OperationsDeps, ctx: Ctx, user: User, id: string, input: UpdateIncidentRequest): Promise<IncidentRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const before = await lockExisting(tx, id);
    assertOpen(before);
    if (input.ownerId !== undefined && input.ownerId !== before.ownerId) await assertOwner(tx, input.ownerId);
    await repo.updateIncident(tx, id, defined(input));
    const after = await reload(tx, id);
    await recordAudit(tx, ctx, {
      action: OPERATIONS_AUDIT.incidentUpdated,
      entityType: ENTITY,
      entityId: id,
      before: { severity: before.severity, ownerId: before.ownerId },
      after: { severity: after.severity, ownerId: after.ownerId, ...changedFlags(before, after, FIELDS) },
    });
    return after;
  });
}

/** Each status change appends a timeline entry in the same transaction. Resolving stores the resolution. */
export async function moveIncident(deps: OperationsDeps, ctx: Ctx, user: User, id: string, input: IncidentStatusRequest): Promise<IncidentRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const before = await lockExisting(tx, id);
    if (!canMoveIncident(before.status, input.to)) throw errors.conflict("This incident cannot move to that status");
    const resolving = input.to === "resolved";
    await repo.updateIncident(tx, id, { status: input.to, ...(resolving ? { resolution: input.resolution ?? null, resolve: true } : {}) });
    await repo.insertIncidentUpdate(tx, { incidentId: id, kind: "status", fromStatus: before.status, toStatus: input.to, note: input.note ?? null, actorId: user.id });
    await recordAudit(tx, ctx, {
      action: OPERATIONS_AUDIT.incidentStatusChanged,
      entityType: ENTITY,
      entityId: id,
      before: { status: before.status },
      after: { status: input.to, noteAdded: input.note !== undefined },
    });
    return reload(tx, id);
  });
}

/** Timeline notes are append-only and allowed until the incident is resolved. */
export async function addNote(deps: OperationsDeps, ctx: Ctx, user: User, id: string, note: string): Promise<IncidentRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const incident = await lockExisting(tx, id);
    assertOpen(incident);
    await repo.insertIncidentUpdate(tx, { incidentId: id, kind: "note", fromStatus: null, toStatus: null, note, actorId: user.id });
    await recordAudit(tx, ctx, { action: OPERATIONS_AUDIT.incidentNoteAdded, entityType: ENTITY, entityId: id, after: { status: incident.status } });
    return incident;
  });
}

/** The post-incident note is written once, after resolution. */
export async function addPostIncidentNote(deps: OperationsDeps, ctx: Ctx, user: User, id: string, note: string): Promise<IncidentRow> {
  policy.assertCanManage(user);
  return guardedTransaction(deps.db, async (tx) => {
    const before = await lockExisting(tx, id);
    if (before.status !== "resolved") throw errors.conflict("Resolve the incident first");
    if (before.postIncidentNote !== null) throw errors.conflict("The post-incident note is already recorded");
    await repo.updateIncident(tx, id, { postIncidentNote: note });
    await recordAudit(tx, ctx, { action: OPERATIONS_AUDIT.incidentPostNoteAdded, entityType: ENTITY, entityId: id, after: { postIncidentNote: true } });
    return reload(tx, id);
  });
}
