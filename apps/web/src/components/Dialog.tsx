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
  description,
  layout = "default",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  variant?: "dialog" | "drawer";
  /** Optional one-line context under the title; also used as the accessible description. */
  description?: string;
  /** "editor": record-editor layout with a scrolling body and a footer pinned to the bottom (use DialogFooter sticky). */
  layout?: "default" | "editor";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={[
        styles.dialog,
        variant === "drawer" ? styles.drawer : undefined,
        layout === "editor" ? styles.editor : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onClose={onClose}
    >
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 id={titleId}>{title}</h2>
          {description === undefined ? null : (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          )}
        </div>
        <IconButton icon="x" label="Close" onClick={onClose} />
      </div>
      <div className={styles.body}>{open ? children : null}</div>
    </dialog>
  );
}

/** Footer row for dialog actions. `sticky` pins it to the bottom of an editor-layout dialog or drawer. */
export function DialogFooter({ children, sticky = false }: { children: ReactNode; sticky?: boolean }) {
  return <div className={[styles.footer, sticky ? styles.stickyFooter : undefined].filter(Boolean).join(" ")}>{children}</div>;
}
