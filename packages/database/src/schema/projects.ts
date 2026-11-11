import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./organization.js";

/** Created by the CEO/CTO only. Archiving is out of scope. */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check("projects_name_length", sql`char_length(name) BETWEEN 1 AND 200`),
    check("projects_description_length", sql`char_length(description) <= 5000`),
  ],
);
