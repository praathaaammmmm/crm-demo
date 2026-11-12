import { can } from "@crm/permissions";
import type { AuthSession } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";

type User = AuthSession["user"];

/** Every role reads only its own notifications; anyone else's are reported as 404 by the service. */
export function assertCanReadOwn(user: User): void {
  if (!can(user, "notifications:read_own")) throw errors.forbidden();
}

/** Whether meeting details may be shown for any meeting (the CEO/CTO), not only current invitations. */
export const canSeeAllMeetings = (user: User): boolean => can(user, "meetings:read_all");
