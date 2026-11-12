import type { Database } from "@crm/database/client";
import type { Tx } from "./context.js";
import { AppError, errors } from "./errors.js";

/** The PostgreSQL error code of a refused write, looking through Drizzle's wrapper. */
function pgCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = current.cause;
  }
  return null;
}

/**
 * Runs a write in one transaction. Services check state first; database guards are the backstop, and their
 * refusals (check or unique violations) become a safe 409 without database text.
 */
export async function guardedTransaction<T>(db: Database, work: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(work);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = pgCode(error);
    if (code === "23514" || code === "23505") throw errors.conflict("This change is not allowed in the record's current state");
    throw error;
  }
}

/** Keyset page by id: the repository fetches limit + 1 rows. */
export const pageOf = <T extends { id: string }>(rows: T[], limit: number) => {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? last.id : null };
};
