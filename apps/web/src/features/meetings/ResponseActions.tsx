"use client";

import { meetingResponseBodySchema, type MeetingResponse } from "@crm/contracts/meetings";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";
import styles from "./Meetings.module.css";

/** Accept or decline; the current choice is shown as pressed and can be changed until the meeting ends. */
export function ResponseActions({ meetingId, current }: { meetingId: string; current: MeetingResponse }) {
  const { busy, error, run } = useAction();
  const answer = (response: "accepted" | "declined") =>
    void run(() => apiRequest(`/meetings/${meetingId}/response`, meetingResponseBodySchema, { method: "POST", body: { response } }));

  return (
    <div className={styles.actionRow} role="group" aria-label="Your response">
      {error ? <ErrorNotice message={error} /> : null}
      <Button
        size="sm"
        variant={current === "accepted" ? "primary" : "secondary"}
        aria-pressed={current === "accepted"}
        busy={busy}
        onClick={() => {
          answer("accepted");
        }}
      >
        Accept
      </Button>
      <Button
        size="sm"
        aria-pressed={current === "declined"}
        busy={busy}
        onClick={() => {
          answer("declined");
        }}
      >
        Decline
      </Button>
    </div>
  );
}
