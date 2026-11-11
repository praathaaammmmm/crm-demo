"use client";

import { TASK_PRIORITIES, taskResponseSchema } from "@crm/contracts/tasks";
import { useState, type SyntheticEvent } from "react";
import { Button, type ButtonVariant } from "../../components/Button";
import { DialogFooter } from "../../components/Dialog";
import { Drawer } from "../../components/Drawer";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { Icon } from "../../components/Icon";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";
import { priorityLabel } from "./PriorityMarker";
import styles from "./Tasks.module.css";

export interface Option {
  id: string;
  name: string;
}

/** CEO only. New tasks always start in Todo (the API sets the status). */
export function CreateTaskDialog({
  projectId,
  projects,
  assignees,
  triggerLabel = "New task",
  triggerAriaLabel,
  triggerVariant = "primary",
}: {
  /** Fixed project (project page); otherwise a project select is shown. */
  projectId?: string;
  projects?: Option[];
  /** Active team members other than the CEO/CTO. */
  assignees: Option[];
  triggerLabel?: string;
  triggerAriaLabel?: string;
  triggerVariant?: ButtonVariant;
}) {
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run } = useAction();

  const close = () => {
    setOpen(false);
    setError(null);
  };

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const value = (key: string) => {
      const entry = data.get(key);
      return typeof entry === "string" ? entry.trim() : "";
    };
    const body = {
      projectId: projectId ?? value("projectId"),
      title: value("title"),
      description: value("description"),
      priority: value("priority"),
      dueDate: value("dueDate"),
      assigneeId: value("assigneeId"),
    };
    if (!body.projectId || !body.title || !body.dueDate || !body.assigneeId) {
      setError("Fill in the project, title, due date and assignee.");
      return;
    }
    if (await run(() => apiRequest("/tasks", taskResponseSchema, { method: "POST", body }))) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(event.currentTarget);
  }

  return (
    <>
      <Button
        variant={triggerVariant}
        size="sm"
        aria-label={triggerAriaLabel}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name="plus" />
        {triggerLabel}
      </Button>
      <Drawer open={open} onClose={close} title="New task">
        <form onSubmit={onSubmit} noValidate>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          {projectId === undefined ? (
            <FormField id="task-project" label="Project">
              <select id="task-project" name="projectId" required defaultValue="">
                <option value="" disabled>
                  Choose a project
                </option>
                {(projects ?? []).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}
          <FormField id="task-title" label="Title">
            <input id="task-title" name="title" required maxLength={200} />
          </FormField>
          <FormField id="task-description" label="Description">
            <textarea id="task-description" name="description" maxLength={10000} />
          </FormField>
          <div className={styles.formRow}>
            <FormField id="task-priority" label="Priority">
              <select id="task-priority" name="priority" defaultValue="medium">
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priorityLabel(priority)}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="task-due" label="Due date">
              <input id="task-due" name="dueDate" type="date" required />
            </FormField>
          </div>
          <FormField id="task-assignee" label="Assignee">
            <select id="task-assignee" name="assigneeId" required defaultValue="">
              <option value="" disabled>
                Choose a team member
              </option>
              {assignees.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </FormField>
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              Create task
            </Button>
          </DialogFooter>
        </form>
      </Drawer>
    </>
  );
}
