import {
  createMeetingRequestSchema,
  idParamsSchema,
  meetingDetailResponseSchema,
  meetingListQuerySchema,
  meetingPageSchema,
  meetingResponseBodySchema,
  meetingSummarySchema,
  respondRequestSchema,
  updateMeetingRequestSchema,
  type Attendee,
  type Meeting,
} from "@crm/contracts/meetings";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { errors } from "../../platform/errors.js";
import { authOf, contextFrom, type requireSession } from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import type { AttendeeRow, MeetingRow } from "./meetings.repository.js";
import * as service from "./meetings.service.js";

export interface MeetingRouteOptions extends service.MeetingDeps {
  requireUser: ReturnType<typeof requireSession>;
}

// Explicit allowlists of response fields.

const iso = (date: Date | null) => (date ? date.toISOString() : null);

const meetingBody = (row: MeetingRow): Meeting => ({
  id: row.id,
  title: row.title,
  description: row.description,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  location: row.location,
  meetingUrl: row.meetingUrl,
  projectId: row.projectId,
  taskId: row.taskId,
  status: row.status,
  version: row.version,
  organizerId: row.organizerId,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  cancelledAt: iso(row.cancelledAt),
  responsesResetAt: iso(row.responsesResetAt),
  viewerResponse: row.viewerResponse,
});

const attendeeBody = (row: AttendeeRow): Attendee => ({
  userId: row.userId,
  response: row.response,
  respondedAt: iso(row.respondedAt),
});

/** A malformed id cannot name a meeting the caller may see, so it is reported as 404. */
function idFrom(request: FastifyRequest): string {
  const result = idParamsSchema.safeParse(request.params);
  if (!result.success) throw errors.notFound();
  return result.data.id;
}

export function meetingRoutes({ requireUser, ...deps }: MeetingRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    const user = (request: FastifyRequest) => authOf(request).user;
    const one = (row: MeetingRow) => toResponse(meetingResponseBodySchema, { meeting: meetingBody(row) });

    app.post("/", { preHandler: requireUser }, async (request, reply) => {
      const input = parseInput(createMeetingRequestSchema, request.body);
      return reply.code(201).send(one(await service.createMeeting(deps, contextFrom(request), user(request), input)));
    });

    app.get("/", { preHandler: requireUser }, async (request, reply) => {
      const query = parseInput(meetingListQuerySchema, request.query);
      const page = await service.listMeetings(deps, user(request), query);
      return reply.code(200).send(toResponse(meetingPageSchema, { items: page.items.map(meetingBody), nextCursor: page.nextCursor }));
    });

    app.get("/summary", { preHandler: requireUser }, async (request, reply) => {
      const summary = await service.meetingSummary(deps, user(request));
      return reply.code(200).send(toResponse(meetingSummarySchema, { counts: summary.counts, next: summary.next.map(meetingBody) }));
    });

    app.get("/:id", { preHandler: requireUser }, async (request, reply) => {
      const detail = await service.getMeeting(deps, user(request), idFrom(request));
      return reply
        .code(200)
        .send(toResponse(meetingDetailResponseSchema, { meeting: meetingBody(detail.meeting), attendees: detail.attendees.map(attendeeBody) }));
    });

    app.patch("/:id", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const input = parseInput(updateMeetingRequestSchema, request.body);
      return reply.code(200).send(one(await service.updateMeeting(deps, contextFrom(request), user(request), id, input)));
    });

    app.post("/:id/cancel", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      return reply.code(200).send(one(await service.cancelMeeting(deps, contextFrom(request), user(request), id)));
    });

    app.post("/:id/response", { preHandler: requireUser }, async (request, reply) => {
      const id = idFrom(request);
      const input = parseInput(respondRequestSchema, request.body);
      return reply.code(200).send(one(await service.respond(deps, contextFrom(request), user(request), id, input)));
    });

    done();
  };
}
