import { can, REQUEST_PERMISSION, ROLES, type Role } from "@crm/permissions";
import type { IconName } from "../components/Icon";

/** UI visibility only. The API enforces every permission regardless of what is shown. */

export type NavHref = "/" | "/tasks" | "/projects" | "/review" | "/quality" | "/defects" | "/users" | "/approvals";

export interface NavItem {
  href: NavHref;
  label: string;
  icon: IconName;
}

export interface NavSection {
  title: "Workspace" | "Operations" | "Administration";
  items: NavItem[];
}

export const canDecideApprovals = (role: Role): boolean => can({ role }, "approvals:decide");
export const canReadDirectory = (role: Role): boolean => can({ role }, "users:read_directory");
export const canSeeApprovals = (role: Role): boolean =>
  can({ role }, "approvals:read_all") || Object.values(REQUEST_PERMISSION).some((p) => can({ role }, p));
export const canSeeProjects = (role: Role): boolean =>
  can({ role }, "projects:read_all") || can({ role }, "projects:read_assigned");
export const canCreateProjects = (role: Role): boolean => can({ role }, "projects:create");
export const canSeeTasks = (role: Role): boolean => can({ role }, "tasks:read_all") || can({ role }, "tasks:read_assigned");
export const canReadAllTasks = (role: Role): boolean => can({ role }, "tasks:read_all");
export const canCreateTasks = (role: Role): boolean => can({ role }, "tasks:create");
export const canManageTasks = (role: Role): boolean => can({ role }, "tasks:manage");
export const canReviewTasks = (role: Role): boolean => can({ role }, "tasks:review");
export const canSeeQuality = (role: Role): boolean => can({ role }, "quality:read_all");
export const canManageQuality = (role: Role): boolean => can({ role }, "quality:manage");
export const canSeeDefects = (role: Role): boolean => can({ role }, "quality:read_all") || can({ role }, "quality:read_assigned");

/** Sidebar sections; empty sections are omitted. */
export function navigationFor(role: Role): NavSection[] {
  const workspace: NavItem[] = [{ href: "/", label: canDecideApprovals(role) ? "Dashboard" : "Home", icon: "home" }];
  if (canSeeTasks(role)) workspace.push({ href: "/tasks", label: canReadAllTasks(role) ? "Tasks" : "My tasks", icon: "tasks" });

  const operations: NavItem[] = [];
  if (canSeeProjects(role)) operations.push({ href: "/projects", label: "Projects", icon: "folder" });
  if (canReviewTasks(role)) operations.push({ href: "/review", label: "Review", icon: "inbox" });
  if (canSeeQuality(role)) operations.push({ href: "/quality", label: "Quality", icon: "gauge" });
  if (canSeeDefects(role)) operations.push({ href: "/defects", label: "Defects", icon: "bug" });

  const administration: NavItem[] = [];
  if (canReadDirectory(role)) administration.push({ href: "/users", label: "Users", icon: "users" });
  if (canSeeApprovals(role)) administration.push({ href: "/approvals", label: "Approvals", icon: "shield" });

  const sections: NavSection[] = [
    { title: "Workspace", items: workspace },
    { title: "Operations", items: operations },
    { title: "Administration", items: administration },
  ];
  return sections.filter((section) => section.items.length > 0);
}

/** All items in sidebar order. */
export const navItemsFor = (role: Role): NavItem[] => navigationFor(role).flatMap((section) => section.items);

const ROLE_LABELS: Record<Role, string> = {
  ceo_cto: "CEO/CTO",
  cfo: "CFO",
  cgo: "CGO",
  cmo: "CMO",
  vp_engineering_quality: "VP Engineering & Quality",
  founder: "Founder",
  employee: "Employee",
  intern: "Intern",
  contractor: "Contractor",
};

export const roleLabel = (role: Role): string => ROLE_LABELS[role];

export const isRole = (value: unknown): value is Role => ROLES.some((role) => role === value);
