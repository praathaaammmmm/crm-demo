"use client";

import {
  activityResponseSchema,
  LOST_REASONS,
  leadResponseSchema,
  OPEN_STAGES,
  stageLabel,
  type OpenStage,
} from "@crm/contracts/growth-leads";
import { useId, useState, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { Dialog, DialogFooter } from "../../components/Dialog";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest, type ApiResult } from "../../lib/api-client";
import { LOST_LABELS } from "../../lib/growth-report-view";
import { useAction } from "../../lib/use-action";

/** A button that opens a small form dialog; `submit` reads the form and returns null when it set its own error. */
function FormDialog(props: {
  label: string;
  title: string;
  confirm: string;
  variant?: "secondary" | "danger" | "ghost";
  children: ReactNode;
  submit: (data: FormData, setError: (message: string) => void) => (() => Promise<ApiResult<unknown>>) | null;
}) {
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run } = useAction();
  const close = () => {
    setOpen(false);
    setError(null);
  };
  return (
    <>
      <Button
        size="sm"
        variant={props.variant ?? "secondary"}
        onClick={() => {
          setOpen(true);
        }}
      >
        {props.label}
      </Button>
      <Dialog open={open} onClose={close} title={props.title}>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const call = props.submit(new FormData(event.currentTarget), setError);
            if (call) {
              void run(call).then((ok) => {
                if (ok) close();
              });
            }
          }}
        >
          {error ? <ErrorNotice message={error} /> : null}
          {props.children}
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant={props.variant === "danger" ? "danger" : "primary"} busy={busy}>
              {props.confirm}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

const text = (data: FormData, key: string): string => {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
};

function NoteField({ id, label, required }: { id: string; label: string; required: boolean }) {
  return (
    <FormField id={id} label={label} {...(required ? {} : { hint: "Optional." })}>
      <textarea id={id} name="note" maxLength={1000} required={required} />
    </FormField>
  );
}

function StageSelect({ id, label, stages }: { id: string; label: string; stages: readonly OpenStage[] }) {
  return (
    <FormField id={id} label={label}>
      <select id={id} name="to" defaultValue={stages[0]}>
        {stages.map((stage) => (
          <option key={stage} value={stage}>
            {stageLabel(stage)}
          </option>
        ))}
      </select>
    </FormField>
  );
}

/** CGO: move an open lead to another open stage. Won is not offered until proposals exist. */
export function StageDialog({ leadId, targets }: { leadId: string; targets: OpenStage[] }) {
  const uid = useId();
  return (
    <FormDialog
      label="Move stage"
      title="Move to another stage"
      confirm="Move"
      submit={(data) => {
        const note = text(data, "note");
        const body = { to: text(data, "to"), ...(note ? { note } : {}) };
        return () => apiRequest(`/growth/leads/${leadId}/stage`, leadResponseSchema, { method: "POST", body });
      }}
    >
      <StageSelect id={`${uid}-to`} label="New stage" stages={targets} />
      <NoteField id={`${uid}-note`} label="Note" required={false} />
    </FormDialog>
  );
}

/** CGO: mark an open lead lost with a reason and a note. Only the CEO/CTO can reopen it. */
export function LostDialog({ leadId }: { leadId: string }) {
  const uid = useId();
  return (
    <FormDialog
      label="Mark lost"
      title="Mark this lead lost?"
      confirm="Mark lost"
      variant="danger"
      submit={(data, setError) => {
        const note = text(data, "note");
        if (!note) {
          setError("Add a note explaining why.");
          return null;
        }
        const body = { to: "lost", lostReason: text(data, "lostReason"), note };
        return () => apiRequest(`/growth/leads/${leadId}/stage`, leadResponseSchema, { method: "POST", body });
      }}
    >
      <p>Only the CEO/CTO can reopen a lost lead.</p>
      <FormField id={`${uid}-reason`} label="Reason">
        <select id={`${uid}-reason`} name="lostReason" defaultValue="no_response">
          {LOST_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {LOST_LABELS[reason]}
            </option>
          ))}
        </select>
      </FormField>
      <NoteField id={`${uid}-note`} label="Note" required />
    </FormDialog>
  );
}

/** CEO/CTO: reopen a lost lead to an open stage, with a note. */
export function ReopenDialog({ leadId }: { leadId: string }) {
  const uid = useId();
  return (
    <FormDialog
      label="Reopen lead"
      title="Reopen this lead?"
      confirm="Reopen"
      submit={(data, setError) => {
        const note = text(data, "note");
        if (!note) {
          setError("Add a note explaining why.");
          return null;
        }
        return () => apiRequest(`/growth/leads/${leadId}/reopen`, leadResponseSchema, { method: "POST", body: { to: text(data, "to"), note } });
      }}
    >
      <StageSelect id={`${uid}-to`} label="Reopen to" stages={OPEN_STAGES} />
      <NoteField id={`${uid}-note`} label="Note" required />
    </FormDialog>
  );
}

/** CEO/CTO: give the lead to another active CGO. */
export function ReassignDialog({ leadId, ownerId, cgos }: { leadId: string; ownerId: string; cgos: { id: string; name: string }[] }) {
  const uid = useId();
  const choices = cgos.filter((cgo) => cgo.id !== ownerId);
  return (
    <FormDialog
      label="Reassign"
      title="Reassign this lead"
      confirm="Reassign"
      submit={(data, setError) => {
        const owner = text(data, "ownerId");
        if (!owner) {
          setError("There is no other active CGO to assign.");
          return null;
        }
        return () => apiRequest(`/growth/leads/${leadId}/reassign`, leadResponseSchema, { method: "POST", body: { ownerId: owner } });
      }}
    >
      <FormField id={`${uid}-owner`} label="New owner" hint="Active CGOs only.">
        <select id={`${uid}-owner`} name="ownerId" defaultValue={choices[0]?.id ?? ""}>
          {choices.map((cgo) => (
            <option key={cgo.id} value={cgo.id}>
              {cgo.name}
            </option>
          ))}
        </select>
      </FormField>
    </FormDialog>
  );
}

/** CGO: void an activity once, with a reason. It stays visible, marked voided. */
export function VoidActivityDialog({ activityId }: { activityId: string }) {
  const uid = useId();
  return (
    <FormDialog
      label="Void"
      title="Void this activity?"
      confirm="Void activity"
      variant="danger"
      submit={(data, setError) => {
        const reason = text(data, "reason");
        if (!reason) {
          setError("Add a reason.");
          return null;
        }
        return () => apiRequest(`/growth/activities/${activityId}/void`, activityResponseSchema, { method: "POST", body: { reason } });
      }}
    >
      <p>The activity stays in the timeline, marked voided. This cannot be undone.</p>
      <FormField id={`${uid}-reason`} label="Reason">
        <textarea id={`${uid}-reason`} name="reason" maxLength={500} required />
      </FormField>
    </FormDialog>
  );
}
