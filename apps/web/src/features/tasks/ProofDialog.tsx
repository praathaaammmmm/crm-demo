"use client";

import { taskProofResponseSchema } from "@crm/contracts/tasks";
import { useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { isSafeProofUrl } from "../../lib/task-actions";
import { useAction } from "../../lib/use-action";

/** Adds proof of work: an https:// link and/or a note. Links are checked here and again by the API. */
export function ProofDialog({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const { busy, error, setError, run } = useAction();

  const close = () => {
    setOpen(false);
    setUrl("");
    setNote("");
    setError(null);
  };

  async function submit() {
    const link = url.trim();
    const text = note.trim();
    if (link.length === 0 && text.length === 0) {
      setError("Add a link or a note.");
      return;
    }
    if (link.length > 0 && !isSafeProofUrl(link)) {
      setError("Use a link that starts with https://");
      return;
    }
    const ok = await run(() =>
      apiRequest(`/tasks/${taskId}/proofs`, taskProofResponseSchema, {
        method: "POST",
        body: { ...(link.length > 0 ? { url: link } : {}), ...(text.length > 0 ? { note: text } : {}) },
      }),
    );
    if (ok) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Add proof
      </Button>
      <Dialog open={open} onClose={close} title="Add proof of work">
        <form onSubmit={onSubmit} noValidate>
          {error ? <ErrorNotice message={error} /> : null}
          <FormField id="proof-url" label="Link" hint="Must start with https://">
            <input
              id="proof-url"
              type="url"
              inputMode="url"
              placeholder="https://"
              maxLength={2000}
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
              }}
            />
          </FormField>
          <FormField id="proof-note" label="Note">
            <textarea
              id="proof-note"
              maxLength={2000}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </FormField>
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              Save proof
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
