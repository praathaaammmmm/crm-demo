"use client";

import { RELEASE_READINESS, readinessLabel, readinessNeedsNote, readinessResponseSchema, releaseReadinessSchema } from "@crm/contracts/quality";
import { useId, useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";
import styles from "./Quality.module.css";

/** Appends a readiness decision. "Ready" is refused by the API while blockers exist; the reason is shown here. */
export function SetReadinessDialog({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run } = useAction();
  const uid = useId();

  const close = () => {
    setOpen(false);
    setError(null);
  };

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const text = (key: string) => {
      const value = data.get(key);
      return typeof value === "string" ? value.trim() : "";
    };
    const readiness = releaseReadinessSchema.safeParse(text("readiness"));
    if (!readiness.success || text("label").length === 0) {
      setError("Add a release label and choose a readiness.");
      return;
    }
    const note = text("note");
    if (readinessNeedsNote(readiness.data) && note.length === 0) {
      setError("A note is required unless the release is ready.");
      return;
    }
    const body = { label: text("label"), readiness: readiness.data, ...(note.length > 0 ? { note } : {}) };
    if (await run(() => apiRequest(`/projects/${projectId}/readiness`, readinessResponseSchema, { method: "POST", body }))) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(event.currentTarget);
  }

  return (
    <>
      <Button
        size="sm"
        aria-label={`Set readiness for ${projectName}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        Set readiness
      </Button>
      <Dialog open={open} onClose={close} title="Set release readiness">
        <form onSubmit={onSubmit} noValidate>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          <div className={styles.formRow}>
            <FormField id={`${uid}-label`} label="Release label">
              <input id={`${uid}-label`} name="label" required maxLength={100} placeholder="v1.2" />
            </FormField>
            <FormField id={`${uid}-readiness`} label="Readiness">
              <select id={`${uid}-readiness`} name="readiness" defaultValue="not_ready">
                {RELEASE_READINESS.map((value) => (
                  <option key={value} value={value}>
                    {readinessLabel(value)}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField id={`${uid}-note`} label="Note" hint="Required unless the release is ready.">
            <textarea id={`${uid}-note`} name="note" maxLength={2000} />
          </FormField>
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              Save decision
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
