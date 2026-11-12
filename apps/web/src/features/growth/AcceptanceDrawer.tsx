"use client";

import { ACCEPTANCE_METHODS, acceptanceRequestSchema, proposalResponseSchema, type Proposal } from "@crm/contracts/growth-proposals";
import { useId, useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { DialogFooter } from "../../components/Dialog";
import { Drawer } from "../../components/Drawer";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";
import styles from "./Growth.module.css";

export function AcceptanceDrawer({ proposal }: { proposal: Proposal }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<(typeof ACCEPTANCE_METHODS)[number]>("signed_document");
  const { busy, error, setError, run } = useAction();
  const uid = useId();
  const close = () => { setOpen(false); setError(null); };
  const submit = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const text = (key: string): string => {
      const value = data.get(key);
      return typeof value === "string" ? value.trim() : "";
    };
    const evidenceUrl = text("evidenceUrl");
    const note = text("note");
    const body = {
      versionNo: proposal.currentVersionNo,
      method,
      acceptedOn: text("acceptedOn"),
      ...(evidenceUrl ? { evidenceUrl } : {}),
      ...(note ? { note } : {}),
    };
    if (!acceptanceRequestSchema.safeParse(body).success) {
      setError(method === "verbal" ? "A verbal acceptance needs a note." : "Add an HTTPS evidence link.");
      return;
    }
    if (await run(() => apiRequest(`/growth/proposals/${proposal.id}/acceptance`, proposalResponseSchema, { method: "POST", body }))) close();
  };
  return (
    <>
      <Button size="sm" variant="primary" onClick={() => { setOpen(true); }}>Record acceptance</Button>
      <Drawer open={open} onClose={close} title="Record acceptance">
        <form noValidate onSubmit={(event: SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); void submit(event.currentTarget); }}>
          {error ? <div className={styles.formError}><ErrorNotice message={error} /></div> : null}
          <FormField id={`${uid}-method`} label="Method">
            <select id={`${uid}-method`} value={method} onChange={(event) => { setMethod(event.target.value as typeof method); }}>
              {ACCEPTANCE_METHODS.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
          </FormField>
          <FormField id={`${uid}-date`} label="Accepted on"><input id={`${uid}-date`} name="acceptedOn" type="date" required /></FormField>
          <FormField id={`${uid}-evidence`} label="Evidence link" hint={method === "verbal" ? "Optional for verbal acceptance." : "Required. HTTPS only."}>
            <input id={`${uid}-evidence`} name="evidenceUrl" type="url" placeholder="https://" maxLength={2000} required={method !== "verbal"} />
          </FormField>
          <FormField id={`${uid}-note`} label="Note" hint={method === "verbal" ? "Required for verbal acceptance." : "Optional."}>
            <textarea id={`${uid}-note`} name="note" maxLength={1000} required={method === "verbal"} />
          </FormField>
          <DialogFooter><Button onClick={close}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Record acceptance</Button></DialogFooter>
        </form>
      </Drawer>
    </>
  );
}
