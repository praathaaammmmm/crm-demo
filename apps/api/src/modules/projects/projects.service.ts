import type { PaginationQuery } from "@crm/contracts/common";
import type { CreateProjectRequest } from "@crm/contracts/projects";
import type { Database } from "@crm/database/client";
import type { AuthSession, Ctx, Executor } from "../../platform/context.js";
import { errors } from "../../platform/errors.js";
import { recordAudit } from "../audit/index.js";
import { PROJECT_AUDIT } from "./projects.audit.js";
import * as policy from "./projects.policy.js";
import * as repo from "./projects.repository.js";
import type { ProjectRow } from "./projects.repository.js";

type User = AuthSession["user"];

/** Provided by the tasks module (connected in app.ts): ids of projects containing the user's tasks. */
export type AssignedProjectIds = (db: Executor, userId: string) => Promise<string[]>;

export interface ProjectDeps {
  db: Database;
  assignedProjectIds: AssignedProjectIds;
}

export async function projectExists(db: Executor, id: string): Promise<boolean> {
  return (await repo.findProject(db, id)) !== null;
}

export async function createProject(
  deps: ProjectDeps,
  ctx: Ctx,
  user: User,
  input: CreateProjectRequest,
): Promise<ProjectRow> {
  policy.assertCanCreate(user);
  return deps.db.transaction(async (tx) => {
    const id = await repo.insertProject(tx, { name: input.name, description: input.description, createdBy: user.id });
    const created = await repo.findProject(tx, id);
    if (!created) throw new Error("Project not found after insert");
    await recordAudit(tx, ctx, { action: PROJECT_AUDIT.created, entityType: "project", entityId: id });
    return created;
  });
}

export async function listProjects(
  deps: ProjectDeps,
  user: User,
  query: PaginationQuery,
): Promise<{ items: ProjectRow[]; nextCursor: string | null }> {
  const scope = policy.readScope(user);
  const onlyIds = scope === "all" ? null : await deps.assignedProjectIds(deps.db, user.id);
  const rows = await repo.listProjects(deps.db, { onlyIds, cursor: query.cursor, limit: query.limit });
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > query.limit && last ? last.id : null };
}

/** A project the caller may not see is reported as 404. */
export async function getProject(deps: ProjectDeps, user: User, id: string): Promise<ProjectRow> {
  const scope = policy.readScope(user);
  if (scope === "assigned" && !(await deps.assignedProjectIds(deps.db, user.id)).includes(id)) {
    throw errors.notFound();
  }
  const project = await repo.findProject(deps.db, id);
  if (!project) throw errors.notFound();
  return project;
}
