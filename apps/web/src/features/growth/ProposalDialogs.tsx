"use client";

import { markWonRequestSchema, proposalResponseSchema, versionActionRequestSchema, versionNoteRequestSchema, type Proposal } from "@crm/contracts/growth-proposals";
import { useState } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";

type Action = "submit" | "approve" | "reject" | "sent" | "withdraw" | "confirm" | "refuse" | "won";

const config: Record<Action, { label: string; title: string; note: "none" | "optional" | "required"; danger?: boolean }> = {
  submit: { label: "Submit for approval", title: "Submit proposal", note: "optional" },
  approve: { label: "Approve", title: "Approve proposal", note: "optional" },
  reject: { label: "Reject", title: "Reject proposal", note: "required", danger: true },
  sent: { label: "Mark sent", title: "Mark proposal sent", note: "optional" },
  withdraw: { label: "Withdraw", title: "Withdraw proposal", note: "required", danger: true },
  confirm: { label: "Confirm acceptance", title: "Confirm acceptance", note: "optional" },
  refuse: { label: "Refuse acceptance", title: "Refuse acceptance", note: "required", danger: true },
  won: { label: "Mark won", title: "Mark lead won", note: "none" },
};

export function ProposalActionDialog({ leadId, proposal, action }: { leadId: string; proposal: Proposal; action: Action }) {
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run } = useAction();
  const settings = config[action];
  const close = () => { setOpen(false); setError(null); };
  const submit = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const value = data.get("note");
    const note = typeof value === "string" ? value.trim() : "";
    const body = action === "won" ? { versionNo: proposal.currentVersionNo } : { versionNo: proposal.currentVersionNo, ...(note ? { note } : {}) };
    const parser = action === "won" ? markWonRequestSchema : settings.note === "required" ? versionNoteRequestSchema : versionActionRequestSchema;
    if (!parser.safeParse(body).success) {
      setError("Add a note before continuing.");
      return;
    }
    const path = action === "won" ? `/growth/leads/${leadId}/won` : `/growth/proposals/${proposal.id}/${action}`;
    if (await run(() => apiRequest(path, proposalResponseSchema, { method: "POST", body }))) close();
  };
  return (
    <>
      <Button size="sm" variant={settings.danger ? "danger" : "secondary"} onClick={() => { setOpen(true); }}>{settings.label}</Button>
      <Dialog open={open} onClose={close} title={settings.title}>
        <form noValidate onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}>
          {error ? <ErrorNotice message={error} /> : null}
          {settings.note === "none" ? <p>This records the accepted current proposal as won. The amount and date are derived by the server.</p> : (
            <FormField id={`proposal-${action}-note`} label="Note" {...(settings.note === "required" ? {} : { hint: "Optional." })}>
              <textarea id={`proposal-${action}-note`} name="note" maxLength={1000} required={settings.note === "required"} />
            </FormField>
          )}
          <DialogFooter><Button onClick={close}>Cancel</Button><Button type="submit" variant={settings.danger ? "danger" : "primary"} busy={busy}>{settings.label}</Button></DialogFooter>
        </form>
      </Dialog>
    </>
  );
}
