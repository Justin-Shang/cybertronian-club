import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

export const wikiCommentsTable = pgTable("wiki_comments", {
  id: serial("id").primaryKey(),
  pageId: integer("page_id").notNull(),
  selectedText: text("selected_text").notNull(),
  comment: text("comment").notNull(),
  mentionedAgent: text("mentioned_agent").notNull(),
  status: text("status").notNull().default("pending"),
  result: text("result"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export type WikiComment = typeof wikiCommentsTable.$inferSelect;
export type InsertWikiComment = typeof wikiCommentsTable.$inferInsert;
