import type { FastifyInstance } from "fastify";
import { errors } from "../errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The only writes a public demo visitor may make: signing in and signing out. Exact method and path. */
export const DEMO_ALLOWED_WRITES: ReadonlySet<string> = new Set(["POST /api/v1/auth/login", "POST /api/v1/auth/logout"]);

/** True when DEMO_MODE must refuse this request before it reaches any route, body parser or service. */
export function isBlockedInDemo(method: string, url: string): boolean {
  if (SAFE_METHODS.has(method)) return false;
  const path = url.split("?", 1)[0] ?? "";
  return !DEMO_ALLOWED_WRITES.has(`${method} ${path}`);
}

/**
 * Global read-only guard for the public demo. Registered before every route, so routes added later are
 * covered too. Blocked requests get 403 DEMO_READ_ONLY with one fixed message and never touch the database.
 */
export function registerDemoMode(app: FastifyInstance): void {
  app.addHook("onRequest", (request, _reply, done) => {
    done(isBlockedInDemo(request.method, request.url) ? errors.demoReadOnly() : undefined);
  });
}
