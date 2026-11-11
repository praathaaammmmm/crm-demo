"use client";

import { useRouter } from "next/navigation";
import { type SyntheticEvent, useState } from "react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest, failureMessage, noContent, redirectForSession } from "../../lib/api-client";

const MIN = 12;
const MAX = 128;

/** Client-side checks for a friendlier form; the API enforces the same rules. */
function validate(current: string, next: string, confirm: string): string | null {
  if (next.length < MIN || next.length > MAX) return `The new password must be ${String(MIN)}–${String(MAX)} characters.`;
  if (next !== confirm) return "The new passwords do not match.";
  if (next === current) return "The new password must be different from the current one.";
  return null;
}

export function ChangePasswordForm() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const problem = validate(current, next, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiRequest("/auth/password", noContent, {
      method: "POST",
      body: { currentPassword: current, newPassword: next },
    });
    if (result.ok) {
      router.replace("/");
      router.refresh();
      return;
    }
    setBusy(false);
    if (!redirectForSession(router, result.failure)) setError(failureMessage(result.failure));
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return (
    <form onSubmit={onSubmit}>
      {error ? <ErrorNotice message={error} /> : null}
      <FormField id="current-password" label="Current (temporary) password">
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={MAX}
          value={current}
          onChange={(event) => {
            setCurrent(event.target.value);
          }}
        />
      </FormField>
      <FormField id="new-password" label="New password" hint={`${String(MIN)}–${String(MAX)} characters.`}>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN}
          maxLength={MAX}
          value={next}
          onChange={(event) => {
            setNext(event.target.value);
          }}
        />
      </FormField>
      <FormField id="confirm-password" label="Repeat new password">
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN}
          maxLength={MAX}
          value={confirm}
          onChange={(event) => {
            setConfirm(event.target.value);
          }}
        />
      </FormField>
      <Button type="submit" variant="primary" busy={busy}>
        Change password
      </Button>
    </form>
  );
}
