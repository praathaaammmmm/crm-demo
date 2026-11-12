"use client";

import { meetingResponseBodySchema } from "@crm/contracts/meetings";
import { useState } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";

/** CEO only. Cancelling is final: no further reminders are sent and the meeting becomes read-only. */
export function CancelMeetingDialog({ meetingId }: { meetingId: string }) {
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run } = useAction();

  const close = () => {
    setOpen(false);
    setError(null);
  };

  return (
    <>
      <Button
        size="sm"
        variant="danger"
        onClick={() => {
          setOpen(true);
        }}
      >
        Cancel meeting
      </Button>
      <Dialog open={open} onClose={close} title="Cancel this meeting?">
        {error ? <ErrorNotice message={error} /> : null}
        <p>Attendees will see it as cancelled and no more reminders will be sent. This cannot be undone.</p>
        <DialogFooter>
          <Button onClick={close}>Keep meeting</Button>
          <Button
            variant="danger"
            busy={busy}
            onClick={() => {
              void run(() => apiRequest(`/meetings/${meetingId}/cancel`, meetingResponseBodySchema, { method: "POST", body: {} })).then(
                (ok) => {
                  if (ok) close();
                },
              );
            }}
          >
            Confirm cancel
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
