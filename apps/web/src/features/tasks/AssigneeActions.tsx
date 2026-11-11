"use client";

import { taskResponseSchema, type TaskStatus } from "@crm/contracts/tasks";
import { useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import type { AssigneeMove } from "../../lib/task-actions";
import { useAction } from "../../lib/use-action";
import { ProofDialog } from "./ProofDialog";
import styles from "./Rail.module.css";

/** Status buttons, proof and submission for the current assignee. The API enforces every rule again. */
export function AssigneeActions({
  taskId,
  moves,
  canAddProof,
  canSubmit,
  submitHint,
}: {
  taskId: string;
  moves: AssigneeMove[];
  canAddProof: boolean;
  canSubmit: boolean;
  submitHint: string | null;
}) {
  const [noteFor, setNoteFor] = useState<TaskStatus | null>(null);
  const [note, setNote] = useState("");
  const { busy, error, setError, run } = useAction();

  const move = (to: TaskStatus, withNote?: string) =>
    run(() =>
      apiRequest(`/tasks/${taskId}/status`, taskResponseSchema, {
        method: "POST",
        body: withNote === undefined ? { status: to } : { status: to, note: withNote },
      }),
    );

  const closeNote = () => {
    setNoteFor(null);
    setNote("");
    setError(null);
  };

  async function submitNote() {
    if (noteFor === null) return;
    const trimmed = note.trim();
    if (trimmed.length === 0) {
      setError("A note is required.");
      return;
    }
    if (await move(noteFor, trimmed)) closeNote();
  }

  function onNoteSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitNote();
  }

  return (
    <div className={styles.actions}>
      {error && noteFor === null ? <span className={styles.error} role="alert">{error}</span> : null}
      {moves.length > 0 ? (
        <div className={styles.actionRow}>
          {moves.map((m) => (
            <Button
              key={m.to}
              size="sm"
              busy={busy && noteFor === null}
              onClick={() => {
                if (m.needsNote) setNoteFor(m.to);
                else void move(m.to);
              }}
            >
              {m.label}
            </Button>
          ))}
        </div>
      ) : null}
      <div className={styles.actionRow}>
        {canAddProof ? <ProofDialog taskId={taskId} /> : null}
        {canSubmit || submitHint !== null ? (
          <Button
            size="sm"
            variant="primary"
            disabled={!canSubmit}
            busy={busy && noteFor === null}
            aria-describedby={submitHint ? `submit-hint-${taskId}` : undefined}
            onClick={() => {
              void run(() => apiRequest(`/tasks/${taskId}/submit`, taskResponseSchema, { method: "POST", body: {} }));
            }}
          >
            Submit for review
          </Button>
        ) : null}
      </div>
      {submitHint ? (
        <span id={`submit-hint-${taskId}`} className={styles.status}>
          {submitHint}
        </span>
      ) : null}

      <Dialog open={noteFor !== null} onClose={closeNote} title="Mark task blocked">
        <form onSubmit={onNoteSubmit}>
          {error ? <ErrorNotice message={error} /> : null}
          <FormField id={`blocked-note-${taskId}`} label="What is blocking this task?">
            <textarea
              id={`blocked-note-${taskId}`}
              maxLength={5000}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </FormField>
          <DialogFooter>
            <Button onClick={closeNote}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              Mark blocked
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}
