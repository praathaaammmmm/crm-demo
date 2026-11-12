"use client";

import { createVersionRequestSchema, proposalResponseSchema, type Proposal } from "@crm/contracts/growth-proposals";
import { useId, useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { DialogFooter } from "../../components/Dialog";
import { Drawer } from "../../components/Drawer";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";
import styles from "./Growth.module.css";

export function ProposalVersionDrawer({ leadId, proposal }: { leadId: string; proposal: Proposal | null }) {
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run } = useAction();
  const uid = useId();
  const close = () => {
    setOpen(false);
    setError(null);
  };
  const submit = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const text = (key: string): string => {
      const value = data.get(key);
      return typeof value === "string" ? value.trim() : "";
    };
    const amount = Number(text("amount"));
    const body = {
      documentUrl: text("documentUrl"),
      amountMinor: Number.isInteger(amount) && amount >= 0 ? amount * 100 : -1,
      validUntil: text("validUntil"),
      summary: text("summary"),
      expectedVersionNo: proposal?.currentVersionNo ?? null,
    };
    if (!createVersionRequestSchema.safeParse(body).success) {
      setError("Enter an HTTPS document link, a whole-rupee amount, validity date, and summary.");
      return;
    }
    if (await run(() => apiRequest(`/growth/leads/${leadId}/proposal/versions`, proposalResponseSchema, { method: "POST", body }))) close();
  };
  return (
    <>
      <Button size="sm" variant="primary" onClick={() => { setOpen(true); }}>
        {proposal ? "New version" : "Create proposal"}
      </Button>
      <Drawer open={open} onClose={close} title={proposal ? "New proposal version" : "Create proposal"}>
        <form noValidate onSubmit={(event: SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); void submit(event.currentTarget); }}>
          {error ? <div className={styles.formError}><ErrorNotice message={error} /></div> : null}
          <FormField id={`${uid}-document`} label="Proposal document" hint="HTTPS link only.">
            <input id={`${uid}-document`} name="documentUrl" type="url" placeholder="https://" required maxLength={2000} />
          </FormField>
          <div className={styles.formRow}>
            <FormField id={`${uid}-amount`} label="Amount (₹)" hint="Whole rupees.">
              <input id={`${uid}-amount`} name="amount" inputMode="numeric" required />
            </FormField>
            <FormField id={`${uid}-valid`} label="Valid until">
              <input id={`${uid}-valid`} name="validUntil" type="date" required />
            </FormField>
          </div>
          <FormField id={`${uid}-summary`} label="Summary">
            <textarea id={`${uid}-summary`} name="summary" required maxLength={2000} />
          </FormField>
          <DialogFooter><Button onClick={close}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save version</Button></DialogFooter>
        </form>
      </Drawer>
    </>
  );
}
