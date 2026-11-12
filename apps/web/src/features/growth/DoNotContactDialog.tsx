"use client";

import { contactResponseSchema } from "@crm/contracts/growth";
import { useState } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";

/** CGO only: turn do-not-contact on or off, after a confirmation. */
export function DoNotContactDialog({ contactId, contactName, current }: { contactId: string; contactName: string; current: boolean }) {
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run } = useAction();
  const next = !current;

  const close = () => {
    setOpen(false);
    setError(null);
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`${next ? "Mark do not contact" : "Allow contact"}: ${contactName}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        {next ? "Do not contact" : "Allow contact"}
      </Button>
      <Dialog open={open} onClose={close} title={next ? "Mark as do not contact?" : "Allow contact again?"}>
        {error ? <ErrorNotice message={error} /> : null}
        <p>
          {next
            ? "No outreach should be logged to this person while this is on."
            : "Outreach to this person will be allowed again."}
        </p>
        <DialogFooter>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            onClick={() => {
              void run(() =>
                apiRequest(`/growth/contacts/${contactId}`, contactResponseSchema, { method: "PATCH", body: { doNotContact: next } }),
              ).then((ok) => {
                if (ok) close();
              });
            }}
          >
            Confirm
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
