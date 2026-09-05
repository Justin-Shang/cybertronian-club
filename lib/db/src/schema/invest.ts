import { pgTable, text, timestamp, boolean, real, integer, serial, jsonb, date, unique } from "drizzle-orm/pg-core";

// ── 股票基础信息（迁移自 PIRS stocks）──
export const stocksTable = pgTable("stocks", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  market: text("market").notNull().default("主板"),
  industry: text("industry").notNull().default("未分类"),
  sector: text("sector").notNull().default("未分类"),
  listingDate: text("listing_date"),
  isSt: boolean("is_st").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 股票指标快照（迁移自 PIRS stock_metrics）──
export const stockMetricsTable = pgTable("stock_metrics", {
  code: text("code").primaryKey().references(() => stocksTable.code, { onDelete: "cascade" }),
  peTtm: real("pe_ttm"),
  pb: real("pb"),
  ps: real("ps"),
  roe: real("roe"),
  grossMargin: real("gross_margin"),
  netMargin: real("net_margin"),
  revenueYoy: real("revenue_yoy"),
  profitYoy: real("profit_yoy"),
  operatingCashflow: real("operating_cashflow"),
  debtToEquity: real("debt_to_equity"),
  dividendYield: real("dividend_yield"),
  marketCap: real("market_cap"),
  price: real("price"),
  priceChangePct: real("price_change_pct"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 资源池（watchlist）──
export const watchlistTable = pgTable("watchlist", {
  code: text("code").primaryKey().references(() => stocksTable.code, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status").notNull().default("stable"), // stable | improving | deteriorating
  notes: text("notes"),
  tags: text("tags").array().notNull().default([]),
  isHolding: boolean("is_holding").notNull().default(false),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 候选池（candidates）──
export const candidatesTable = pgTable("candidates", {
  code: text("code").primaryKey().references(() => stocksTable.code, { onDelete: "cascade" }),
  name: text("name").notNull(),
  score: real("score"),
  peTtm: real("pe_ttm"),
  pb: real("pb"),
  roe: real("roe"),
  grossMargin: real("gross_margin"),
  revenueYoy: real("revenue_yoy"),
  marketCap: real("market_cap"),
  frameworkId: text("framework_id"),
  reason: text("reason"),
  tags: text("tags").array().notNull().default([]),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  screenedAt: timestamp("screened_at", { withTimezone: true }).notNull().defaultNow(),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),  // 否决时间，供6个月排除
});

// ── 投研框架（frameworks）──
export const frameworksTable = pgTable("frameworks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("custom"),
  description: text("description"),
  isBuiltin: boolean("is_builtin").notNull().default(false),
  isEnabled: boolean("is_enabled").notNull().default(true),
  hardFilters: jsonb("hard_filters").notNull().default([]),
  dimensions: jsonb("dimensions").notNull().default([]),
  systemPrompt: text("system_prompt").notNull().default(""),
  environment: text("environment").notNull().default("neutral"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 结构化笔记（核心新增，替代 PIRS research_reports）──
export const investNotesTable = pgTable("invest_notes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().references(() => stocksTable.code, { onDelete: "cascade" }),
  frameworkId: text("framework_id"),
  title: text("title"),
  conclusion: text("conclusion").notNull(),
  // 写入时后端自动从 stock_metrics 拷贝当前指标快照
  indicatorsSnapshot: jsonb("indicators_snapshot").notNull().default({}),
  content: text("content").notNull(),
  author: text("author").notNull().default("agent"), // agent | user | workflow
  agentName: text("agent_name"),
  roomId: integer("room_id"),
  workflowExecutionId: integer("workflow_execution_id"),
  // 反思审计结果（Vibe REFLECT_PROMPT 五块框架）
  audit: jsonb("audit"),
  auditedAt: timestamp("audited_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 估值分位快照（valuation_snapshots）—— 每日 cron 拉取，支持按 code+日期查走势 ──
export const valuationSnapshotsTable = pgTable("valuation_snapshots", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  snapshotDate: date("snapshot_date").notNull(),
  peTtm: real("pe_ttm"),
  pePercentile: real("pe_percentile"),
  peBand: jsonb("pe_band"),
  pbPercentile: real("pb_percentile"),
  pbBand: jsonb("pb_band"),
  source: text("source").notNull().default("akshare"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueCodeDate: unique().on(t.code, t.snapshotDate),
}));

// ── 牛熊辩论（debates）—— 13 项事实底稿 → 多空立论 → 分歧清单 + 验证路径 ──
export const debatesTable = pgTable("debates", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  noteId: integer("note_id"),
  dossier: jsonb("dossier"),
  bullCase: text("bull_case"),
  bearCase: text("bear_case"),
  disagreements: jsonb("disagreements"),
  verifyPaths: jsonb("verify_paths"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 预警（alerts，精简）──
export const alertsTable = pgTable("alerts", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  stockName: text("stock_name").notNull(),
  level: text("level").notNull().default("blue"), // blue | yellow | red
  signalType: text("signal_type").notNull(),
  description: text("description").notNull(),
  source: text("source").notNull().default("system"),
  isRead: boolean("is_read").notNull().default(false),
  noteId: integer("note_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
});

// ── 预警规则（alert_rules）—— 用户/agent 为单只股票配置的指标阈值，同步时自动评估触发 ──
export const alertRulesTable = pgTable("alert_rules", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),                 // 关联股票代码（不强制 FK，允许任意已建股票）
  metric: text("metric").notNull(),             // peTtm | pb | ps | roe | grossMargin | netMargin | revenueYoy | profitYoy | dividendYield | marketCap | price | priceChangePct
  operator: text("operator").notNull(),         // gt | lt | gte | lte | crosses_up | crosses_down
  threshold: real("threshold").notNull(),
  level: text("level").notNull().default("blue"), // blue | yellow | red
  isEnabled: boolean("is_enabled").notNull().default(true),
  note: text("note"),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// 可被规则引用的指标键（与 stock_metrics 字段对齐）
export const ALERT_METRIC_KEYS = [
  "peTtm", "pb", "ps", "roe", "grossMargin", "netMargin",
  "revenueYoy", "profitYoy", "dividendYield", "marketCap", "price", "priceChangePct",
] as const;

export type Stock = typeof stocksTable.$inferSelect;
export type StockMetrics = typeof stockMetricsTable.$inferSelect;
export type WatchlistRow = typeof watchlistTable.$inferSelect;
export type Candidate = typeof candidatesTable.$inferSelect;
export type Framework = typeof frameworksTable.$inferSelect;
export type InvestNote = typeof investNotesTable.$inferSelect;
export type InsertInvestNote = typeof investNotesTable.$inferInsert;
export type Alert = typeof alertsTable.$inferSelect;
export type AlertRule = typeof alertRulesTable.$inferSelect;

export type ValuationSnapshot = typeof valuationSnapshotsTable.$inferSelect;
export type Debate = typeof debatesTable.$inferSelect;


// ── 初筛配置（每周自动初筛）──
export const screenConfigsTable = pgTable("screen_configs", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  frameworkIds: text("framework_ids").array().notNull().default([]),
  topN: integer("top_n").notNull().default(5),
  dayOfWeek: integer("day_of_week").notNull().default(0), // 0=周日..6=周六
  nextRunDate: date("next_run_date").notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// ── 初筛执行记录 ──
export const screenRunsTable = pgTable("screen_runs", {
  id: serial("id").primaryKey(),
  configId: integer("config_id").notNull(),
  frameworkIds: text("framework_ids").array().notNull().default([]),
  pickedCodes: text("picked_codes").array().notNull().default([]),
  poolSize: integer("pool_size"),
  summary: text("summary"),
  status: text("status").notNull().default("ok"), // ok | failed
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScreenConfig = typeof screenConfigsTable.$inferSelect;
export type ScreenRun = typeof screenRunsTable.$inferSelect;

// ── 持仓交易记录 ──
export const investTradesTable = pgTable("invest_trades", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  type: text("type").notNull().default("buy"), // buy | sell
  quantity: real("quantity").notNull(),
  price: real("price").notNull(),
  tradedAt: timestamp("traded_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
  decision: text("decision"),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 复盘记录 ──
export const investReviewsTable = pgTable("invest_reviews", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  content: text("content").notNull(),
  summary: text("summary"),
  tradeSnapshot: jsonb("trade_snapshot").notNull().default({}),
  metricsSnapshot: jsonb("metrics_snapshot").notNull().default({}),
  frameworkId: text("framework_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InvestTrade = typeof investTradesTable.$inferSelect;
export type InvestReview = typeof investReviewsTable.$inferSelect;
