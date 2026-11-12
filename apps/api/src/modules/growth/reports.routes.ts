import { growthOverviewSchema, growthReportQuerySchema } from "@crm/contracts/growth-reports";
import type { FastifyInstance } from "fastify";
import { authOf, type requireSession } from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import * as policy from "./growth.policy.js";
import * as service from "./reports.service.js";

export interface ReportRouteOptions extends service.ReportDeps {
  requireUser: ReturnType<typeof requireSession>;
}

/** Registered with the /api/v1/growth prefix. Read-only: no audit events. */
export function reportRoutes({ requireUser, ...deps }: ReportRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    app.get("/reports/overview", { preHandler: requireUser }, async (request, reply) => {
      const user = authOf(request).user;
      policy.assertCanRead(user);
      const query = parseInput(growthReportQuerySchema, request.query);
      return reply.code(200).send(toResponse(growthOverviewSchema, await service.overview(deps, user, query)));
    });
    done();
  };
}
