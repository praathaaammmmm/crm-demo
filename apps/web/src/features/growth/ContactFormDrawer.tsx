"use client";

import { contactResponseSchema, LINKEDIN_URL, PHONE, type Contact } from "@crm/contracts/growth";
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

const FIELDS = ["fullName", "roleTitle", "email", "phone", "linkedinUrl", "websiteUrl"] as const;

/** CGO only: add a contact, or edit one. At least one contact method is required (checked here and by the API). */
export function ContactFormDrawer({ companyId, contact }: { companyId: string; contact?: Contact }) {
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run } = useAction();
  const uid = useId();
  const editing = contact !== undefined;

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
    const values = Object.fromEntries(FIELDS.map((field) => [field, text(field)])) as Record<(typeof FIELDS)[number], string>;
    if (values.fullName.length === 0) {
      setError("Add the contact's name.");
      return;
    }
    if (![values.email, values.phone, values.linkedinUrl, values.websiteUrl].some((value) => value.length > 0)) {
      setError("Add at least one way to reach them: email, phone, LinkedIn or website.");
      return;
    }
    if (values.phone && !PHONE.test(values.phone)) {
      setError("Use digits, spaces, +, ( ) or - for the phone number.");
      return;
    }
    if (values.linkedinUrl && !(isSafeProofUrl(values.linkedinUrl) && LINKEDIN_URL.test(values.linkedinUrl))) {
      setError("Use a LinkedIn link that starts with https:// and linkedin.com.");
      return;
    }
    if (values.websiteUrl && !isSafeProofUrl(values.websiteUrl)) {
      setError("Use a website that starts with https://");
      return;
    }

    if (!editing) {
      const body = Object.fromEntries(Object.entries(values).filter(([, value]) => value.length > 0));
      if (await run(() => apiRequest(`/growth/companies/${companyId}/contacts`, contactResponseSchema, { method: "POST", body }))) close();
      return;
    }
    const changes: Record<string, string> = {};
    for (const field of FIELDS) if (values[field] !== (contact[field] ?? "")) changes[field] = values[field];
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }
    if (await run(() => apiRequest(`/growth/contacts/${contact.id}`, contactResponseSchema, { method: "PATCH", body: changes }))) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(event.currentTarget);
  }

  const title = editing ? "Edit contact" : "Add contact";
  return (
    <>
      <Button
        size="sm"
        variant={editing ? "ghost" : "primary"}
        aria-label={editing ? `Edit contact ${contact.fullName}` : undefined}
        onClick={() => {
          setOpen(true);
        }}
      >
        {editing ? "Edit" : title}
      </Button>
      <Drawer open={open} onClose={close} title={title}>
        <form onSubmit={onSubmit} noValidate>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          <div className={styles.formRow}>
            <FormField id={`${uid}-name`} label="Full name">
              <input id={`${uid}-name`} name="fullName" required maxLength={200} defaultValue={contact?.fullName ?? ""} />
            </FormField>
            <FormField id={`${uid}-role`} label="Role" hint="Optional.">
              <input id={`${uid}-role`} name="roleTitle" maxLength={100} defaultValue={contact?.roleTitle ?? ""} />
            </FormField>
          </div>
          <p className={styles.subtle}>Add at least one way to reach them.</p>
          <div className={styles.formRow}>
            <FormField id={`${uid}-email`} label="Email">
              <input id={`${uid}-email`} name="email" type="email" maxLength={254} defaultValue={contact?.email ?? ""} />
            </FormField>
            <FormField id={`${uid}-phone`} label="Phone">
              <input id={`${uid}-phone`} name="phone" type="tel" maxLength={32} defaultValue={contact?.phone ?? ""} />
            </FormField>
          </div>
          <div className={styles.formRow}>
            <FormField id={`${uid}-linkedin`} label="LinkedIn" hint="https://linkedin.com/…">
              <input id={`${uid}-linkedin`} name="linkedinUrl" type="url" placeholder="https://" maxLength={2000} defaultValue={contact?.linkedinUrl ?? ""} />
            </FormField>
            <FormField id={`${uid}-website`} label="Website" hint="https:// only">
              <input id={`${uid}-website`} name="websiteUrl" type="url" placeholder="https://" maxLength={2000} defaultValue={contact?.websiteUrl ?? ""} />
            </FormField>
          </div>
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              {editing ? "Save changes" : "Add contact"}
            </Button>
          </DialogFooter>
        </form>
      </Drawer>
    </>
  );
}
