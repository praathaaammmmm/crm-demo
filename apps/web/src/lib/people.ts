import type { SessionResponse } from "@crm/contracts/identity";
import { directoryPageSchema } from "@crm/contracts/organization";
import { projectPageSchema } from "@crm/contracts/projects";
import { canReadDirectory } from "./navigation";
import { collectPages } from "./server-api";

/** Server-only helpers for showing names without new endpoints. */

export interface People {
  /** Name for a user id; "You" for the viewer. */
  nameOf: (id: string) => string;
  /** Active team members other than the CEO/CTO (for assignment). */
  assignees: { id: string; name: string }[];
  /** True when the directory read hit the 250-item limit. */
  truncated: boolean;
}

/**
 * Directory-backed names for the CEO and approval requesters. Roles without directory access see
 * "You" for themselves and the given fallback for everyone else.
 */
export async function loadPeople(viewer: SessionResponse["user"], fallback = "Team member"): Promise<People> {
  const known = new Map<string, string>([[viewer.id, "You"]]);
  if (!canReadDirectory(viewer.role)) {
    return { nameOf: (id) => known.get(id) ?? fallback, assignees: [], truncated: false };
  }
  const result = await collectPages("/users", directoryPageSchema);
  if (!result.ok) return { nameOf: (id) => known.get(id) ?? "Unknown user", assignees: [], truncated: false };
  for (const person of result.data.items) if (person.id !== viewer.id) known.set(person.id, person.name);
  return {
    nameOf: (id) => known.get(id) ?? "Unknown user",
    assignees: result.data.items
      .filter((person) => person.status === "active" && person.role !== "ceo_cto")
      .map((person) => ({ id: person.id, name: person.name })),
    truncated: result.data.truncated,
  };
}

/** Visible projects (all for the CEO, otherwise those containing the viewer's tasks). */
export async function loadProjects(): Promise<{ list: { id: string; name: string }[]; nameOf: (id: string) => string; truncated: boolean }> {
  const result = await collectPages("/projects", projectPageSchema);
  const list = result.ok ? result.data.items.map((project) => ({ id: project.id, name: project.name })) : [];
  const names = new Map(list.map((project) => [project.id, project.name] as const));
  return { list, nameOf: (id) => names.get(id) ?? "Project", truncated: result.ok && result.data.truncated };
}
