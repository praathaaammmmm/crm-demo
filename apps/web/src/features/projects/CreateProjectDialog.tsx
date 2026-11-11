"use client";

import { projectResponseSchema } from "@crm/contracts/projects";
import { useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { Icon } from "../../components/Icon";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";

/** CEO only. Opens the new project's page after creation. */
export function CreateProjectDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const { busy, error, setError, run, router } = useAction();

  const close = () => {
    setOpen(false);
    setName("");
    setDescription("");
    setError(null);
  };

  async function submit() {
    if (name.trim().length === 0) {
      setError("Give the project a name.");
      return;
    }
    await run(
      () =>
        apiRequest("/projects", projectResponseSchema, {
          method: "POST",
          body: { name: name.trim(), description: description.trim() },
        }),
      (data) => {
        close();
        router.push(`/projects/${data.project.id}`);
      },
    );
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return (
    <>
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name="plus" />
        New project
      </Button>
      <Dialog open={open} onClose={close} title="New project">
        <form onSubmit={onSubmit} noValidate>
          {error ? <ErrorNotice message={error} /> : null}
          <FormField id="project-name" label="Name">
            <input
              id="project-name"
              required
              maxLength={200}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </FormField>
          <FormField id="project-description" label="Description">
            <textarea
              id="project-description"
              maxLength={5000}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          </FormField>
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
