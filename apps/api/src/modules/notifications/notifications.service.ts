import type { NotificationListQuery } from "@crm/contracts/notifications";
import type { Database } from "@crm/database/client";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import * as policy from "./notifications.policy.js";
import * as repo from "./notifications.repository.js";

type User = AuthSession["user"];

export interface NotificationDeps {
  db: Database;
}

// Reading or marking notifications is not a sensitive action, so it is not audited.

export async function listNotifications(deps: NotificationDeps, user: User, query: NotificationListQuery) {
  policy.assertCanReadOwn(user);
  const rows = await repo.listForRecipient(deps.db, {
    recipientId: user.id,
    canReadAll: policy.canSeeAllMeetings(user),
    unread: query.unread === undefined ? undefined : query.unread === "true",
    cursor: query.cursor,
    limit: query.limit,
  });
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > query.limit && last ? last.id : null };
}

export function unreadCount(deps: NotificationDeps, user: User): Promise<number> {
  policy.assertCanReadOwn(user);
  return repo.unreadCount(deps.db, user.id);
}

/** Marks one of the caller's notifications read and returns it; anyone else's is reported as 404. */
export async function markRead(deps: NotificationDeps, user: User, id: string) {
  policy.assertCanReadOwn(user);
  const canReadAll = policy.canSeeAllMeetings(user);
  if (!(await repo.findForRecipient(deps.db, id, user.id, canReadAll))) throw errors.notFound();
  await deps.db.transaction((tx) => repo.markRead(tx, id, user.id));
  const row = await repo.findForRecipient(deps.db, id, user.id, canReadAll);
  if (!row) throw new Error("Notification not found after marking it read");
  return row;
}

export function markAllRead(deps: NotificationDeps, user: User): Promise<number> {
  policy.assertCanReadOwn(user);
  return deps.db.transaction((tx) => repo.markAllRead(tx, user.id));
}
