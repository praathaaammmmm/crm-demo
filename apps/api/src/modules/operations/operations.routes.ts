import {
  addChecklistItemRequestSchema,
  automationDetailResponseSchema,
  automationListQuerySchema,
  automationPageSchema,
  automationResponseSchema,
  automationRunResponseSchema,
  automationStatusRequestSchema,
  checklistItemRequestSchema,
  checklistItemResponseSchema,
  createAutomationRequestSchema,
  createIncidentRequestSchema,
  createReleaseRequestSchema,
  idParamsSchema,
  incidentDetailResponseSchema,
  incidentListQuerySchema,
  incidentNoteRequestSchema,
  incidentPageSchema,
  incidentResponseSchema,
  incidentStatusRequestSchema,
  operationsSummarySchema,
  postIncidentRequestSchema,
  recordRunRequestSchema,
  releaseDecisionRequestSchema,
  releaseDetailResponseSchema,
  releaseListQuerySchema,
  releasePageSchema,
  releaseResponseSchema,
  updateAutomationRequestSchema,
  updateIncidentRequestSchema,
  updateReleaseRequestSchema,
  type Automation,
  type AutomationChange,
  type AutomationRun,
  type ChecklistItem,
  type Incident,
  type IncidentUpdate,
  type Release,
  type ReleaseDecision,
} from "@crm/contracts/operations";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { authOf, contextFrom, type requireSession } from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import type { AutomationRow, ChangeRow, RunRow } from "./automations.repository.js";
import * as automations from "./automations.service.js";
import type { IncidentRow, IncidentUpdateRow } from "./incidents.repository.js";
import * as incidents from "./incidents.service.js";
import { summary } from "./operations.service.js";
import * as policy from "./operations.policy.js";
import type { ChecklistRow, DecisionRow, ReleaseRow } from "./releases.repository.js";
import * as releases from "./releases.service.js";

