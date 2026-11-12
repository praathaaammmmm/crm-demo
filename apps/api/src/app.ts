import { randomUUID } from "node:crypto";
import type { Database } from "@crm/database/client";
import { fastify, type FastifyInstance } from "fastify";
import { approvalRoutes } from "./modules/approvals/index.js";
import { activityRoutes, growthRoutes, leadRoutes, proposalRoutes, reportRoutes } from "./modules/growth/index.js";
import { identityRoutes, resolveSession } from "./modules/identity/index.js";
import { marketingRoutes } from "./modules/marketing/index.js";
import { meetingRoutes } from "./modules/meetings/index.js";
import { notificationRoutes } from "./modules/notifications/index.js";
import { operationsRoutes } from "./modules/operations/index.js";
import { organizationApprovalHandlers, organizationRoutes } from "./modules/organization/index.js";
import { projectRoutes } from "./modules/projects/index.js";
import { qualityRoutes } from "./modules/quality/index.js";
import { assignedProjectIds, taskRoutes } from "./modules/tasks/index.js";
import type { ServerEnv } from "./platform/env.js";
import { registerErrorHandler } from "./platform/http/error-handler.js";
import { registerSecurity } from "./platform/http/security.js";
import { requireSession } from "./platform/http/session.js";
import { loggerOptions } from "./platform/logger.js";

export interface AppDeps {
  db: Database;
  env: Pick<ServerEnv, "APP_ORIGIN" | "NODE_ENV" | "LOG_LEVEL" | "ORG_TIMEZONE"> & Partial<Pick<ServerEnv, "DEMO_MODE">>;
}

export async function buildApp({ db, env }: AppDeps): Promise<FastifyInstance> {
  const app = fastify({
    logger: loggerOptions(env.LOG_LEVEL),
    genReqId: () => randomUUID(),
    bodyLimit: 64 * 1024,
  });

  app.decorateRequest("auth", null);
  registerErrorHandler(app);
  const demoMode = env.DEMO_MODE === true;
  await registerSecurity(app, { appOrigin: env.APP_ORIGIN, demoMode });

  const cookieSecure = env.NODE_ENV !== "development";
  // Valid session and no pending password change. Role permissions are checked by each module's policy.
  const requireUser = requireSession((token) => resolveSession(db, token));

  await app.register(identityRoutes({ db, cookieSecure, demoMode }), { prefix: "/api/v1/auth" });
  await app.register(organizationRoutes({ db, requireUser }), { prefix: "/api/v1/users" });
  await app.register(approvalRoutes({ db, requireUser, handlers: organizationApprovalHandlers }), {
    prefix: "/api/v1/approvals",
  });
  // Projects learn which projects contain a user's tasks from the tasks module, so projects never imports tasks.
  await app.register(projectRoutes({ db, requireUser, assignedProjectIds }), { prefix: "/api/v1/projects" });
  await app.register(taskRoutes({ db, requireUser, orgTimezone: env.ORG_TIMEZONE }), { prefix: "/api/v1/tasks" });
  // Quality routes span /quality, /qa-checks, /defects and sub-resources of tasks and projects.
  await app.register(qualityRoutes({ db, requireUser }), { prefix: "/api/v1" });
  await app.register(meetingRoutes({ db, requireUser, orgTimezone: env.ORG_TIMEZONE }), { prefix: "/api/v1/meetings" });
  await app.register(notificationRoutes({ db, requireUser }), { prefix: "/api/v1/notifications" });
  await app.register(growthRoutes({ db, requireUser }), { prefix: "/api/v1/growth" });
  await app.register(leadRoutes({ db, requireUser, orgTimezone: env.ORG_TIMEZONE }), { prefix: "/api/v1/growth" });
  await app.register(activityRoutes({ db, requireUser, orgTimezone: env.ORG_TIMEZONE }), { prefix: "/api/v1/growth" });
  await app.register(proposalRoutes({ db, requireUser, orgTimezone: env.ORG_TIMEZONE }), { prefix: "/api/v1/growth" });
  await app.register(reportRoutes({ db, requireUser, orgTimezone: env.ORG_TIMEZONE }), { prefix: "/api/v1/growth" });
  await app.register(marketingRoutes({ db, requireUser, orgTimezone: env.ORG_TIMEZONE }), { prefix: "/api/v1/marketing" });
  await app.register(operationsRoutes({ db, requireUser }), { prefix: "/api/v1/operations" });

  return app;
}
