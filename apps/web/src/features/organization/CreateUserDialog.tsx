"use client";

import { createUserRequestSchema, userResponseSchema } from "@crm/contracts/organization";
import { ASSIGNABLE_ROLES } from "@crm/permissions";
import { useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { DialogFooter } from "../../components/Dialog";
import { Drawer } from "../../components/Drawer";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField, FormSection } from "../../components/FormField";
import { Icon } from "../../components/Icon";
import { apiRequest } from "../../lib/api-client";
import { roleLabel } from "../../lib/navigation";
import { useAction } from "../../lib/use-action";
import styles from "./Organization.module.css";

/**
 * CEO only. The new user reports to the CEO/CTO and must change the temporary password at first
 * sign-in; both are enforced by the API and database, not here.
 */
export function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run } = useAction();

  const close = () => {
    setOpen(false);
    setError(null);
  };

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const value = (key: string) => {
      const entry = data.get(key);
      return typeof entry === "string" ? entry : "";
    };
    const parsed = createUserRequestSchema.safeParse({
      name: value("name"),
      email: value("email"),
      role: value("role"),
      initialPassword: value("initialPassword"),
    });
    if (!parsed.success) {
      setError("Enter a name, a valid email, a role and a temporary password of 12 to 128 characters.");
      return;
    }
    if (await run(() => apiRequest("/users", userResponseSchema, { method: "POST", body: parsed.data }))) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(event.currentTarget);
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
        New user
      </Button>
      <Drawer
        open={open}
        onClose={close}
        title="New user"
        description="Reports directly to the CEO/CTO."
        layout="editor"
      >
        <form onSubmit={onSubmit} noValidate aria-busy={busy}>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          <FormSection title="Profile">
            <FormField id="user-name" label="Name">
              <input id="user-name" name="name" required maxLength={200} autoComplete="off" />
            </FormField>
            <FormField id="user-email" label="Email">
              <input id="user-email" name="email" type="email" required maxLength={254} autoComplete="off" />
            </FormField>
          </FormSection>
          <FormSection title="Access">
            <FormField id="user-role" label="Role" hint="CEO/CTO cannot be assigned.">
              <select id="user-role" name="role" required defaultValue="">
                <option value="" disabled>
                  Choose a role
                </option>
                {ASSIGNABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="user-password" label="Temporary password" hint="12 to 128 characters.">
              <input
                id="user-password"
                name="initialPassword"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </FormField>
            <p className={styles.notice}>
              <Icon name="shield" />
              <span>Share the temporary password privately. They must set a new password at first sign-in.</span>
            </p>
          </FormSection>
          <DialogFooter sticky>
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" busy={busy} busyLabel="Creating…">
              Create user
            </Button>
          </DialogFooter>
        </form>
      </Drawer>
    </>
  );
}
