import { ROLE_GRANTS, type Role } from "./roles.js";

export interface PermissionSubject {
  role: Role;
}

/** Pure, deny-by-default check. Unknown permission names are always denied. */
export function can(subject: PermissionSubject, permission: string): boolean {
  return ROLE_GRANTS[subject.role].some((granted) => granted === permission);
}
