"use client";

import { LEAD_PRIORITIES, LEAD_SOURCES, leadResponseSchema, MAX_VALUE_MINOR, type Lead } from "@crm/contracts/growth-leads";
import { useId, useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { DialogFooter } from "../../components/Dialog";
import { Drawer } from "../../components/Drawer";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { SOURCE_LABELS } from "../../lib/growth-report-view";
import { useAction } from "../../lib/use-action";
import styles from "./Growth.module.css";

export interface CompanyOption {
  id: string;
  name: string;
}
export interface ContactOption {
  id: string;
  companyId: string;
  name: string;
}


/** Whole rupees in the form; paise in the API. Returns undefined when the input is not a valid amount. */
function toMinor(text: string): number | null | undefined {
  if (text.length === 0) return null;
  if (!/^\d{1,10}$/.test(text)) return undefined;
  const minor = Number(text) * 100;
  return minor <= MAX_VALUE_MINOR ? minor : undefined;
}

/** CGO only: create a lead, or edit one (sending only changed fields). Stage, owner and lost details have their own actions. */
export function LeadFormDrawer({ lead, companies, contacts }: { lead?: Lead; companies: CompanyOption[]; contacts: ContactOption[] }) {
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState(lead?.companyId ?? "");
  const { busy, error, setError, run, router } = useAction();
  const uid = useId();
  const editing = lead !== undefined;

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
    const name = text("name");
    if (name.length === 0) {
      setError("Give the lead a name.");
      return;
    }
    const value = toMinor(text("value"));
    if (value === undefined) {
      setError("Use whole rupees, up to ₹1,000,000,000.");
      return;
    }
    const fields = {
      name,
      companyId: text("companyId") || null,
      primaryContactId: text("primaryContactId") || null,
      source: text("source"),
      sourceDetail: text("sourceDetail"),
      priority: text("priority"),
      estimatedValueMinor: value,
      expectedCloseOn: text("expectedCloseOn") || null,
      nextFollowUpOn: text("nextFollowUpOn") || null,
    };

    if (!editing) {
      const body = Object.fromEntries(Object.entries(fields).filter(([, field]) => field !== null && field !== ""));
      const ok = await run(
        () => apiRequest("/growth/leads", leadResponseSchema, { method: "POST", body }),
        (created) => {
          router.push(`/growth/leads/${created.lead.id}`);
        },
      );
      if (ok) close();
      return;
    }
    const current: Record<keyof typeof fields, unknown> = {
      name: lead.name,
      companyId: lead.companyId,
      primaryContactId: lead.primaryContactId,
      source: lead.source,
      sourceDetail: lead.sourceDetail ?? "",
      priority: lead.priority,
      estimatedValueMinor: lead.estimatedValueMinor,
      expectedCloseOn: lead.expectedCloseOn,
      nextFollowUpOn: lead.nextFollowUpOn,
    };
    const changes = Object.fromEntries(Object.entries(fields).filter(([key, field]) => field !== current[key as keyof typeof fields]));
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }
    if (await run(() => apiRequest(`/growth/leads/${lead.id}`, leadResponseSchema, { method: "PATCH", body: changes }))) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(event.currentTarget);
  }

  const title = editing ? "Edit lead" : "New lead";
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
            <input id={`${uid}-name`} name="name" required maxLength={200} defaultValue={lead?.name ?? ""} />
          </FormField>
          <div className={styles.formRow}>
            <FormField id={`${uid}-company`} label="Company" hint="Optional.">
              <select
                id={`${uid}-company`}
                name="companyId"
                value={companyId}
                onChange={(event) => {
                  setCompanyId(event.target.value);
                }}
              >
                <option value="">No company</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id={`${uid}-contact`} label="Primary contact" hint="From the chosen company.">
              <select id={`${uid}-contact`} name="primaryContactId" defaultValue={lead?.primaryContactId ?? ""} disabled={companyId === ""}>
                <option value="">None</option>
                {contacts
                  .filter((contact) => contact.companyId === companyId)
                  .map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
              </select>
            </FormField>
          </div>
          <div className={styles.formRow}>
            <FormField id={`${uid}-source`} label="Source">
              <select id={`${uid}-source`} name="source" defaultValue={lead?.source ?? "linkedin"}>
                {LEAD_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {SOURCE_LABELS[source]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id={`${uid}-priority`} label="Priority">
              <select id={`${uid}-priority`} name="priority" defaultValue={lead?.priority ?? "medium"}>
                {LEAD_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority[0]?.toUpperCase()}
                    {priority.slice(1)}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField id={`${uid}-detail`} label="Source detail" hint="Optional.">
            <input id={`${uid}-detail`} name="sourceDetail" maxLength={200} defaultValue={lead?.sourceDetail ?? ""} />
          </FormField>
          <div className={styles.formRow}>
            <FormField id={`${uid}-value`} label="Estimated value (₹)" hint="Whole rupees. Optional.">
              <input
                id={`${uid}-value`}
                name="value"
                inputMode="numeric"
                defaultValue={lead?.estimatedValueMinor == null ? "" : String(Math.floor(lead.estimatedValueMinor / 100))}
              />
            </FormField>
            <FormField id={`${uid}-close`} label="Expected close" hint="Optional.">
              <input id={`${uid}-close`} name="expectedCloseOn" type="date" defaultValue={lead?.expectedCloseOn ?? ""} />
            </FormField>
          </div>
          <FormField id={`${uid}-follow`} label="Next follow-up" hint="Today or later. Optional.">
            <input id={`${uid}-follow`} name="nextFollowUpOn" type="date" defaultValue={lead?.nextFollowUpOn ?? ""} />
          </FormField>
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              {editing ? "Save changes" : "Create lead"}
            </Button>
          </DialogFooter>
        </form>
      </Drawer>
    </>
  );
}
