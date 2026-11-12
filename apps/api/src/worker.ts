import { hostname } from "node:os";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { createDatabase, type Database } from "@crm/database/client";
import { pino, type Logger } from "pino";
import { sessionExpirySweepHandler } from "./modules/identity/index.js";
import { meetingReminderHandler } from "./modules/meetings/index.js";
import { InvalidEnvironmentError, loadWorkerEnv } from "./platform/env.js";
import { loggerOptions } from "./platform/logger.js";
import { dispatchOnce } from "./platform/worker/dispatcher.js";
import type { HandlerRegistry } from "./platform/worker/handlers.js";
import { healthCheckHandler } from "./platform/worker/health-check.js";
import { scheduleSystemEvents } from "./platform/worker/scheduler.js";

const POLL_MS = 2_000;
const SCHEDULE_MS = 30_000;

/** Every outbox event type this worker can process. Unknown types are marked failed. */
export function buildHandlers(logger: Logger): HandlerRegistry {
  return {
    "meetings.reminder_due": meetingReminderHandler,
    "identity.session_expiry_sweep": sessionExpirySweepHandler,
    "system.health_check": healthCheckHandler(logger),
  };
}

/**
 * The worker loop: schedule allowlisted system events every 30 seconds and dispatch due events every
 * 2 seconds. `stop()` stops claiming new events and resolves after the current batch has finished.
 */
export function startWorker(options: { db: Database; workerId: string; logger: Logger }): { stop: () => Promise<void> } {
  const handlers = buildHandlers(options.logger);
  // Mutable state shared with stop(); an object so the loop re-reads it on every iteration.
  const state = { running: true, lastScheduled: 0 };

  const loop = (async () => {
    while (state.running) {
      try {
        if (Date.now() - state.lastScheduled >= SCHEDULE_MS) {
          await scheduleSystemEvents(options.db);
          state.lastScheduled = Date.now();
        }
        const claimed = await dispatchOnce(options.db, handlers, options.workerId, options.logger);
        if (claimed > 0) continue;
      } catch {
        options.logger.error("worker iteration failed");
      }
      // stop() therefore waits at most one poll interval.
      await sleep(POLL_MS);
    }
  })();

  return {
    stop: async () => {
      state.running = false;
      await loop;
    },
  };
}

function main(): void {
  const env = loadWorkerEnv();
  const logger = pino(loggerOptions(env.LOG_LEVEL));
  const { db, pool } = createDatabase(env.DATABASE_URL_WORKER, { applicationName: "crm-worker", maxConnections: 4 });
  const worker = startWorker({ db, workerId: env.WORKER_ID ?? `${hostname()}:${String(process.pid)}`, logger });
  logger.info("worker started");

  const shutdown = async () => {
    await worker.stop();
    await pool.end();
    logger.info("worker stopped");
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

// Run only as the entry point, so tests can import startWorker and buildHandlers.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error: unknown) {
    // Never print connection strings or database error text.
    console.error(error instanceof InvalidEnvironmentError ? error.message : "Worker failed to start");
    process.exitCode = 1;
  }
}
