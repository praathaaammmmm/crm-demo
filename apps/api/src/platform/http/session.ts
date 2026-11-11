import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthSession, Ctx } from "../context.js";
import { errors } from "../errors.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthSession | null;
  }
}

export const SESSION_COOKIE = "crm_session";
/** Matches the database-enforced 12-hour session. */
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export type SessionResolver = (token: string | undefined) => Promise<AuthSession | null>;

export interface RequireSessionOptions {
  /** Only GET /auth/me, POST /auth/password and POST /auth/logout may set this. */
  allowWhilePasswordChangeRequired?: boolean;
}

/**
 * preHandler: rejects the request with 401 unless the session cookie belongs to an active session,
 * and with 403 PASSWORD_CHANGE_REQUIRED while the user must change a temporary password. Writes nothing.
 */
export function requireSession(resolve: SessionResolver, options: RequireSessionOptions = {}) {
  return async (request: FastifyRequest): Promise<void> => {
    const session = await resolve(request.cookies[SESSION_COOKIE]);
    if (!session) throw errors.unauthenticated();
    if (session.user.mustChangePassword && options.allowWhilePasswordChangeRequired !== true) {
      throw errors.passwordChangeRequired();
    }
    request.auth = session;
  };
}

/** The session attached by requireSession. Throws if a route forgot to require one. */
export function authOf(request: FastifyRequest): AuthSession {
  if (!request.auth) throw new Error("Route is missing requireSession");
  return request.auth;
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    secure,
    maxAge: SESSION_MAX_AGE_SECONDS,
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "strict", path: "/", secure });
}

export function contextFrom(request: FastifyRequest): Ctx {
  const actor: Ctx["actor"] = request.auth
    ? { type: "user", userId: request.auth.user.id, sessionId: request.auth.sessionId }
    : { type: "anonymous" };
  return { actor, requestId: request.id };
}
