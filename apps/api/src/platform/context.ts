import type { Database } from "@crm/database/client";
import type { Role } from "@crm/permissions";

/** A Drizzle transaction handle. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run a query: the pool-backed database or an open transaction. */
export type Executor = Database | Tx;

export type Actor =
  | { type: "user"; userId: string; sessionId: string }
  | { type: "system" }
  | { type: "bootstrap" }
  | { type: "anonymous" };

export interface Ctx {
  actor: Actor;
  requestId: string | null;
}

/** The authenticated session attached to a request by requireSession. */
export interface AuthSession {
  sessionId: string;
  sessionExpiresAt: Date;
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    isSuperAdmin: boolean;
    mustChangePassword: boolean;
  };
}
