import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { createDatabase } from "@crm/database/client";
import { assertBootstrapAllowed, BOOTSTRAP_CONFIRMATION, bootstrapSuperAdmin } from "./modules/organization/index.js";
import { InvalidEnvironmentError, loadBootstrapEnv } from "./platform/env.js";
import { AppError } from "./platform/errors.js";

/** One-time creation of the CEO/CTO Super Admin. See docs/runbooks/super-admin-bootstrap.md. */

class InteractiveOnlyError extends Error {}

function ask(question: string, hidden: boolean): Promise<string> {
  process.stdout.write(question);
  const mutedOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output: hidden ? mutedOutput : process.stdout, terminal: true });
  return new Promise((resolve) => {
    rl.question("", (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function safeMessage(error: unknown): string {
  if (error instanceof AppError || error instanceof InvalidEnvironmentError || error instanceof InteractiveOnlyError) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return `[${error.code}]`;
  }
  return "unexpected error";
}

async function main(): Promise<void> {
  if (!process.stdin.isTTY) throw new InteractiveOnlyError("Bootstrap must be run interactively in a terminal");

  const env = loadBootstrapEnv();
  const { db, pool } = createDatabase(env.DATABASE_URL_MIGRATOR, { applicationName: "crm-bootstrap", maxConnections: 1 });
  try {
    await assertBootstrapAllowed(db);
    const password = await ask("Super Admin password: ", true);
    const passwordConfirmation = await ask("Repeat password: ", true);
    const confirmation = await ask(`Type ${BOOTSTRAP_CONFIRMATION} to create the Super Admin: `, false);

    await bootstrapSuperAdmin(db, {
      email: env.BOOTSTRAP_ADMIN_EMAIL,
      name: env.BOOTSTRAP_ADMIN_NAME,
      password,
      passwordConfirmation,
      confirmation,
    });
    console.log("Super Admin created");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`Bootstrap failed: ${safeMessage(error)}`);
  process.exitCode = 1;
});
