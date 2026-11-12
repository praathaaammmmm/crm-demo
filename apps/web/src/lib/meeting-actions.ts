import type { MeetingResponse, MeetingState } from "@crm/contracts/meetings";
import { can, type Role } from "@crm/permissions";

/** UI visibility only. The API enforces every rule again. */

export interface MeetingActions {
  canEdit: boolean;
  canCancel: boolean;
  canRespond: boolean;
  /** The viewer's own response, when they are a current attendee. */
  currentResponse: MeetingResponse | null;
  /** True when responsesResetAt is set on a scheduled meeting. */
  showResetNotice: boolean;
  ended: boolean;
  readOnly: boolean;
}

export function meetingActionsFor(input: {
  role: Role;
  meeting: { status: MeetingState; endsAt: string; viewerResponse: MeetingResponse | null; responsesResetAt: string | null };
  now?: number;
}): MeetingActions {
  const { meeting } = input;
  const ended = Date.parse(meeting.endsAt) <= (input.now ?? Date.now());
  const readOnly = meeting.status === "cancelled" || ended;
  const manager = can({ role: input.role }, "meetings:manage");
  return {
    canEdit: manager && !readOnly,
    canCancel: manager && !readOnly,
    canRespond: !readOnly && meeting.viewerResponse !== null && can({ role: input.role }, "meetings:respond"),
    currentResponse: meeting.viewerResponse,
    showResetNotice: meeting.responsesResetAt !== null && meeting.status === "scheduled",
    ended,
    readOnly,
  };
}

const RESPONSE_LABELS: Record<MeetingResponse, string> = { pending: "Awaiting response", accepted: "Accepted", declined: "Declined" };
export const responseLabel = (response: MeetingResponse): string => RESPONSE_LABELS[response];
