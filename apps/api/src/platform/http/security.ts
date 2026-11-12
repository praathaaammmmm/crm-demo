import { fastifyCookie } from "@fastify/cookie";
import { fastifyHelmet } from "@fastify/helmet";
import { fastifyRateLimit } from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { errors } from "../errors.js";
import { registerDemoMode } from "./demo-mode.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Login attempts allowed per IP per minute (docs/security/authentication.md). */
export const LOGIN_RATE_LIMIT = { max: 10, timeWindow: "1 minute" } as const;

/**
 * Security headers, cookie parsing, opt-in per-route rate limiting, and the Origin check:
 * every state-changing request must come from APP_ORIGIN. In demo mode the read-only guard runs first, so
 * every blocked write gets the same demo response wherever it comes from.
 */
export async function registerSecurity(
  app: FastifyInstance,
  options: { appOrigin: string; demoMode?: boolean },
): Promise<void> {
  await app.register(fastifyHelmet);
  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });
  if (options.demoMode === true) registerDemoMode(app);

  app.addHook("onRequest", (request, _reply, done) => {
    if (!SAFE_METHODS.has(request.method) && request.headers.origin !== options.appOrigin) {
      done(errors.forbidden());
      return;
    }
    done();
  });
}
