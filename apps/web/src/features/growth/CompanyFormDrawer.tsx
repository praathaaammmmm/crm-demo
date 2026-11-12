"use client";

import { companyResponseSchema, type Company } from "@crm/contracts/growth";
import { useId, useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { DialogFooter } from "../../components/Dialog";
import { Drawer } from "../../components/Drawer";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { isSafeProofUrl } from "../../lib/task-actions";
import { useAction } from "../../lib/use-action";
import styles from "./Growth.module.css";

/** CGO only: create a company, or edit one (sending only changed fields). The API normalises names. */
export function CompanyFormDrawer({ company }: { company?: Company }) {
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run, router } = useAction();
  const uid = useId();
  const editing = company !== undefined;

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
    const fields = { name: text("name"), websiteUrl: text("websiteUrl"), industry: text("industry"), notes: text("notes") };
    if (fields.name.length === 0) {
      setError("Give the company a name.");
      return;
    }
    if (fields.websiteUrl.length > 0 && !isSafeProofUrl(fields.websiteUrl)) {
      setError("Use a website that starts with https://");
      return;
    }
    if (!editing) {
      const ok = await run(
        () => apiRequest("/growth/companies", companyResponseSchema, { method: "POST", body: fields }),
        (created) => {
          router.push(`/growth/companies/${created.company.id}`);
        },
      );
      if (ok) close();
      return;
    }
    const changes: Record<string, string> = {};
    if (fields.name !== company.name) changes["name"] = fields.name;
    if (fields.websiteUrl !== (company.websiteUrl ?? "")) changes["websiteUrl"] = fields.websiteUrl;
    if (fields.industry !== (company.industry ?? "")) changes["industry"] = fields.industry;
    if (fields.notes !== (company.notes ?? "")) changes["notes"] = fields.notes;
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }
    if (await run(() => apiRequest(`/growth/companies/${company.id}`, companyResponseSchema, { method: "PATCH", body: changes }))) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(event.currentTarget);
  }

  const title = editing ? "Edit company" : "New company";
  return (
    <>
      <Button
        size="sm"
        variant={editing ? "secondary" : "primary"}
        onClick={() => {
          setOpen(true);
        }}
      >
        {title}
      </Button>
      <Drawer open={open} onClose={close} title={title}>
        <form onSubmit={onSubmit} noValidate>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          <FormField id={`${uid}-name`} label="Name">
            <input id={`${uid}-name`} name="name" required maxLength={200} defaultValue={company?.name ?? ""} />
          </FormField>
          <div className={styles.formRow}>
            <FormField id={`${uid}-industry`} label="Industry" hint="Optional.">
              <input id={`${uid}-industry`} name="industry" maxLength={100} defaultValue={company?.industry ?? ""} />
            </FormField>
            <FormField id={`${uid}-website`} label="Website" hint="Optional. Must start with https://">
              <input id={`${uid}-website`} name="websiteUrl" type="url" inputMode="url" placeholder="https://" maxLength={2000} defaultValue={company?.websiteUrl ?? ""} />
            </FormField>
          </div>
          <FormField id={`${uid}-notes`} label="Notes">
            <textarea id={`${uid}-notes`} name="notes" maxLength={5000} defaultValue={company?.notes ?? ""} />
          </FormField>
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              {editing ? "Save changes" : "Create company"}
            </Button>
          </DialogFooter>
        </form>
      </Drawer>
    </>
  );
}
