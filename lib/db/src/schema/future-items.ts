import { pgTable, serial, text, boolean, timestamp, pgEnum, jsonb, integer } from "drizzle-orm/pg-core";

export const futureTypeEnum = pgEnum("future_type", ["todo", "idea", "plan"]);
export const futureStatusEnum = pgEnum("future_status", ["not_started", "preparing", "in_progress", "done"]);

export type FutureLink = {
  label: string;
  url: string;
  kind: "wiki" | "external";
};

export const futureItemsTable = pgTable("future_items", {
  id: serial("id").primaryKey(),
  type: futureTypeEnum("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  status: futureStatusEnum("status").notNull().default("not_started"),
  links: jsonb("links").$type<FutureLink[]>().notNull().default([]),
  tags: text("tags").array().notNull().default([]),
  dueDate: timestamp("due_date"),
  startMonth: text("start_month"),
  endMonth: text("end_month"),
  backlog: boolean("backlog").notNull().default(false),
  parentId: integer("parent_id").references(() => futureItemsTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type FutureItem = typeof futureItemsTable.$inferSelect;
export type InsertFutureItem = typeof futureItemsTable.$inferInsert;