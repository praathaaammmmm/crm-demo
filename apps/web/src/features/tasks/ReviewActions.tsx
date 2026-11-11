"use client";

import { taskResponseSchema } from "@crm/contracts/tasks";
import { useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";
import styles from "./Rail.module.css";

type Mode = "approve" | "changes" | "complete";

const COPY: Record<Mode, { title: string; field: string; confirm: string; required: boolean }> = {
  approve: { title: "Approve work", field: "Note (optional)", confirm: "Confirm approval", required: false },
  changes: { title: "Request changes", field: "What needs to change?", confirm: "Send back", required: true },
  complete: { title: "Mark task complete", field: "Note (optional)", confirm: "Confirm complete", required: false },
};

/**
 * CEO review: Approve is the single primary action; Request changes needs a note; Mark complete asks
 * for confirmation. Every action goes through a dialog so it is deliberate.
 */
export function ReviewActions({
  taskId,
  canReview,
  canMarkComplete,
}: {
  taskId: string;
  canReview: boolean;
  canMarkComplete: boolean;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [note, setNote] = useState("");
  const { busy, error, setError, run } = useAction();

  if (!canReview && !canMarkComplete) return null;

  const close = () => {
    setMode(null);
    setNote("");
    setError(null);
  };

  async function confirm() {
    if (mode === null) return;
    const trimmed = note.trim();
    if (COPY[mode].required && trimmed.length === 0) {
      setError("A note is required to request changes.");
      return;
    }
    const withNote = trimmed.length > 0 ? { note: trimmed } : {};
    const ok = await run(() =>
      mode === "complete"
        ? apiRequest(`/tasks/${taskId}/complete`, taskResponseSchema, { method: "POST", body: withNote })
        : apiRequest(`/tasks/${taskId}/review`, taskResponseSchema, {
            method: "POST",
            body: { decision: mode === "approve" ? "approved" : "changes_requested", ...withNote },
          }),
    );
    if (ok) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void confirm();
  }

  const fieldId = `review-note-${taskId}`;
  return (
    <div className={styles.actionRow}>
      {canReview ? (
        <>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setMode("approve");
            }}
          >
            Approve
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setMode("changes");
            }}
          >
            Request changes
          </Button>
        </>
      ) : null}
      {canMarkComplete ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setMode("complete");
          }}
        >
          Mark complete
        </Button>
      ) : null}

      <Dialog open={mode !== null} onClose={close} title={mode === null ? "" : COPY[mode].title}>
        {mode === null ? null : (
          <form onSubmit={onSubmit}>
            {error ? <ErrorNotice message={error} /> : null}
            <FormField id={fieldId} label={COPY[mode].field}>
              <textarea
                id={fieldId}
                maxLength={2000}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            </FormField>
            <DialogFooter>
              <Button onClick={close}>Cancel</Button>
              <Button type="submit" variant={mode === "changes" ? "secondary" : "primary"} busy={busy}>
                {COPY[mode].confirm}
              </Button>
            </DialogFooter>
          </form>
        )}
      </Dialog>
    </div>
  );
}
