import { pgTable, serial, text, timestamp, jsonb, integer, date } from "drizzle-orm/pg-core";

export const knowledgeGraphsTable = pgTable("knowledge_graphs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  type: text("type").notNull().default("knowledge"),
  ownerAgent: text("owner_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const graphNodesTable = pgTable("graph_nodes", {
  id: serial("id").primaryKey(),
  graphId: serial("graph_id").references(() => knowledgeGraphsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  type: text("type").notNull().default("concept"),
  content: text("content").notNull().default(""),
  color: text("color"),
  metadata: jsonb("metadata").default({}),
  pageId: integer("page_id"),
  sourceDate: date("source_date"),
  externalGraphId: integer("external_graph_id"),
  externalNodeId: integer("external_node_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const graphEdgesTable = pgTable("graph_edges", {
  id: serial("id").primaryKey(),
  graphId: serial("graph_id").references(() => knowledgeGraphsTable.id, { onDelete: "cascade" }),
  sourceNodeId: serial("source_node_id").references(() => graphNodesTable.id, { onDelete: "cascade" }),
  targetNodeId: serial("target_node_id").references(() => graphNodesTable.id, { onDelete: "cascade" }),
  label: text("label").notNull().default(""),
  color: text("color"),
  style: text("style").default("solid"),
  edgeType: text("edge_type"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type KnowledgeGraph = typeof knowledgeGraphsTable.$inferSelect;
export type InsertKnowledgeGraph = typeof knowledgeGraphsTable.$inferInsert;
export type GraphNode = typeof graphNodesTable.$inferSelect;
export type InsertGraphNode = typeof graphNodesTable.$inferInsert;
export type GraphEdge = typeof graphEdgesTable.$inferSelect;
export type InsertGraphEdge = typeof graphEdgesTable.$inferInsert;

// P2-1: 边类型枚举集合（用于校验与配色）
export const EDGE_TYPES = ["属于", "先修", "矛盾", "替代", "应用于", "信号来源", "配合", "其他"] as const;
export type EdgeType = typeof EDGE_TYPES[number];