export interface OperationsRouteOptions extends incidents.OperationsDeps {
  requireUser: ReturnType<typeof requireSession>;
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

// Explicit allowlists of response fields.

const incidentBody = (row: IncidentRow): Incident => ({
  id: row.id,
  title: row.title,
  severity: row.severity,
  status: row.status,
  ownerId: row.ownerId,
  summary: row.summary,
  startedAt: row.startedAt.toISOString(),
  resolvedAt: iso(row.resolvedAt),
  resolution: row.resolution,
  postIncidentNote: row.postIncidentNote,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const updateBody = (row: IncidentUpdateRow): IncidentUpdate => ({
  id: row.id,
  kind: row.kind,
  fromStatus: row.fromStatus,
  toStatus: row.toStatus,
  note: row.note,
  actorId: row.actorId,
  createdAt: row.createdAt.toISOString(),
});

const releaseBody = (row: ReleaseRow): Release => ({
  id: row.id,
  name: row.name,
  versionLabel: row.versionLabel,
  environment: row.environment,
  status: row.status,
  plannedFor: row.plannedFor,
  notes: row.notes,
  checklistTotal: row.checklistTotal,
  checklistDone: row.checklistDone,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const checklistBody = (row: ChecklistRow): ChecklistItem => ({
  id: row.id,
  label: row.label,
  done: row.done,
  doneBy: row.doneBy,
  doneAt: iso(row.doneAt),
  createdAt: row.createdAt.toISOString(),
});

const decisionBody = (row: DecisionRow): ReleaseDecision => ({
  id: row.id,
  fromStatus: row.fromStatus,
  toStatus: row.toStatus,
  note: row.note,
  actorId: row.actorId,
  createdAt: row.createdAt.toISOString(),
});

const automationBody = (row: AutomationRow): Automation => ({
  id: row.id,
  name: row.name,
  purpose: row.purpose,
  trigger: row.triggerDescription,
  status: row.status,
  health: automations.healthOf(row),
  lastRunAt: row.lastRunAt,
  failuresLast30Days: row.failuresLast30Days,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const runBody = (row: RunRow): AutomationRun => ({
  id: row.id,
  startedAt: row.startedAt.toISOString(),
  finishedAt: row.finishedAt.toISOString(),
  outcome: row.outcome,
  errorSummary: row.errorSummary,
  recordedBy: row.recordedBy,
  createdAt: row.createdAt.toISOString(),
});

const changeBody = (row: ChangeRow): AutomationChange => ({
  id: row.id,
  fromStatus: row.fromStatus,
  toStatus: row.toStatus,
  note: row.note,
  actorId: row.actorId,
  createdAt: row.createdAt.toISOString(),
});

/** Permission first (403), then a malformed id is reported as 404, like an unknown one. */
function idFrom(request: FastifyRequest, permission: (user: AuthSession["user"]) => void): string {
  permission(authOf(request).user);
  const result = idParamsSchema.safeParse(request.params);
  if (!result.success) throw errors.notFound();
  return result.data.id;
}

/** Registered with the /api/v1/operations prefix. */
export function operationsRoutes({ requireUser, ...deps }: OperationsRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    const user = (request: FastifyRequest) => authOf(request).user;
    const incident = (row: IncidentRow) => toResponse(incidentResponseSchema, { incident: incidentBody(row) });
    const release = (row: ReleaseRow) => toResponse(releaseResponseSchema, { release: releaseBody(row) });
    const automation = (row: AutomationRow) => toResponse(automationResponseSchema, { automation: automationBody(row) });
    const item = (row: ChecklistRow) => toResponse(checklistItemResponseSchema, { item: checklistBody(row) });

    app.get("/summary", { preHandler: requireUser }, async (request, reply) => {
      return reply.code(200).send(toResponse(operationsSummarySchema, await summary(deps, user(request))));
    });

    // Incidents

    app.get("/incidents", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanRead(user(request));
      const query = parseInput(incidentListQuerySchema, request.query);
      const result = await incidents.listIncidents(deps, user(request), query);
      return reply.code(200).send(toResponse(incidentPageSchema, { items: result.items.map(incidentBody), nextCursor: result.nextCursor }));
    });

    app.post("/incidents", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanManage(user(request));
      const input = parseInput(createIncidentRequestSchema, request.body);
      return reply.code(201).send(incident(await incidents.createIncident(deps, contextFrom(request), user(request), input)));
    });

    app.get("/incidents/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanRead);
      const detail = await incidents.getIncident(deps, user(request), id);
      return reply
        .code(200)
        .send(toResponse(incidentDetailResponseSchema, { incident: incidentBody(detail.incident), timeline: detail.timeline.map(updateBody) }));
    });

    app.patch("/incidents/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const input = parseInput(updateIncidentRequestSchema, request.body);
      return reply.code(200).send(incident(await incidents.updateIncident(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/incidents/:id/status", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const input = parseInput(incidentStatusRequestSchema, request.body);
      return reply.code(200).send(incident(await incidents.moveIncident(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/incidents/:id/notes", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const { note } = parseInput(incidentNoteRequestSchema, request.body);
      return reply.code(200).send(incident(await incidents.addNote(deps, contextFrom(request), user(request), id, note)));
    });

    app.post("/incidents/:id/post-incident", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const { note } = parseInput(postIncidentRequestSchema, request.body);
      return reply.code(200).send(incident(await incidents.addPostIncidentNote(deps, contextFrom(request), user(request), id, note)));
    });

    // Releases

    app.get("/releases", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanRead(user(request));
      const query = parseInput(releaseListQuerySchema, request.query);
      const result = await releases.listReleases(deps, user(request), query);
      return reply.code(200).send(toResponse(releasePageSchema, { items: result.items.map(releaseBody), nextCursor: result.nextCursor }));
    });

    app.post("/releases", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanManage(user(request));
      const input = parseInput(createReleaseRequestSchema, request.body);
      return reply.code(201).send(release(await releases.createRelease(deps, contextFrom(request), user(request), input)));
    });

    app.get("/releases/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanRead);
      const detail = await releases.getRelease(deps, user(request), id);
      return reply.code(200).send(
        toResponse(releaseDetailResponseSchema, {
          release: releaseBody(detail.release),
          checklist: detail.checklist.map(checklistBody),
          decisions: detail.decisions.map(decisionBody),
        }),
      );
    });

    app.patch("/releases/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const input = parseInput(updateReleaseRequestSchema, request.body);
      return reply.code(200).send(release(await releases.updateRelease(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/releases/:id/checklist", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const { label } = parseInput(addChecklistItemRequestSchema, request.body);
      return reply.code(201).send(item(await releases.addChecklistItem(deps, contextFrom(request), user(request), id, label)));
    });

    app.post("/checklist-items/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const { done } = parseInput(checklistItemRequestSchema, request.body);
      return reply.code(200).send(item(await releases.setChecklistItem(deps, contextFrom(request), user(request), id, done)));
    });

    app.post("/releases/:id/decisions", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanAct);
      const input = parseInput(releaseDecisionRequestSchema, request.body);
      return reply.code(200).send(release(await releases.decide(deps, contextFrom(request), user(request), id, input)));
    });

    // Automations

    app.get("/automations", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanRead(user(request));
      const query = parseInput(automationListQuerySchema, request.query);
      const result = await automations.listAutomations(deps, user(request), query);
      return reply.code(200).send(toResponse(automationPageSchema, { items: result.items.map(automationBody), nextCursor: result.nextCursor }));
    });

    app.post("/automations", { preHandler: requireUser }, async (request, reply) => {
      policy.assertCanManage(user(request));
      const input = parseInput(createAutomationRequestSchema, request.body);
      return reply.code(201).send(automation(await automations.createAutomation(deps, contextFrom(request), user(request), input)));
    });

    app.get("/automations/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanRead);
      const detail = await automations.getAutomation(deps, user(request), id);
      return reply.code(200).send(
        toResponse(automationDetailResponseSchema, {
          automation: automationBody(detail.automation),
          runs: detail.runs.map(runBody),
          changes: detail.changes.map(changeBody),
        }),
      );
    });

    app.patch("/automations/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const input = parseInput(updateAutomationRequestSchema, request.body);
      return reply.code(200).send(automation(await automations.updateAutomation(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/automations/:id/status", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanAct);
      const input = parseInput(automationStatusRequestSchema, request.body);
      return reply.code(200).send(automation(await automations.moveAutomation(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/automations/:id/runs", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request, policy.assertCanManage);
      const input = parseInput(recordRunRequestSchema, request.body);
      const run = await automations.recordRun(deps, contextFrom(request), user(request), id, input);
      return reply.code(201).send(toResponse(automationRunResponseSchema, { run: runBody(run) }));
    });

    done();
  };
}
