"use client";

import { approvalResponseSchema } from "@crm/contracts/approvals";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../components/Button";
import { apiRequest, failureMessage, redirectForSession } from "../../lib/api-client";
import styles from "./Approvals.module.css";

type Mode = "idle" | "approve" | "reject" | "cancel";

const NOTE_MAX = 500;

/**
 * Actions on one pending request. The CEO may approve (optional note) or reject (note required);
 * a requester may cancel their own. The API enforces both rules regardless.
 */
export function ApprovalActions({ approvalId, canDecide, canCancel }: { approvalId: string; canDecide: boolean; canCancel: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canDecide && !canCancel) return null;

  const start = (next: Mode) => {
    setMode(next);
    setNote("");
    setError(null);
  };

  async function confirm() {
    const trimmed = note.trim();
    if (mode === "reject" && trimmed.length === 0) {
      setError("A note is required to reject a request.");
      return;
    }
    setBusy(true);
    setError(null);
    const body = mode === "cancel" ? undefined : trimmed.length > 0 ? { note: trimmed } : {};
    const result = await apiRequest(`/approvals/${approvalId}/${mode}`, approvalResponseSchema, {
      method: "POST",
      ...(body === undefined ? {} : { body }),
    });
    setBusy(false);
    if (result.ok) {
      setMode("idle");
      router.refresh();
      return;
    }
    if (!redirectForSession(router, result.failure)) setError(failureMessage(result.failure));
  }

  if (mode === "idle") {
    return (
      <div className={styles.buttons}>
        {canDecide ? (
          <>
            <Button variant="primary" onClick={() => { start("approve"); }}>
              Approve
            </Button>
            <Button variant="danger" onClick={() => { start("reject"); }}>
              Reject
            </Button>
          </>
        ) : null}
        {canCancel ? (
          <Button onClick={() => { start("cancel"); }}>Cancel request</Button>
        ) : null}
      </div>
    );
  }

  const noteId = `note-${approvalId}`;
  const confirmLabel = mode === "approve" ? "Confirm approval" : mode === "reject" ? "Confirm rejection" : "Confirm cancel";

  return (
    <div className={styles.actions}>
      {mode === "cancel" ? null : (
        <>
          <label htmlFor={noteId} className={styles.muted}>
            {mode === "reject" ? "Reason for rejection (required)" : "Note (optional)"}
          </label>
          <textarea
            id={noteId}
            className={styles.note}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </>
      )}
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
      <div className={styles.buttons}>
        <Button
          variant={mode === "approve" ? "primary" : "danger"}
          busy={busy}
          onClick={() => {
            void confirm();
          }}
        >
          {confirmLabel}
        </Button>
        <Button disabled={busy} onClick={() => { start("idle"); }}>
          Back
        </Button>
      </div>
    </div>
  );
}
