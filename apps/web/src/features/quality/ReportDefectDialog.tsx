"use client";

import { DEFECT_SEVERITIES, defectResponseSchema, defectSeveritySchema, severityLabel } from "@crm/contracts/quality";
import { useId, useState, type SyntheticEvent } from "react";
import { Button, type ButtonVariant } from "../../components/Button";
import { DialogFooter } from "../../components/Dialog";
import { Drawer } from "../../components/Drawer";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";
import styles from "./Quality.module.css";

export interface TitledOption {
  id: string;
  title: string;
}

/**
 * Reports a defect on a task. On a task page the task is fixed and its QA checks can be linked;
 * on the Defects page the task is picked from `tasks`.
 */
export function ReportDefectDialog({
  taskId,
  tasks = [],
  qaChecks = [],
  triggerVariant = "primary",
}: {
  taskId?: string;
  tasks?: TitledOption[];
  qaChecks?: TitledOption[];
  triggerVariant?: ButtonVariant;
}) {
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run, router } = useAction();
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
    const target = taskId ?? text("taskId");
    const severity = defectSeveritySchema.safeParse(text("severity"));
    if (target.length === 0 || !severity.success || text("title").length === 0 || text("reproductionSteps").length === 0) {
      setError("Fill in the task, title, severity and reproduction steps.");
      return;
    }
    const qaCheckId = text("qaCheckId");
    const body = {
      title: text("title"),
      severity: severity.data,
      reproductionSteps: text("reproductionSteps"),
      ...(qaCheckId.length > 0 ? { qaCheckId } : {}),
    };
    const ok = await run(
      () => apiRequest(`/tasks/${target}/defects`, defectResponseSchema, { method: "POST", body }),
      (created) => {
        router.push(`/defects/${created.defect.id}`);
      },
    );
    if (ok) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(event.currentTarget);
  }

  return (
    <>
      <Button
        size="sm"
        variant={triggerVariant}
        onClick={() => {
          setOpen(true);
        }}
      >
        Report defect
      </Button>
      <Drawer open={open} onClose={close} title="Report defect">
        <form onSubmit={onSubmit} noValidate>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          {taskId === undefined ? (
            <FormField id={`${uid}-task`} label="Task">
              <select id={`${uid}-task`} name="taskId" required defaultValue="">
                <option value="" disabled>
                  Choose a task
                </option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          <FormField id={`${uid}-title`} label="Title">
            <input id={`${uid}-title`} name="title" required maxLength={200} />
          </FormField>
          <FormField id={`${uid}-severity`} label="Severity">
            <select id={`${uid}-severity`} name="severity" defaultValue="medium">
              {DEFECT_SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severityLabel(severity)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id={`${uid}-steps`} label="Reproduction steps">
            <textarea id={`${uid}-steps`} name="reproductionSteps" required maxLength={10000} />
          </FormField>
          {qaChecks.length > 0 ? (
            <FormField id={`${uid}-check`} label="Found by QA check" hint="Optional.">
              <select id={`${uid}-check`} name="qaCheckId" defaultValue="">
                <option value="">None</option>
                {qaChecks.map((check) => (
                  <option key={check.id} value={check.id}>
                    {check.title}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              Report defect
            </Button>
          </DialogFooter>
        </form>
      </Drawer>
    </>
  );
}
