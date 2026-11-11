import { userRole } from "@crm/database/schema";
import { ROLES } from "@crm/permissions";
import { describe, expect, it } from "vitest";

describe("roles", () => {
  it("packages/permissions ROLES matches the database user_role enum", () => {
    expect([...ROLES]).toEqual(userRole.enumValues);
  });
});
