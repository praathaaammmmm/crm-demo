"use client";

import { approvalResponseSchema, createApprovalRequestSchema } from "@crm/contracts/approvals";
import Link from "next/link";
import { useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";
import styles from "./Organization.module.css";

/**
 * CEO only. Uses the existing approval workflow (POST /approvals, type user.deactivate). The API approves and
 * carries out the CEO's own request in one transaction; if it ever comes back pending, that is shown as pending.
 */
export function DeactivateUserDialog({ userId, userName }: { userId: string; userName: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const { busy, error, setError, run } = useAction();

  const close = () => {
    setOpen(false);
    setPending(false);
    setError(null);
  };

  async function submit(form: HTMLFormElement) {
    const entry = new FormData(form).get("reason");
    const parsed = createApprovalRequestSchema.safeParse({
      type: "user.deactivate",
      targetUserId: userId,
      payload: {},
      reason: typeof entry === "string" ? entry : "",
    });
    if (!parsed.success) {
      setError("Enter a reason of up to 500 characters.");
      return;
    }
    await run(
      () => apiRequest("/approvals", approvalResponseSchema, { method: "POST", body: parsed.data }),
      (data) => {
        // The CEO's request is approved immediately; anything still pending is shown honestly.
        if (data.approval.status === "pending") setPending(true);
        else close();
      },
    );
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(event.currentTarget);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Deactivate user<span className="visually-hidden">: {userName}</span>
      </Button>
      <Dialog open={open} onClose={close} title={`Deactivate ${userName}?`} description="Access is removed; history is kept.">
        {pending ? (
          <>
            <p className={styles.notice}>
              The request was recorded and is waiting for a decision. The user stays active until it is approved.
            </p>
            <DialogFooter>
              <Link href="/approvals?status=pending">Open approvals</Link>
              <Button onClick={close}>Close</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate aria-busy={busy}>
            {error ? (
              <div className={styles.formError}>
                <ErrorNotice message={error} />
              </div>
            ) : null}
            <p className={styles.dialogText}>
              {userName} will be signed out everywhere and can no longer sign in. Their tasks, updates, approvals and
              audit records stay in the system. This is not a deletion, and the audit log records who deactivated the
              account and why.
            </p>
            <FormField id={`deactivate-reason-${userId}`} label="Reason" hint="Required. Up to 500 characters; stored in the audit trail.">
              <textarea id={`deactivate-reason-${userId}`} name="reason" required maxLength={500} />
            </FormField>
            <DialogFooter>
              <Button onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" busy={busy} busyLabel="Deactivating…">
                Deactivate user
              </Button>
            </DialogFooter>
          </form>
        )}
      </Dialog>
    </>
  );
}
