"use client";

import { qaCheckResponseSchema } from "@crm/contracts/quality";
import { useId, useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";
import styles from "./Quality.module.css";

export function AddQaCheckDialog({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const { busy, error, setError, run } = useAction();
  const uid = useId();

  const close = () => {
    setOpen(false);
    setTitle("");
    setError(null);
  };

  async function submit() {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError("Give the QA check a title.");
      return;
    }
    const ok = await run(() =>
      apiRequest(`/tasks/${taskId}/qa-checks`, qaCheckResponseSchema, { method: "POST", body: { title: trimmed } }),
    );
    if (ok) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Add QA check
      </Button>
      <Dialog open={open} onClose={close} title="Add QA check">
        <form onSubmit={onSubmit} noValidate>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          <FormField id={`${uid}-title`} label="What is checked">
            <input
              id={`${uid}-title`}
              maxLength={200}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
          </FormField>
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              Add check
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
