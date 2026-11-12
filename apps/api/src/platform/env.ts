import { z } from "zod";

/** Raised when environment variables are missing or invalid. Lists variable names only, never values. */
export class InvalidEnvironmentError extends Error {}

const logLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

/** True for a time zone name the runtime recognises, e.g. "Asia/Kolkata". */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: logLevel.default("info"),
  APP_ORIGIN: z.url().transform((value) => new URL(value).origin),
  API_PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL_APP: z.string().min(1),
  /** Defines "today" for due dates and overdue tasks. */
  ORG_TIMEZONE: z.string().refine(isTimeZone),
  /** Public read-only demo: the API refuses every write except sign-in and sign-out. Only "true" enables it. */
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});
export type ServerEnv = z.infer<typeof serverSchema>;

const bootstrapSchema = z.object({
  DATABASE_URL_MIGRATOR: z.string().min(1),
  BOOTSTRAP_ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  BOOTSTRAP_ADMIN_NAME: z.string().trim().min(1).max(200),
});
export type BootstrapEnv = z.infer<typeof bootstrapSchema>;

const workerSchema = z.object({
  LOG_LEVEL: logLevel.default("info"),
  /** Connection for crm_worker only. */
  DATABASE_URL_WORKER: z.string().min(1),
  /** Identifies this worker in outbox locks; defaults to hostname:pid. */
  WORKER_ID: z.string().trim().min(1).max(100).optional(),
});
export type WorkerEnv = z.infer<typeof workerSchema>;

function parse<S extends z.ZodType>(schema: S, source: NodeJS.ProcessEnv): z.output<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ");
    throw new InvalidEnvironmentError(`Invalid or missing environment variables: ${names}`);
  }
  return result.data;
}

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  // Hosts such as Render provide PORT. Keep API_PORT for local development and
  // prefer an explicitly supplied API_PORT when both are available.
  return parse(serverSchema, { ...source, API_PORT: source["API_PORT"] ?? source["PORT"] });
}

export function loadBootstrapEnv(source: NodeJS.ProcessEnv = process.env): BootstrapEnv {
  return parse(bootstrapSchema, source);
}

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return parse(workerSchema, source);
}
