import type { Tx } from "../context.js";

/** An outbox event claimed by this worker. The payload is untrusted until the handler validates it. */
export interface ClaimedEvent {
  id: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

/** `done` when the work happened, `cancelled` when it no longer applies (for example a stale reminder). */
export type HandlerResult = "done" | "cancelled";

/**
 * Runs inside the transaction that also records the event's final status, so the handler's writes and
 * the status commit together. Handlers must be idempotent.
 */
export type Handler = (tx: Tx, event: ClaimedEvent) => Promise<HandlerResult>;

export type HandlerRegistry = Readonly<Record<string, Handler>>;

/** A failure safe to store in outbox_events.last_error: a short code, never a message or payload. */
export class HandlerError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
