"use client";

import { useId, useState } from "react";
import { buildBody, createdId, type BodyValue, type FieldSpec } from "../lib/action-form";
import { apiRequest, type Parser } from "../lib/api-client";
import { useAction } from "../lib/use-action";
import { Button, type ButtonVariant } from "./Button";
import { Dialog, DialogFooter } from "./Dialog";
import { ErrorNotice } from "./ErrorNotice";
import { FormField } from "./FormField";

/** Mutation responses are not shown; the page re-reads its data after success. */
const anyJson: Parser<unknown> = { safeParse: (input) => ({ success: true, data: input }) };

/**
 * A button that opens a small form dialog and sends one JSON request to the API. Field definitions are plain data,
 * so server pages can describe forms without client code. The API validates everything; errors show its safe message.
 */
export function ActionForm(props: {
  label: string;
  title: string;
  confirm: string;
  path: string;
  method?: "POST" | "PATCH";
  fields?: FieldSpec[];
  fixed?: Record<string, BodyValue>;
  variant?: ButtonVariant;
  /** After creating a record, open `${prefix}${id}` using the id under this response key. */
  redirect?: { key: string; prefix: string };
}) {
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run, router } = useAction();
  const uid = useId();
  const fields = props.fields ?? [];
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
            const data = new FormData(event.currentTarget);
            const result = buildBody(fields, (name) => {
              const value = data.get(name);
              return typeof value === "string" ? value : null;
            }, props.fixed);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            void run(
              () => apiRequest(props.path, anyJson, { method: props.method ?? "POST", body: result.body }),
              (response) => {
                const id = props.redirect ? createdId(response, props.redirect.key) : null;
                if (props.redirect && id !== null) router.push(`${props.redirect.prefix}${id}`);
              },
            ).then((ok) => {
              if (ok) close();
            });
          }}
        >
          {error ? <ErrorNotice message={error} /> : null}
          {fields.map((field) => {
            const id = `${uid}-${field.name}`;
            const common = { id, name: field.name, required: field.required ?? false, defaultValue: field.defaultValue ?? "" };
            const hint = field.hint ?? (field.required ? undefined : "Optional.");
            return (
              <FormField key={field.name} id={id} label={field.label} {...(hint ? { hint } : {})}>
                {field.kind === "textarea" ? (
                  <textarea {...common} maxLength={field.maxLength ?? 2000} />
                ) : field.kind === "select" ? (
                  <select {...common} defaultValue={field.defaultValue ?? field.options?.[0]?.value}>
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.kind === "checkbox" ? (
                  <input id={id} name={field.name} type="checkbox" defaultChecked={field.defaultValue === "true"} />
                ) : (
                  <input
                    {...common}
                    type={field.kind === "datetime" ? "datetime-local" : field.kind === "number" ? "text" : field.kind === "url" ? "url" : field.kind}
                    {...(field.kind === "number" ? { inputMode: "numeric" as const } : {})}
                    maxLength={field.maxLength ?? 2000}
                  />
                )}
              </FormField>
            );
          })}
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
