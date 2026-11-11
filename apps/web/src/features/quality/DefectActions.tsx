"use client";

import { defectResponseSchema, type DefectStatus } from "@crm/contracts/quality";
import { useId, useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import type { DefectMove } from "../../lib/defect-actions";
import { useAction } from "../../lib/use-action";
import styles from "./Quality.module.css";

const NOTE_LABEL: Partial<Record<DefectStatus, string>> = {
  fixed: "What was fixed?",
  wont_fix: "Why won't this be fixed?",
  open: "What is still wrong?",
};

/** Status moves for this viewer. Moves that need a note go through a dialog; others apply directly. */
export function DefectActions({ defectId, moves }: { defectId: string; moves: DefectMove[] }) {
  const [pending, setPending] = useState<DefectMove | null>(null);
  const [note, setNote] = useState("");
  const { busy, error, setError, run } = useAction();
  const uid = useId();

  if (moves.length === 0) return null;

  const close = () => {
    setPending(null);
    setNote("");
    setError(null);
  };

  const apply = (to: DefectStatus, withNote?: string) =>
    run(() =>
      apiRequest(`/defects/${defectId}/status`, defectResponseSchema, {
        method: "POST",
        body: { status: to, ...(withNote === undefined ? {} : { note: withNote }) },
      }),
    );

  async function confirm() {
    if (pending === null) return;
    const trimmed = note.trim();
    if (trimmed.length === 0) {
      setError("A note is required for this change.");
      return;
    }
    if (await apply(pending.to, trimmed)) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void confirm();
  }

  return (
    <div className={styles.panelActions}>
      {error && pending === null ? <ErrorNotice message={error} /> : null}
      {moves.map((move) => (
        <Button
          key={move.to}
          size="sm"
          variant={move.primary ? "primary" : "secondary"}
          busy={busy && pending === null}
          onClick={() => {
            if (move.needsNote) setPending(move);
            else void apply(move.to);
          }}
        >
          {move.label}
        </Button>
      ))}
      <Dialog open={pending !== null} onClose={close} title={pending?.label ?? ""}>
        <form onSubmit={onSubmit} noValidate>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          <FormField id={`${uid}-note`} label={pending ? (NOTE_LABEL[pending.to] ?? "Note") : "Note"}>
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
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}
