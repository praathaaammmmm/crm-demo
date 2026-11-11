"use client";

import { QA_OUTCOMES, qaOutcomeLabel, qaOutcomeNeedsNote, qaOutcomeSchema, qaResultResponseSchema } from "@crm/contracts/quality";
import { useId, useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { isSafeProofUrl } from "../../lib/task-actions";
import { useAction } from "../../lib/use-action";
import styles from "./Quality.module.css";

/** Appends a QA result. Failed and blocked need a note; evidence links must be https. */
export function RecordResultDialog({ qaCheckId, checkTitle }: { qaCheckId: string; checkTitle: string }) {
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
    const outcome = qaOutcomeSchema.safeParse(text("outcome"));
    if (!outcome.success) {
      setError("Choose an outcome.");
      return;
    }
    const note = text("note");
    const link = text("evidenceUrl");
    if (qaOutcomeNeedsNote(outcome.data) && note.length === 0) {
      setError("A note is required for failed or blocked results.");
      return;
    }
    if (link.length > 0 && !isSafeProofUrl(link)) {
      setError("Use a link that starts with https://");
      return;
    }
    const body = {
      outcome: outcome.data,
      ...(note.length > 0 ? { note } : {}),
      ...(link.length > 0 ? { evidenceUrl: link } : {}),
    };
    if (await run(() => apiRequest(`/qa-checks/${qaCheckId}/results`, qaResultResponseSchema, { method: "POST", body }))) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(event.currentTarget);
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Record result for ${checkTitle}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        Record result
      </Button>
      <Dialog open={open} onClose={close} title="Record QA result">
        <form onSubmit={onSubmit} noValidate>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          <FormField id={`${uid}-outcome`} label="Outcome">
            <select id={`${uid}-outcome`} name="outcome" defaultValue="passed">
              {QA_OUTCOMES.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {qaOutcomeLabel(outcome)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id={`${uid}-note`} label="Note" hint="Required for failed or blocked results.">
            <textarea id={`${uid}-note`} name="note" maxLength={2000} />
          </FormField>
          <FormField id={`${uid}-evidence`} label="Evidence link" hint="Optional. Must start with https://">
            <input id={`${uid}-evidence`} name="evidenceUrl" type="url" inputMode="url" placeholder="https://" maxLength={2000} />
          </FormField>
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              Save result
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
