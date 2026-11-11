import {
  changePasswordRequestSchema,
  loginRequestSchema,
  sessionResponseSchema,
  type SessionResponse,
} from "@crm/contracts/identity";
import type { Database } from "@crm/database/client";
import type { FastifyInstance } from "fastify";
import type { AuthSession } from "../../platform/context.js";
import { LOGIN_RATE_LIMIT } from "../../platform/http/security.js";
import {
  authOf,
  clearSessionCookie,
  contextFrom,
  requireSession,
  SESSION_COOKIE,
  setSessionCookie,
} from "../../platform/http/session.js";
import { parseInput, toResponse } from "../../platform/http/validation.js";
import { changePassword, login, logout, resolveSession } from "./identity.service.js";

export interface IdentityRouteOptions {
  db: Database;
  cookieSecure: boolean;
}

/** Explicit allowlist of response fields. */
function sessionBody(session: AuthSession): SessionResponse {
  const { user } = session;
  return toResponse(sessionResponseSchema, {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
    mustChangePassword: user.mustChangePassword,
    sessionExpiresAt: session.sessionExpiresAt.toISOString(),
  });
}

export function identityRoutes({ db, cookieSecure }: IdentityRouteOptions) {
  return (app: FastifyInstance, _options: unknown, done: (error?: Error) => void): void => {
    // These identity routes stay reachable while a temporary password must be changed.
    const authenticated = requireSession((token) => resolveSession(db, token), {
      allowWhilePasswordChangeRequired: true,
    });

    app.post("/login", { config: { rateLimit: LOGIN_RATE_LIMIT } }, async (request, reply) => {
      const input = parseInput(loginRequestSchema, request.body);
      const result = await login(db, contextFrom(request), input);
      setSessionCookie(reply, result.token, result.session.sessionExpiresAt, cookieSecure);
      return reply.code(200).send(sessionBody(result.session));
    });

    app.get("/me", { preHandler: authenticated }, async (request, reply) => {
      return reply.code(200).send(sessionBody(authOf(request)));
    });

    app.post(
      "/password",
      { preHandler: authenticated, config: { rateLimit: LOGIN_RATE_LIMIT } },
      async (request, reply) => {
        const input = parseInput(changePasswordRequestSchema, request.body);
        await changePassword(db, contextFrom(request), authOf(request), input);
        return reply.code(204).send();
      },
    );

    app.post("/logout", async (request, reply) => {
      await logout(db, request.cookies[SESSION_COOKIE]);
      clearSessionCookie(reply, cookieSecure);
      return reply.code(204).send();
    });

    done();
  };
}
