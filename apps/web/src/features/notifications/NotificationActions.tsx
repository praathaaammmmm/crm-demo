"use client";

import { notificationResponseSchema, readAllResponseSchema } from "@crm/contracts/notifications";
import { Button } from "../../components/Button";
import { apiRequest } from "../../lib/api-client";
import { useAction } from "../../lib/use-action";

export function MarkReadButton({ notificationId, label }: { notificationId: string; label: string }) {
  const { busy, run } = useAction();
  return (
    <Button
      size="sm"
      variant="ghost"
      busy={busy}
      aria-label={`Mark read: ${label}`}
      onClick={() => {
        void run(() => apiRequest(`/notifications/${notificationId}/read`, notificationResponseSchema, { method: "POST", body: {} }));
      }}
    >
      Mark read
    </Button>
  );
}

export function MarkAllReadButton() {
  const { busy, run } = useAction();
  return (
    <Button
      size="sm"
      busy={busy}
      onClick={() => {
        void run(() => apiRequest("/notifications/read-all", readAllResponseSchema, { method: "POST", body: {} }));
      }}
    >
      Mark all read
    </Button>
  );
}
