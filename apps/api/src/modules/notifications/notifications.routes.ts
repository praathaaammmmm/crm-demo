import {
  notificationListQuerySchema,
  notificationPageSchema,
  notificationResponseSchema,
  readAllResponseSchema,
  unreadCountSchema,
  type Notification,
} from "@crm/contracts/notifications";
import { idParamsSchema } from "@crm/contracts/meetings";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { errors } from "../../platform/errors.js";
import { authOf, type requireSession } from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import type { NotificationRow } from "./notifications.repository.js";
import * as service from "./notifications.service.js";

export interface NotificationRouteOptions extends service.NotificationDeps {
  requireUser: ReturnType<typeof requireSession>;
}

const MINUTES = new Set([10, 5, 2]);

/** Explicit allowlist; meeting details only while the recipient may still see the meeting. */
function notificationBody(row: NotificationRow): Notification {
  if (!MINUTES.has(row.minutesBefore)) throw new Error("Unexpected reminder offset");
  return {
    id: row.id,
    kind: row.kind,
    meetingId: row.meetingId,
    meetingVersion: row.meetingVersion,
    minutesBefore: row.minutesBefore as 10 | 5 | 2,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    meeting: row.visible
      ? {
          title: row.meetingTitle,
          startsAt: row.meetingStartsAt.toISOString(),
          status: row.meetingStatus,
          version: row.meetingCurrentVersion,
        }
      : null,
  };
}

function idFrom(request: FastifyRequest): string {
  const result = idParamsSchema.safeParse(request.params);
  if (!result.success) throw errors.notFound();
  return result.data.id;
}

export function notificationRoutes({ requireUser, ...deps }: NotificationRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    const user = (request: FastifyRequest) => authOf(request).user;

    app.get("/", { preHandler: requireUser }, async (request, reply) => {
      const query = parseInput(notificationListQuerySchema, request.query);
      const page = await service.listNotifications(deps, user(request), query);
      return reply
        .code(200)
        .send(toResponse(notificationPageSchema, { items: page.items.map(notificationBody), nextCursor: page.nextCursor }));
    });

    app.get("/unread-count", { preHandler: requireUser }, async (request, reply) => {
      return reply.code(200).send(toResponse(unreadCountSchema, { count: await service.unreadCount(deps, user(request)) }));
    });

    app.post("/read-all", { preHandler: requireUser }, async (request, reply) => {
      return reply.code(200).send(toResponse(readAllResponseSchema, { updated: await service.markAllRead(deps, user(request)) }));
    });

    app.post("/:id/read", { preHandler: requireUser }, async (request, reply) => {
      const row = await service.markRead(deps, user(request), idFrom(request));
      return reply.code(200).send(toResponse(notificationResponseSchema, { notification: notificationBody(row) }));
    });

    done();
  };
}
