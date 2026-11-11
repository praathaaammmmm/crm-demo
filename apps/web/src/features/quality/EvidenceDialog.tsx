"use client";

import { defectUpdateResponseSchema } from "@crm/contracts/quality";
import { useId, useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { isSafeProofUrl } from "../../lib/task-actions";
import { useAction } from "../../lib/use-action";
import styles from "./Quality.module.css";

/** Adds an https:// evidence link (and optional note) to a defect. Checked here and again by the API. */
export function EvidenceDialog({ defectId }: { defectId: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const { busy, error, setError, run } = useAction();
  const uid = useId();

  const close = () => {
    setOpen(false);
    setUrl("");
    setNote("");
    setError(null);
  };

  async function submit() {
    const link = url.trim();
    const text = note.trim();
    if (!isSafeProofUrl(link)) {
      setError("Use a link that starts with https://");
      return;
    }
    const ok = await run(() =>
      apiRequest(`/defects/${defectId}/updates`, defectUpdateResponseSchema, {
        method: "POST",
        body: { evidenceUrl: link, ...(text.length > 0 ? { note: text } : {}) },
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
        Add evidence
      </Button>
      <Dialog open={open} onClose={close} title="Add evidence">
        <form onSubmit={onSubmit} noValidate>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          <FormField id={`${uid}-url`} label="Link" hint="Must start with https://">
            <input
              id={`${uid}-url`}
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
          <FormField id={`${uid}-note`} label="Note">
            <textarea
              id={`${uid}-note`}
              maxLength={5000}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </FormField>
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              Save evidence
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
