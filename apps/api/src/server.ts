import { createDatabase } from "@crm/database/client";
import { buildApp } from "./app.js";
import { InvalidEnvironmentError, loadServerEnv } from "./platform/env.js";

async function main(): Promise<void> {
  const env = loadServerEnv();
  const { db, pool } = createDatabase(env.DATABASE_URL_APP, { applicationName: "crm-api" });
  const app = await buildApp({ db, env });

  const shutdown = async () => {
    await app.close();
    await pool.end();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  // A container host must accept traffic from its platform proxy, while local
  // development remains accessible only through the machine's network rules.
  await app.listen({ host: "0.0.0.0", port: env.API_PORT });
}

main().catch((error: unknown) => {
  // Never print connection strings or database error text.
  console.error(error instanceof InvalidEnvironmentError ? error.message : "API failed to start");
  process.exitCode = 1;
});
