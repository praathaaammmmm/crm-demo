import {
  createProjectRequestSchema,
  projectIdParamsSchema,
  projectListQuerySchema,
  projectPageSchema,
  projectResponseSchema,
  type Project,
} from "@crm/contracts/projects";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { errors } from "../../platform/errors.js";
import { authOf, contextFrom, type requireSession } from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import type { ProjectRow } from "./projects.repository.js";
import { createProject, getProject, listProjects, type ProjectDeps } from "./projects.service.js";

export interface ProjectRouteOptions extends ProjectDeps {
  requireUser: ReturnType<typeof requireSession>;
}

/** Explicit allowlist of response fields. */
const projectBody = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  description: row.description,
  createdAt: row.createdAt.toISOString(),
});

function idFrom(request: FastifyRequest): string {
  const result = projectIdParamsSchema.safeParse(request.params);
  if (!result.success) throw errors.notFound();
  return result.data.id;
}

export function projectRoutes({ requireUser, ...deps }: ProjectRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    app.post("/", { preHandler: requireUser }, async (request, reply) => {
      const input = parseInput(createProjectRequestSchema, request.body);
      const row = await createProject(deps, contextFrom(request), authOf(request).user, input);
      return reply.code(201).send(toResponse(projectResponseSchema, { project: projectBody(row) }));
    });

    app.get("/", { preHandler: requireUser }, async (request, reply) => {
      const query = parseInput(projectListQuerySchema, request.query);
      const page = await listProjects(deps, authOf(request).user, query);
      return reply
        .code(200)
        .send(toResponse(projectPageSchema, { items: page.items.map(projectBody), nextCursor: page.nextCursor }));
    });

    app.get("/:id", { preHandler: requireUser }, async (request, reply) => {
      const row = await getProject(deps, authOf(request).user, idFrom(request));
      return reply.code(200).send(toResponse(projectResponseSchema, { project: projectBody(row) }));
    });

    done();
  };
}
