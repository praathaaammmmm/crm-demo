"use client";

import { ACTIVITY_KINDS, ACTIVITY_OUTCOMES, activityResponseSchema, directionAllowed } from "@crm/contracts/growth-leads";
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

export interface ActivityContactOption {
  id: string;
  name: string;
  doNotContact: boolean;
}

export const KIND_LABELS: Record<(typeof ACTIVITY_KINDS)[number], string> = {
  linkedin_dm: "LinkedIn message",
  email: "Email",
  call: "Call",
  meeting: "Meeting",
  follow_up: "Follow-up",
  other: "Other",
};

const OUTCOME_LABELS: Record<(typeof ACTIVITY_OUTCOMES)[number], string> = {
  no_response: "No response",
  replied: "Replied",
  positive: "Positive",
  negative: "Negative",
  meeting_booked: "Meeting booked",
};

/** "YYYY-MM-DDTHH:mm" for a datetime-local input, in the browser's zone. */
const localNow = (): string => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/**
 * CGO only: record manual outreach. Outbound always needs a contact and never goes to a do-not-contact
 * contact. The company is derived by the API from the lead or contact. Nothing is sent from the CRM.
 */
export function ActivityDrawer({ link, contacts }: { link: { leadId?: string; companyId?: string }; contacts: ActivityContactOption[] }) {
  const [open, setOpen] = useState(false);
  const [contactId, setContactId] = useState("");
  const { busy, error, setError, run } = useAction();
  const uid = useId();
  const chosen = contacts.find((contact) => contact.id === contactId);
  const outboundBlocked = !directionAllowed("outbound", chosen !== undefined) || chosen?.doNotContact === true;

  const close = () => {
    setOpen(false);
    setContactId("");
    setError(null);
  };

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const text = (key: string) => {
      const value = data.get(key);
      return typeof value === "string" ? value.trim() : "";
    };
    const direction = text("direction");
    const summary = text("summary");
    const proofUrl = text("proofUrl");
    const occurred = new Date(text("occurredAt"));
    if (direction === "outbound" && outboundBlocked) {
      setError(chosen ? "This contact is marked do not contact. Only inbound activity can be logged." : "Choose a contact for outbound activity.");
      return;
    }
    if (summary.length === 0) {
      setError("Add a short summary.");
      return;
    }
    if (Number.isNaN(occurred.getTime())) {
      setError("Choose when it happened.");
      return;
    }
    if (proofUrl && !isSafeProofUrl(proofUrl)) {
      setError("Use a proof link that starts with https://");
      return;
    }
    const outcome = text("outcome");
    const followUp = text("nextFollowUpOn");
    const body = {
      ...(link.leadId ? { leadId: link.leadId } : { companyId: link.companyId }),
      ...(contactId ? { contactId } : {}),
      kind: text("kind"),
      direction,
      ...(outcome ? { outcome } : {}),
      occurredAt: occurred.toISOString(),
      summary,
      ...(proofUrl ? { proofUrl } : {}),
      ...(followUp && link.leadId ? { nextFollowUpOn: followUp } : {}),
    };
    if (await run(() => apiRequest("/growth/activities", activityResponseSchema, { method: "POST", body }))) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(event.currentTarget);
  }

  return (
    <>
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          setOpen(true);
        }}
      >
        Log activity
      </Button>
      <Drawer open={open} onClose={close} title="Log activity">
        <form onSubmit={onSubmit} noValidate>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          <p className={styles.subtle}>Record outreach you did yourself. The CRM never sends messages.</p>
          <FormField id={`${uid}-contact`} label="Contact" hint="Required for outbound.">
            <select
              id={`${uid}-contact`}
              value={contactId}
              disabled={contacts.length === 0}
              onChange={(event) => {
                setContactId(event.target.value);
              }}
            >
              <option value="">No contact</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                  {contact.doNotContact ? " (do not contact)" : ""}
                </option>
              ))}
            </select>
          </FormField>
          <div className={styles.formRow}>
            <FormField id={`${uid}-direction`} label="Direction">
              <select id={`${uid}-direction`} name="direction" defaultValue="inbound" key={outboundBlocked ? "in" : "any"}>
                <option value="inbound">Inbound (they reached us)</option>
                <option value="outbound" disabled={outboundBlocked}>
                  Outbound (we reached them)
                </option>
              </select>
            </FormField>
            <FormField id={`${uid}-kind`} label="Kind">
              <select id={`${uid}-kind`} name="kind" defaultValue="email">
                {ACTIVITY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <div className={styles.formRow}>
            <FormField id={`${uid}-when`} label="When">
              <input id={`${uid}-when`} name="occurredAt" type="datetime-local" required defaultValue={localNow()} />
            </FormField>
            <FormField id={`${uid}-outcome`} label="Outcome" hint="Optional.">
              <select id={`${uid}-outcome`} name="outcome" defaultValue="">
                <option value="">Not recorded</option>
                {ACTIVITY_OUTCOMES.map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {OUTCOME_LABELS[outcome]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField id={`${uid}-summary`} label="Summary">
            <textarea id={`${uid}-summary`} name="summary" required maxLength={2000} />
          </FormField>
          <FormField id={`${uid}-proof`} label="Proof link" hint="Optional. https:// only.">
            <input id={`${uid}-proof`} name="proofUrl" type="url" placeholder="https://" maxLength={2000} />
          </FormField>
          {link.leadId ? (
            <FormField id={`${uid}-follow`} label="Next follow-up" hint="Optional. Updates the lead.">
              <input id={`${uid}-follow`} name="nextFollowUpOn" type="date" />
            </FormField>
          ) : null}
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              Log activity
            </Button>
          </DialogFooter>
        </form>
      </Drawer>
    </>
  );
}
