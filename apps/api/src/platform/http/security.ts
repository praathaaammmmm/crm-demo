import { fastifyCookie } from "@fastify/cookie";
import { fastifyHelmet } from "@fastify/helmet";
import { fastifyRateLimit } from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { errors } from "../errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Login attempts allowed per IP per minute (docs/security/authentication.md). */
export const LOGIN_RATE_LIMIT = { max: 10, timeWindow: "1 minute" } as const;

/**
 * Security headers, cookie parsing, opt-in per-route rate limiting, and the Origin check:
 * every state-changing request must come from APP_ORIGIN.
 */
export async function registerSecurity(app: FastifyInstance, options: { appOrigin: string }): Promise<void> {
  await app.register(fastifyHelmet);
  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });

  app.addHook("onRequest", (request, _reply, done) => {
    if (!SAFE_METHODS.has(request.method) && request.headers.origin !== options.appOrigin) {
      done(errors.forbidden());
      return;
    }
    done();
  });
}
