/** An original set of 16px line icons (24-unit grid, 1.5px stroke). Decorative unless a label is given. */

export type IconName =
  | "home"
  | "tasks"
  | "folder"
  | "inbox"
  | "users"
  | "shield"
  | "plus"
  | "x"
  | "menu"
  | "calendar"
  | "link"
  | "alert"
  | "board"
  | "list"
  | "check"
  | "info"
  | "chevron"
  | "bug"
  | "gauge";

const PATHS: Record<IconName, string> = {
  home: "M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z",
  tasks: "M5 5h14v14H5z M8.5 12l2.5 2.5L15.5 10",
  folder: "M4 7a1 1 0 0 1 1-1h4.5l2 2H19a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z",
  inbox: "M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z M4 13h4.5l1 2h5l1-2H20",
  users: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3.5 19c.5-3 2.8-4.5 5.5-4.5s5 1.5 5.5 4.5 M16 5.5a3 3 0 0 1 0 5.5 M17.5 14.7c1.6.5 2.7 1.9 3 4.3",
  shield: "M12 4l7 2.5V12c0 4-3 6.7-7 8-4-1.3-7-4-7-8V6.5z M9 12l2 2 4-4",
  plus: "M12 5v14 M5 12h14",
  x: "M6 6l12 12 M18 6L6 18",
  menu: "M4 7h16 M4 12h16 M4 17h16",
  calendar: "M5 6h14v13H5z M5 10h14 M9 4v4 M15 4v4",
  link: "M10 14l4-4 M8.5 15.5l-1 1a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0 M15.5 8.5l1-1a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0",
  alert: "M12 4l8.5 15h-17z M12 10v4 M12 16.5v.5",
  board: "M4 5h4.5v14H4z M9.75 5h4.5v9h-4.5z M15.5 5H20v11h-4.5z",
  list: "M9 7h11 M9 12h11 M9 17h11 M4.5 7h.5 M4.5 12h.5 M4.5 17h.5",
  check: "M5 12.5l4.5 4.5L19 7.5",
  info: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 11v5 M12 8v.5",
  chevron: "M10 7l5 5-5 5",
  bug: "M9 8.5a3 3 0 0 1 6 0 M8 10h8v4a4 4 0 0 1-8 0z M12 10v8 M8 12.5H4.5 M16 12.5h3.5 M8.5 16.5l-3 2 M15.5 16.5l3 2 M8.5 10L6 7.5 M15.5 10L18 7.5",
  gauge: "M4.5 16a7.5 7.5 0 1 1 15 0 M12 16l3.5-4.5 M7 16h.5 M16.5 16h.5",
};

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label === undefined}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
