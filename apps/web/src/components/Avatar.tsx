import styles from "./Pill.module.css";

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/** Initials on a neutral tone. The full name is exposed to assistive technology. */
export function Avatar({ name, size = "sm" }: { name: string; size?: "xs" | "sm" }) {
  return (
    <span className={[styles.avatar, size === "xs" ? styles.avatarXs : undefined].filter(Boolean).join(" ")} title={name}>
      <span aria-hidden="true">{initialsOf(name)}</span>
      <span className="visually-hidden">{name}</span>
    </span>
  );
}
