import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export const gameSessionsTable = pgTable("game_sessions", {
  id: serial("id").primaryKey(),
  gameType: text("game_type").notNull(),
  player1Type: text("player1_type").notNull(), // 'user' | 'agent'
  player1Id: integer("player1_id").references(() => agentsTable.id, { onDelete: "set null" }),
  player2Type: text("player2_type").notNull(), // 'user' | 'agent'
  player2Id: integer("player2_id").references(() => agentsTable.id, { onDelete: "set null" }),
  state: jsonb("state").notNull().default({}),
  currentTurn: integer("current_turn").notNull().default(1), // 1 or 2
  status: text("status").notNull().default("waiting"), // waiting | playing | finished
  winner: integer("winner"), // 1 | 2 | null (draw)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type GameSession = typeof gameSessionsTable.$inferSelect;
export type InsertGameSession = typeof gameSessionsTable.$inferInsert;
