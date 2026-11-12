import {
  createUserRequestSchema,
  directoryPageSchema,
  directoryQuerySchema,
  resetAccessRequestSchema,
  userIdParamsSchema,
  userResponseSchema,
} from "@crm/contracts/organization";
import type { Database } from "@crm/database/client";
import type { FastifyInstance } from "fastify";
import { authOf, contextFrom, type requireSession } from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import type { UserRecord } from "./organization.repository.js";
import { errors } from "../../platform/errors.js";
import { assertCanResetAccess } from "./organization.policy.js";
import { createUser, listDirectory, resetAccess } from "./organization.service.js";

export interface OrganizationRouteOptions {
  db: Database;
  requireUser: ReturnType<typeof requireSession>;
}

/** Explicit allowlist of response fields. */
function userBody(user: UserRecord) {
  return toResponse(userResponseSchema, {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt.toISOString(),
    },
  });
}

export function organizationRoutes({ db, requireUser }: OrganizationRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    app.post("/", { preHandler: requireUser }, async (request, reply) => {
      const input = parseInput(createUserRequestSchema, request.body);
      const user = await createUser(db, contextFrom(request), authOf(request).user, input);
      return reply.code(201).send(userBody(user));
    });

    app.post("/:id/reset-access", { preHandler: requireUser }, async (request, reply) => {
      // Permission first (403), then a malformed id is reported as 404, like an unknown one.
      assertCanResetAccess(authOf(request).user);
      const params = userIdParamsSchema.safeParse(request.params);
      if (!params.success) throw errors.notFound();
      const id = params.data.id;
      const input = parseInput(resetAccessRequestSchema, request.body);
      const user = await resetAccess(db, contextFrom(request), authOf(request).user, id, input);
      return reply.code(200).send(userBody(user));
    });

    app.get("/", { preHandler: requireUser }, async (request, reply) => {
      const query = parseInput(directoryQuerySchema, request.query);
      const page = await listDirectory(db, authOf(request).user, query);
      return reply.code(200).send(toResponse(directoryPageSchema, page));
    });

    done();
  };
}
