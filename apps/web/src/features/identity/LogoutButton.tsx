"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../../components/Button";
import { apiRequest, noContent } from "../../lib/api-client";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    setBusy(true);
    setFailed(false);
    const result = await apiRequest("/auth/logout", noContent, { method: "POST" });
    // An already-ended session is also signed out.
    if (result.ok || result.failure.kind === "unauthenticated") {
      router.replace("/login");
      router.refresh();
      return;
    }
    setBusy(false);
    setFailed(true);
  }

  return (
    <span>
      <Button
        variant="ghost"
        size="sm"
        busy={busy}
        busyLabel="Signing out…"
        onClick={() => {
          void logout();
        }}
      >
        Sign out
      </Button>
      {failed ? <span role="alert"> Could not sign out. Try again.</span> : null}
    </span>
  );
}
