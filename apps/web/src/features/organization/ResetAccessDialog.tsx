"use client";

import { resetAccessRequestSchema, userResponseSchema } from "@crm/contracts/organization";
import { useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";
import styles from "./Organization.module.css";

/** CEO only. POST /users/:id/reset-access; the list refreshes from the server on success (no optimistic state). */
export function ResetAccessDialog({ userId, userName, deactivated }: { userId: string; userName: string; deactivated: boolean }) {
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run } = useAction();

  const close = () => {
    setOpen(false);
    setError(null);
  };

  async function submit(form: HTMLFormElement) {
    const entry = new FormData(form).get("temporaryPassword");
    const parsed = resetAccessRequestSchema.safeParse({ temporaryPassword: typeof entry === "string" ? entry : "" });
    if (!parsed.success) {
      setError("Enter a temporary password of 12 to 128 characters.");
      return;
    }
    if (await run(() => apiRequest(`/users/${userId}/reset-access`, userResponseSchema, { method: "POST", body: parsed.data }))) {
      close();
    }
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(event.currentTarget);
  }

  const fieldId = `reset-password-${userId}`;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Reset access<span className="visually-hidden">: {userName}</span>
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={`Reset access for ${userName}?`}
        description={deactivated ? "This also restores access for a deactivated user." : "Sets a new temporary password."}
      >
        <form onSubmit={onSubmit} noValidate aria-busy={busy}>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          <ul className={styles.dialogList}>
            <li>All of {userName}&rsquo;s current sessions end immediately.</li>
            <li>They must change this temporary password at their next sign-in.</li>
            {deactivated ? <li>Their account is currently deactivated; access will be restored.</li> : null}
            <li>Tasks, meetings, approvals, attendance and audit history are kept.</li>
          </ul>
          <FormField id={fieldId} label="New temporary password" hint="12 to 128 characters. Share it privately.">
            <input id={fieldId} name="temporaryPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
          </FormField>
          <DialogFooter>
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" busy={busy} busyLabel="Resetting…">
              Reset access
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
