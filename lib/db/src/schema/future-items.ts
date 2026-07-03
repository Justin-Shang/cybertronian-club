import { pgTable, serial, text, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";

export const futureTypeEnum = pgEnum("future_type", ["todo", "idea", "plan"]);
export const futureStatusEnum = pgEnum("future_status", ["active", "done", "archived"]);

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
  status: futureStatusEnum("status").notNull().default("active"),
  links: jsonb("links").$type<FutureLink[]>().notNull().default([]),
  tags: text("tags").array().notNull().default([]),
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type FutureItem = typeof futureItemsTable.$inferSelect;
export type InsertFutureItem = typeof futureItemsTable.$inferInsert;
