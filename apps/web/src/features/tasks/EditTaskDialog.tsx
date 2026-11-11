"use client";

import { TASK_PRIORITIES, taskResponseSchema, type Task } from "@crm/contracts/tasks";
import { useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { DialogFooter } from "../../components/Dialog";
import { Drawer } from "../../components/Drawer";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";
import type { Option } from "./CreateTaskDialog";
import { priorityLabel } from "./PriorityMarker";
import styles from "./Tasks.module.css";

/** CEO only: edit fields or reassign. Sends only the fields that changed. */
export function EditTaskDialog({ task, assignees }: { task: Task; assignees: Option[] }) {
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
    const next = {
      title: value("title"),
      description: value("description"),
      priority: value("priority"),
      dueDate: value("dueDate"),
      assigneeId: value("assigneeId"),
    };
    const changes: Record<string, string> = {};
    if (next.title !== task.title) changes["title"] = next.title;
    if (next.description !== task.description) changes["description"] = next.description;
    if (next.priority !== task.priority) changes["priority"] = next.priority;
    if (next.dueDate !== task.dueDate) changes["dueDate"] = next.dueDate;
    if (next.assigneeId !== task.assigneeId) changes["assigneeId"] = next.assigneeId;
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }
    if (await run(() => apiRequest(`/tasks/${task.id}`, taskResponseSchema, { method: "PATCH", body: changes }))) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(event.currentTarget);
  }

  const includesCurrent = assignees.some((person) => person.id === task.assigneeId);
  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Edit task
      </Button>
      <Drawer open={open} onClose={close} title="Edit task">
        <form onSubmit={onSubmit} noValidate>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          <FormField id="edit-title" label="Title">
            <input id="edit-title" name="title" required maxLength={200} defaultValue={task.title} />
          </FormField>
          <FormField id="edit-description" label="Description">
            <textarea id="edit-description" name="description" maxLength={10000} defaultValue={task.description} />
          </FormField>
          <div className={styles.formRow}>
            <FormField id="edit-priority" label="Priority">
              <select id="edit-priority" name="priority" defaultValue={task.priority}>
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priorityLabel(priority)}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="edit-due" label="Due date">
              <input id="edit-due" name="dueDate" type="date" required defaultValue={task.dueDate} />
            </FormField>
          </div>
          <FormField id="edit-assignee" label="Assignee">
            <select id="edit-assignee" name="assigneeId" defaultValue={task.assigneeId}>
              {includesCurrent ? null : <option value={task.assigneeId}>Current assignee</option>}
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
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </Drawer>
    </>
  );
}
