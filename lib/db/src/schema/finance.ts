// Finance 模块 — 家庭财务数据库 schema
// 表名统一 finance_ 前缀，金额用 decimal（财务不容浮点误差）
import { pgTable, text, timestamp, boolean, integer, serial, jsonb, date, decimal, unique } from "drizzle-orm/pg-core";

// ── 1. 收入明细 ──
export const financeIncomeTable = pgTable("finance_income", {
  id: serial("id").primaryKey(),
  txDate: date("tx_date").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  category: text("category").notNull(), // 工资|奖金|理财收益|股票收益|房租|其他
  source: text("source"),
  note: text("note"),
  generated: boolean("generated").notNull().default(false), // 周期规则生成标记
  recurringRuleId: integer("recurring_rule_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 2. 支出明细 ──
export const financeExpenseTable = pgTable("finance_expense", {
  id: serial("id").primaryKey(),
  txDate: date("tx_date").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  category: text("category").notNull(), // 生活|教育|医疗|房贷|保险|旅行|大额一次性|其他
  isMajor: boolean("is_major").notNull().default(false),
  payee: text("payee"),
  note: text("note"),
  generated: boolean("generated").notNull().default(false),
  recurringRuleId: integer("recurring_rule_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 3. 资产负债快照 ──
export const financeNetWorthTable = pgTable("finance_net_worth", {
  id: serial("id").primaryKey(),
  snapshotDate: date("snapshot_date").notNull(),
  totalAssets: decimal("total_assets", { precision: 16, scale: 2 }).notNull(),
  totalLiabilities: decimal("total_liabilities", { precision: 16, scale: 2 }).notNull(),
  netAssets: decimal("net_assets", { precision: 16, scale: 2 }).notNull(), // = total_assets - total_liabilities
  cash: decimal("cash", { precision: 16, scale: 2 }).notNull().default("0"),
  investment: decimal("investment", { precision: 16, scale: 2 }).notNull().default("0"),
  realEstate: decimal("real_estate", { precision: 16, scale: 2 }).notNull().default("0"),
  otherAssets: decimal("other_assets", { precision: 16, scale: 2 }).notNull().default("0"),
  debtBreakdown: jsonb("debt_breakdown").notNull().default({}),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dateUq: unique("finance_net_worth_snapshot_date_uq").on(t.snapshotDate),
}));

// ── 4. 教育基金 ──
export const financeEducationFundTable = pgTable("finance_education_fund", {
  id: serial("id").primaryKey(),
  txDate: date("tx_date").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  direction: text("direction").notNull(), // 存入|取出|收益
  childName: text("child_name").notNull(), // 大宝|二宝
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 5. 债务明细 ──
export const financeDebtTable = pgTable("finance_debt", {
  id: serial("id").primaryKey(),
  txDate: date("tx_date").notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  direction: text("direction").notNull(), // 借入|还款
  lender: text("lender"),
  interestRate: decimal("interest_rate", { precision: 5, scale: 2 }),
  dueDate: date("due_date"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 6. 周期规则 ──
export const financeRecurringRulesTable = pgTable("finance_recurring_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  frequency: text("frequency").notNull(), // monthly|weekly|yearly
  dayOfMonth: integer("day_of_month"), // 1-31；31 在短月取月末
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  category: text("category"),
  targetTable: text("target_table").notNull().default("income"), // income|expense
  source: text("source"),
  note: text("note"),
  active: boolean("active").notNull().default(true),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  nextRunDate: date("next_run_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 7. 情景预测（只存定义，结果实时推演不入库）──
export const financeScenariosTable = pgTable("finance_scenarios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  incomeAdjustments: jsonb("income_adjustments").notNull().default([]),
  expenseAdjustments: jsonb("expense_adjustments").notNull().default([]),
  assetAdjustments: jsonb("asset_adjustments").notNull().default([]),
  baselineYear: integer("baseline_year").notNull(),
  projectedYears: integer("projected_years").notNull().default(10),
  assumptions: jsonb("assumptions").notNull().default({
    inflation: 0.02,
    investmentReturn: 0.04,
    educationGrowth: 0.05,
    mortgageFixed: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
