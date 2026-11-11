import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Must match packages/permissions roles. See docs/security/rbac-matrix.md.
export const userRole = pgEnum("user_role", [
  "ceo_cto",
  "cfo",
  "cgo",
  "cmo",
  "vp_engineering_quality",
  "founder",
  "employee",
  "intern",
  "contractor",
]);

export const userStatus = pgEnum("user_status", ["active", "deactivated"]);

/**
 * Reporting-line rules (ADR 0005) are enforced in SQL migrations:
 * - the composite foreign key is MATCH FULL (not expressible here)
 * - a BEFORE INSERT trigger sets reports_to_* to the Super Admin for every other user
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull(),
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    reportsToUserId: uuid("reports_to_user_id"),
    reportsToIsSuperAdmin: boolean("reports_to_is_super_admin"),
    passwordHash: text("password_hash").notNull(),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    status: userStatus("status").notNull().default("active"),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("users_email_unique").on(t.email),
    unique("users_id_super_admin_unique").on(t.id, t.isSuperAdmin),
    uniqueIndex("users_one_super_admin").on(t.isSuperAdmin).where(sql`is_super_admin`),
    foreignKey({
      name: "users_reports_to_fk",
      columns: [t.reportsToUserId, t.reportsToIsSuperAdmin],
      foreignColumns: [t.id, t.isSuperAdmin],
    }),
    check("users_email_lowercase", sql`email = lower(email)`),
    check("users_email_length", sql`char_length(email) BETWEEN 3 AND 254`),
    check("users_name_length", sql`char_length(name) BETWEEN 1 AND 200`),
    check("users_super_admin_role", sql`is_super_admin = (role = 'ceo_cto')`),
    check("users_super_admin_no_manager", sql`is_super_admin = (reports_to_user_id IS NULL)`),
    check("users_reports_to_super_admin", sql`reports_to_is_super_admin IS DISTINCT FROM false`),
    check("users_super_admin_active", sql`NOT (is_super_admin AND status = 'deactivated')`),
    check("users_deactivated_at", sql`(status = 'deactivated') = (deactivated_at IS NOT NULL)`),
    check("users_failed_login_count", sql`failed_login_count >= 0`),
  ],
);
