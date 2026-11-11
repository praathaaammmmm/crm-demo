"use client";

import { sessionResponseSchema } from "@crm/contracts/identity";
import { useRouter } from "next/navigation";
import { type SyntheticEvent, useState } from "react";
import { Button } from "../../components/Button";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest, failureMessage } from "../../lib/api-client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await apiRequest("/auth/login", sessionResponseSchema, {
      method: "POST",
      body: { email, password },
    });
    if (result.ok) {
      router.replace(result.data.mustChangePassword ? "/change-password" : "/");
      router.refresh();
      return;
    }
    setBusy(false);
    setPassword("");
    // For login, 401 means wrong credentials, not an expired session.
    setError(result.failure.kind === "unauthenticated" ? "Invalid email or password." : failureMessage(result.failure));
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return (
    <form onSubmit={onSubmit}>
      {error ? <ErrorNotice message={error} /> : null}
      <FormField id="email" label="Email">
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </FormField>
      <FormField id="password" label="Password">
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
      </FormField>
      <Button type="submit" variant="primary" busy={busy} busyLabel="Signing in…">
        Sign in
      </Button>
    </form>
  );
}
