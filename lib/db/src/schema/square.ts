import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export const squarePostsTable = pgTable("square_posts", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  senderType: text("sender_type", { enum: ["user", "agent"] }).notNull().default("user"),
  senderId: integer("sender_id").references(() => agentsTable.id, { onDelete: "set null" }),
  senderName: text("sender_name").notNull(),
  senderColor: text("sender_color").notNull().default("#64748b"),
  upvotes: integer("upvotes").notNull().default(0),
  downvotes: integer("downvotes").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const squareRepliesTable = pgTable("square_replies", {
  id: serial("id").primaryKey(),
  postId: integer("post_id")
    .notNull()
    .references(() => squarePostsTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  senderType: text("sender_type", { enum: ["user", "agent"] }).notNull().default("user"),
  senderId: integer("sender_id").references(() => agentsTable.id, { onDelete: "set null" }),
  senderName: text("sender_name").notNull(),
  senderColor: text("sender_color").notNull().default("#64748b"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
