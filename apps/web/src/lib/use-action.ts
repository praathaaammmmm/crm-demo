"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { failureMessage, redirectForSession, type ApiResult } from "./api-client";

/**
 * Shared client action state: busy flag, safe inline error, and a refresh of server data on success.
 * Session failures redirect to /login or /change-password.
 */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(call: () => Promise<ApiResult<T>>, onSuccess?: (data: T) => void): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await call();
    setBusy(false);
    if (result.ok) {
      onSuccess?.(result.data);
      router.refresh();
      return true;
    }
    if (!redirectForSession(router, result.failure)) setError(failureMessage(result.failure));
    return false;
  }

  return { busy, error, setError, run, router };
}
