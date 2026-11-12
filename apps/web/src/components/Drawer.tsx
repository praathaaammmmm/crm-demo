"use client";

import type { ReactNode } from "react";
import { Dialog } from "./Dialog";

/** A side panel on desktop and a full-width sheet on small screens, with the same behaviour as Dialog. */
export function Drawer(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  description?: string;
  layout?: "default" | "editor";
}) {
  return <Dialog {...props} variant="drawer" />;
}
