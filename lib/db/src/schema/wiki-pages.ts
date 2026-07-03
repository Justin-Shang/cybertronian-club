import { pgTable, serial, text, timestamp, pgEnum, integer } from "drizzle-orm/pg-core";

export const categoryEnum = pgEnum("category", ["communication", "skill", "document"]);

export const pagesTable = pgTable("pages", {
  id: serial("id").primaryKey(),
  parentId: integer("parent_id"),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  category: categoryEnum("category").notNull(),
  author: text("author").notNull(),
  tags: text("tags").array().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Page = typeof pagesTable.$inferSelect;
export type InsertPage = typeof pagesTable.$inferInsert;
