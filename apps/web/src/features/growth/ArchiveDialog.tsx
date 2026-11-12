"use client";

import { companyResponseSchema, contactResponseSchema } from "@crm/contracts/growth";
import { leadResponseSchema } from "@crm/contracts/growth-leads";
import { useState } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";

/** CGO only. Archiving is final: the record (and, for a company, its contacts) becomes read-only. */
export function ArchiveDialog({ kind, id, name }: { kind: "company" | "contact" | "lead"; id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run } = useAction();

  const close = () => {
    setOpen(false);
    setError(null);
  };
  const archive = (): Promise<boolean> =>
    kind === "company"
      ? run(() => apiRequest(`/growth/companies/${id}/archive`, companyResponseSchema, { method: "POST", body: {} }))
      : kind === "lead"
        ? run(() => apiRequest(`/growth/leads/${id}/archive`, leadResponseSchema, { method: "POST", body: {} }))
        : run(() => apiRequest(`/growth/contacts/${id}/archive`, contactResponseSchema, { method: "POST", body: {} }));

  return (
    <>
      <Button
        size="sm"
        variant={kind === "contact" ? "ghost" : "danger"}
        aria-label={`Archive ${kind} ${name}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        {kind === "contact" ? "Archive" : `Archive ${kind}`}
      </Button>
      <Dialog open={open} onClose={close} title={`Archive this ${kind}?`}>
        {error ? <ErrorNotice message={error} /> : null}
        <p>
          {kind === "company"
            ? "The company and all its contacts become read-only. This cannot be undone."
            : `The ${kind} becomes read-only. This cannot be undone.`}
        </p>
        <DialogFooter>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="danger"
            busy={busy}
            onClick={() => {
              void archive().then((ok) => {
                if (ok) close();
              });
            }}
          >
            Confirm archive
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
