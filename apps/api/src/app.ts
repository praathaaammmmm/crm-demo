import { randomUUID } from "node:crypto";
import type { Database } from "@crm/database/client";
import { fastify, type FastifyInstance } from "fastify";
import { approvalRoutes } from "./modules/approvals/index.js";
import { identityRoutes, resolveSession } from "./modules/identity/index.js";
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
  env: Pick<ServerEnv, "APP_ORIGIN" | "NODE_ENV" | "LOG_LEVEL" | "ORG_TIMEZONE">;
}

export async function buildApp({ db, env }: AppDeps): Promise<FastifyInstance> {
  const app = fastify({
    logger: loggerOptions(env.LOG_LEVEL),
    genReqId: () => randomUUID(),
    bodyLimit: 64 * 1024,
  });

  app.decorateRequest("auth", null);
  registerErrorHandler(app);
  await registerSecurity(app, { appOrigin: env.APP_ORIGIN });

  const cookieSecure = env.NODE_ENV !== "development";
  // Valid session and no pending password change. Role permissions are checked by each module's policy.
  const requireUser = requireSession((token) => resolveSession(db, token));

  await app.register(identityRoutes({ db, cookieSecure }), { prefix: "/api/v1/auth" });
  await app.register(organizationRoutes({ db, requireUser }), { prefix: "/api/v1/users" });
  await app.register(approvalRoutes({ db, requireUser, handlers: organizationApprovalHandlers }), {
    prefix: "/api/v1/approvals",
  });
  // Projects learn which projects contain a user's tasks from the tasks module, so projects never imports tasks.
  await app.register(projectRoutes({ db, requireUser, assignedProjectIds }), { prefix: "/api/v1/projects" });
  await app.register(taskRoutes({ db, requireUser, orgTimezone: env.ORG_TIMEZONE }), { prefix: "/api/v1/tasks" });
  // Quality routes span /quality, /qa-checks, /defects and sub-resources of tasks and projects.
  await app.register(qualityRoutes({ db, requireUser }), { prefix: "/api/v1" });

  return app;
}
