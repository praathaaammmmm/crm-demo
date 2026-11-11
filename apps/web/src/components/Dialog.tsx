"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./Dialog.module.css";
import { IconButton } from "./IconButton";

/**
 * A modal built on the native <dialog>: focus is trapped while open, Escape closes it, and the
 * browser returns focus to the element that opened it.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  variant = "dialog",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  variant?: "dialog" | "drawer";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={[styles.dialog, variant === "drawer" ? styles.drawer : undefined].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <div className={styles.header}>
        <h2 id={titleId}>{title}</h2>
        <IconButton icon="x" label="Close" onClick={onClose} />
      </div>
      <div className={styles.body}>{open ? children : null}</div>
    </dialog>
  );
}

/** Footer row for dialog actions. */
export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}
