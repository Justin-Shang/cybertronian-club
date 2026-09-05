import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

export const kanbanColumnsTable = pgTable("kanban_columns", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  agentId: integer("agent_id"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const kanbanCardsTable = pgTable("kanban_cards", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  columnId: integer("column_id").notNull().references(() => kanbanColumnsTable.id, { onDelete: "cascade" }),
  agentId: integer("agent_id"),
  position: integer("position").notNull().default(0),
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type KanbanColumn = typeof kanbanColumnsTable.$inferSelect;
export type InsertKanbanColumn = typeof kanbanColumnsTable.$inferInsert;
export type KanbanCard = typeof kanbanCardsTable.$inferSelect;
export type InsertKanbanCard = typeof kanbanCardsTable.$inferInsert;
