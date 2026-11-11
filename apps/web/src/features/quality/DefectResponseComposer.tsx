"use client";

import { defectUpdateResponseSchema } from "@crm/contracts/quality";
import { useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";
import styles from "../tasks/Rail.module.css";

/** Inline response composer for the assignee or a quality manager. */
export function DefectResponseComposer({ defectId }: { defectId: string }) {
  const [note, setNote] = useState("");
  const [posted, setPosted] = useState(false);
  const { busy, error, setError, run } = useAction();

  async function submit() {
    const trimmed = note.trim();
    if (trimmed.length === 0) {
      setError("Write a response before posting.");
      return;
    }
    setPosted(false);
    const ok = await run(() =>
      apiRequest(`/defects/${defectId}/updates`, defectUpdateResponseSchema, { method: "POST", body: { note: trimmed } }),
    );
    if (ok) {
      setNote("");
      setPosted(true);
    }
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return (
    <form className={styles.composer} onSubmit={onSubmit}>
      <label htmlFor={`response-${defectId}`} className="visually-hidden">
        Response
      </label>
      <textarea
        id={`response-${defectId}`}
        placeholder="Share findings, questions or progress…"
        maxLength={5000}
        value={note}
        aria-describedby={error ? `response-error-${defectId}` : undefined}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
      <div className={styles.composerFooter}>
        <span>
          {error ? (
            <span id={`response-error-${defectId}`} className={styles.error} role="alert">
              {error}
            </span>
          ) : null}
          {posted ? (
            <span className={styles.status} role="status">
              Response posted
            </span>
          ) : null}
        </span>
        <Button type="submit" size="sm" busy={busy} busyLabel="Posting…">
          Post response
        </Button>
      </div>
    </form>
  );
}
