import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// 模型路由配置：存储 Cybertron 的二维路由策略（任务等级 × 时间段）
export const modelRoutingConfigsTable = pgTable("model_routing_configs", {
  id: serial("id").primaryKey(),
  target: text("target").notNull().unique(),
  config: jsonb("config").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
