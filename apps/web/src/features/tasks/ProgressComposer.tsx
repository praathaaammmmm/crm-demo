"use client";

import { taskUpdateResponseSchema } from "@crm/contracts/tasks";
import { useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";
import styles from "./Rail.module.css";

const MAX = 5000;

/** Inline progress update composer for the assignee. */
export function ProgressComposer({ taskId }: { taskId: string }) {
  const [note, setNote] = useState("");
  const [posted, setPosted] = useState(false);
  const { busy, error, setError, run } = useAction();

  async function submit() {
    const trimmed = note.trim();
    if (trimmed.length === 0) {
      setError("Write an update before posting.");
      return;
    }
    setPosted(false);
    const ok = await run(() =>
      apiRequest(`/tasks/${taskId}/updates`, taskUpdateResponseSchema, { method: "POST", body: { note: trimmed } }),
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
      <label htmlFor={`update-${taskId}`} className="visually-hidden">
        Progress update
      </label>
      <textarea
        id={`update-${taskId}`}
        placeholder="Share progress, blockers or next steps…"
        maxLength={MAX}
        value={note}
        aria-describedby={error ? `update-error-${taskId}` : undefined}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
      <div className={styles.composerFooter}>
        <span>
          {error ? (
            <span id={`update-error-${taskId}`} className={styles.error} role="alert">
              {error}
            </span>
          ) : null}
          {posted ? (
            <span className={styles.status} role="status">
              Update posted
            </span>
          ) : null}
        </span>
        <Button type="submit" size="sm" busy={busy} busyLabel="Posting…">
          Post update
        </Button>
      </div>
    </form>
  );
}
