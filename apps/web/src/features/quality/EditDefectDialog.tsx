"use client";

import { DEFECT_SEVERITIES, defectResponseSchema, severityLabel, type Defect } from "@crm/contracts/quality";
import { useId, useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { DialogFooter } from "../../components/Dialog";
import { Drawer } from "../../components/Drawer";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";
import styles from "./Quality.module.css";

/** Managers only, while the defect is not final. Sends only the fields that changed. */
export function EditDefectDialog({ defect }: { defect: Defect }) {
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
    const changes: Record<string, string> = {};
    if (text("title") !== defect.title) changes["title"] = text("title");
    if (text("severity") !== defect.severity) changes["severity"] = text("severity");
    if (text("reproductionSteps") !== defect.reproductionSteps) changes["reproductionSteps"] = text("reproductionSteps");
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }
    if (await run(() => apiRequest(`/defects/${defect.id}`, defectResponseSchema, { method: "PATCH", body: changes }))) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(event.currentTarget);
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Edit defect
      </Button>
      <Drawer open={open} onClose={close} title="Edit defect">
        <form onSubmit={onSubmit} noValidate>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          <FormField id={`${uid}-title`} label="Title">
            <input id={`${uid}-title`} name="title" required maxLength={200} defaultValue={defect.title} />
          </FormField>
          <FormField id={`${uid}-severity`} label="Severity">
            <select id={`${uid}-severity`} name="severity" defaultValue={defect.severity}>
              {DEFECT_SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severityLabel(severity)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id={`${uid}-steps`} label="Reproduction steps">
            <textarea id={`${uid}-steps`} name="reproductionSteps" required maxLength={10000} defaultValue={defect.reproductionSteps} />
          </FormField>
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </Drawer>
    </>
  );
}
