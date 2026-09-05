/**
 * Finance 家庭财务模块 API 路由。
 *
 * 挂载于 /api 前缀下，故所有路径以 /finance 开头，对外为 /api/finance/...。
 * 认证由全局 authMiddleware 覆盖（app.ts），路由内不写 per-route auth。
 *
 * 覆盖：
 *  - P0-1 表管理 + 5 表 CRUD
 *  - P0-2 石墨导入（双模式：结构化 + LLM 智能提取）
 *  - P0-3 NL 插入（解析 → 确认 → 写入）
 *  - P0-4 周期规则（CRUD + 手动触发 + 补录历史）
 *  - P0-5 NL 查询分析（SQL 生成 + 转述 + 综合指标 + 趋势）
 *  - P1-3 大额支出 / P1-4 导出 / P1-5 情景预测 / P1-6 Agent 端点（复用）
 */
import { Router } from "express";
import multer from "multer";
import {
  db,
  financeIncomeTable,
  financeExpenseTable,
  financeNetWorthTable,
  financeEducationFundTable,
  financeDebtTable,
  financeRecurringRulesTable,
  financeScenariosTable,
} from "@workspace/db";
import { eq, and, desc, gte, lte, sql, ilike, or, isNull } from "drizzle-orm";
import {
  parseInsertionLLM,
  generateSqlLLM,
  extractRowsLLM,
  extractPivotSplitLLM,
  parseScenarioLLM,
  narrateResultLLM,
  parseRecurringLLM,
} from "../lib/finance-llm";
import { computeMetrics, getYearlyTrends, getYearlySummary } from "../lib/finance-metrics";
import { runScenario } from "../lib/finance-scenario";
import { processRecurringRules, runRuleOnce, computeBackfillDates } from "../lib/finance-recurring";
import { parseUpload, applyMapping, detectShape, inferMapping, suggestTable, type SheetData } from "../lib/finance-import";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // 同时检查 mimetype 和文件扩展名（curl 上传 CSV 经常被识别为 application/octet-stream）
    const okMime = [
      "text/csv",
      "text/plain",
      "application/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/octet-stream",
    ].includes(file.mimetype);
    const ext = (file.originalname || "").toLowerCase().split(".").pop() || "";
    const okExt = ["csv", "xlsx", "xls"].includes(ext);
    cb(okMime || okExt ? null : new Error("仅支持 CSV/Excel"), okMime || okExt);
  },
});

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

const MAJOR_THRESHOLD = () => Number(process.env.FINANCE_MAJOR_THRESHOLD || "10000");

// ──────────────── 表 schema 自描述 ────────────────

const TABLE_SCHEMAS = [
  {
    table: "income",
    label: "收入明细",
    columns: [
      { field: "tx_date", type: "date", label: "到账日期", required: true },
      { field: "amount", type: "decimal", label: "金额", required: true },
      { field: "category", type: "text", label: "分类", enum: ["工资", "奖金", "理财收益", "股票收益", "房租", "其他"] },
      { field: "source", type: "text", label: "来源方" },
      { field: "note", type: "text", label: "备注" },
    ],
  },
  {
    table: "expense",
    label: "支出明细",
    columns: [
      { field: "tx_date", type: "date", label: "支出日期", required: true },
      { field: "amount", type: "decimal", label: "金额", required: true },
      { field: "category", type: "text", label: "分类", enum: ["生活", "教育", "医疗", "房贷", "保险", "旅行", "大额一次性", "其他"] },
      { field: "is_major", type: "boolean", label: "大额支出" },
      { field: "payee", type: "text", label: "收款方" },
      { field: "note", type: "text", label: "备注" },
    ],
  },
  {
    table: "net_worth",
    label: "资产负债快照",
    columns: [
      { field: "snapshot_date", type: "date", label: "快照日期", required: true },
      { field: "total_assets", type: "decimal", label: "总资产", required: true },
      { field: "total_liabilities", type: "decimal", label: "总负债", required: true },
      { field: "cash", type: "decimal", label: "现金" },
      { field: "investment", type: "decimal", label: "投资" },
      { field: "real_estate", type: "decimal", label: "房产" },
      { field: "other_assets", type: "decimal", label: "其他资产" },
      { field: "debt_breakdown", type: "json", label: "负债明细" },
      { field: "note", type: "text", label: "备注" },
    ],
  },
  {
    table: "education_fund",
    label: "教育基金",
    columns: [
      { field: "tx_date", type: "date", label: "日期", required: true },
      { field: "amount", type: "decimal", label: "金额", required: true },
      { field: "direction", type: "text", label: "方向", enum: ["存入", "取出", "收益"] },
      { field: "child_name", type: "text", label: "孩子", required: true },
      { field: "note", type: "text", label: "备注" },
    ],
  },
  {
    table: "debt",
    label: "债务明细",
    columns: [
      { field: "tx_date", type: "date", label: "日期", required: true },
      { field: "amount", type: "decimal", label: "金额", required: true },
      { field: "direction", type: "text", label: "方向", enum: ["借入", "还款"] },
      { field: "lender", type: "text", label: "债权人" },
      { field: "interest_rate", type: "decimal", label: "利率%" },
      { field: "due_date", type: "date", label: "到期日" },
      { field: "note", type: "text", label: "备注" },
    ],
  },
  {
    table: "recurring_rules",
    label: "周期规则",
    columns: [
      { field: "name", type: "text", label: "规则名", required: true },
      { field: "frequency", type: "text", label: "频率", enum: ["monthly", "weekly", "yearly"] },
      { field: "day_of_month", type: "integer", label: "每月几号" },
      { field: "amount", type: "decimal", label: "每期金额", required: true },
      { field: "category", type: "text", label: "分类" },
      { field: "target_table", type: "text", label: "目标表", enum: ["income", "expense"] },
      { field: "active", type: "boolean", label: "启用" },
      { field: "start_date", type: "date", label: "生效起始日", required: true },
      { field: "end_date", type: "date", label: "结束日期" },
    ],
  },
  {
    table: "scenarios",
    label: "情景预测",
    columns: [
      { field: "name", type: "text", label: "情景名", required: true },
      { field: "description", type: "text", label: "描述" },
      { field: "projected_years", type: "integer", label: "预测年限" },
    ],
  },
];

router.get("/finance/tables", (_req, res) => {
  res.json(TABLE_SCHEMAS);
});

// ──────────────── P0-1: 收入 CRUD ────────────────

router.get("/finance/income", async (req, res) => {
  try {
    const { from, to, category, q, page, size } = req.query;
    const conditions = [];
    if (from) conditions.push(gte(financeIncomeTable.txDate, from));
    if (to) conditions.push(lte(financeIncomeTable.txDate, to));
    if (category) conditions.push(eq(financeIncomeTable.category, category));
    if (q) conditions.push(or(ilike(financeIncomeTable.note, `%${q}%`), ilike(financeIncomeTable.source, `%${q}%`)));
    const pageNum = Math.max(1, Number(page) || 1);
    const sizeNum = Math.min(200, Math.max(1, Number(size) || 50));
    const rows = await db.select().from(financeIncomeTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(financeIncomeTable.txDate))
      .limit(sizeNum).offset((pageNum - 1) * sizeNum);
    res.json(rows.map((r) => ({ ...r, amount: num(r.amount) })));
  } catch (err) { req.log.error({ err }, "GET /finance/income failed"); res.status(500).json({ error: "查询失败" }); }
});

router.post("/finance/income", async (req, res) => {
  try {
    const { tx_date, amount, category, source, note } = req.body;
    if (!amount || num(amount) <= 0) return res.status(400).json({ error: "金额必须为正数" });
    const row = await db.insert(financeIncomeTable).values({
      txDate: tx_date || new Date().toISOString().slice(0, 10),
      amount: String(num(amount)),
      category: category || "其他",
      source: source || null,
      note: note || null,
    }).returning();
    res.status(201).json({ ...row[0], amount: num(row[0].amount) });
  } catch (err) { req.log.error({ err }, "POST /finance/income failed"); res.status(400).json({ error: "新增失败" }); }
});

router.put("/finance/income/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    const { tx_date, amount, category, source, note } = req.body;
    const row = await db.update(financeIncomeTable).set({
      ...(tx_date !== undefined && { txDate: tx_date }),
      ...(amount !== undefined && { amount: String(num(amount)) }),
      ...(category !== undefined && { category }),
      ...(source !== undefined && { source }),
      ...(note !== undefined && { note }),
    }).where(eq(financeIncomeTable.id, id)).returning();
    if (row.length === 0) return res.status(404).json({ error: "记录不存在" });
    res.json({ ...row[0], amount: num(row[0].amount) });
  } catch (err) { req.log.error({ err }, "PUT /finance/income failed"); res.status(400).json({ error: "更新失败" }); }
});

router.delete("/finance/income/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    const row = await db.delete(financeIncomeTable).where(eq(financeIncomeTable.id, id)).returning();
    if (row.length === 0) return res.status(404).json({ error: "记录不存在" });
    res.json({ deleted: true });
  } catch (err) { req.log.error({ err }, "DELETE /finance/income failed"); res.status(500).json({ error: "删除失败" }); }
});

// ──────────────── P0-1: 支出 CRUD ────────────────

router.get("/finance/expense", async (req, res) => {
  try {
    const { from, to, category, q, is_major, page, size } = req.query;
    const conditions = [];
    if (from) conditions.push(gte(financeExpenseTable.txDate, from));
    if (to) conditions.push(lte(financeExpenseTable.txDate, to));
    if (category) conditions.push(eq(financeExpenseTable.category, category));
    if (is_major === "true") conditions.push(eq(financeExpenseTable.isMajor, true));
    if (q) conditions.push(or(ilike(financeExpenseTable.note, `%${q}%`), ilike(financeExpenseTable.payee, `%${q}%`)));
    const pageNum = Math.max(1, Number(page) || 1);
    const sizeNum = Math.min(200, Math.max(1, Number(size) || 50));
    const rows = await db.select().from(financeExpenseTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(financeExpenseTable.txDate))
      .limit(sizeNum).offset((pageNum - 1) * sizeNum);
    res.json(rows.map((r) => ({ ...r, amount: num(r.amount) })));
  } catch (err) { req.log.error({ err }, "GET /finance/expense failed"); res.status(500).json({ error: "查询失败" }); }
});

router.post("/finance/expense", async (req, res) => {
  try {
    const { tx_date, amount, category, payee, note, is_major } = req.body;
    if (!amount || num(amount) <= 0) return res.status(400).json({ error: "金额必须为正数" });
    const amt = num(amount);
    const row = await db.insert(financeExpenseTable).values({
      txDate: tx_date || new Date().toISOString().slice(0, 10),
      amount: String(amt),
      category: category || "其他",
      isMajor: is_major !== undefined ? Boolean(is_major) : amt >= MAJOR_THRESHOLD(),
      payee: payee || null,
      note: note || null,
    }).returning();
    res.status(201).json({ ...row[0], amount: num(row[0].amount) });
  } catch (err) { req.log.error({ err }, "POST /finance/expense failed"); res.status(400).json({ error: "新增失败" }); }
});

router.put("/finance/expense/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    const { tx_date, amount, category, payee, note, is_major } = req.body;
    const row = await db.update(financeExpenseTable).set({
      ...(tx_date !== undefined && { txDate: tx_date }),
      ...(amount !== undefined && { amount: String(num(amount)), isMajor: num(amount) >= MAJOR_THRESHOLD() }),
      ...(category !== undefined && { category }),
      ...(payee !== undefined && { payee }),
      ...(note !== undefined && { note }),
      ...(is_major !== undefined && { isMajor: Boolean(is_major) }),
    }).where(eq(financeExpenseTable.id, id)).returning();
    if (row.length === 0) return res.status(404).json({ error: "记录不存在" });
    res.json({ ...row[0], amount: num(row[0].amount) });
  } catch (err) { req.log.error({ err }, "PUT /finance/expense failed"); res.status(400).json({ error: "更新失败" }); }
});

router.delete("/finance/expense/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    const row = await db.delete(financeExpenseTable).where(eq(financeExpenseTable.id, id)).returning();
    if (row.length === 0) return res.status(404).json({ error: "记录不存在" });
    res.json({ deleted: true });
  } catch (err) { req.log.error({ err }, "DELETE /finance/expense failed"); res.status(500).json({ error: "删除失败" }); }
});

// ──────────────── P0-1: 资产负债快照 CRUD ────────────────

router.get("/finance/net-worth", async (_req, res) => {
  try {
    const rows = await db.select().from(financeNetWorthTable).orderBy(desc(financeNetWorthTable.snapshotDate)).limit(100);
    res.json(rows.map((r) => ({
      ...r,
      totalAssets: num(r.totalAssets), totalLiabilities: num(r.totalLiabilities), netAssets: num(r.netAssets),
      cash: num(r.cash), investment: num(r.investment), realEstate: num(r.realEstate), otherAssets: num(r.otherAssets),
    })));
  } catch (err) { req.log.error({ err }, "GET /finance/net-worth failed"); res.status(500).json({ error: "查询失败" }); }
});

router.post("/finance/net-worth", async (req, res) => {
  try {
    const { snapshot_date, total_assets, total_liabilities, cash, investment, real_estate, other_assets, debt_breakdown, note } = req.body;
    if (!snapshot_date) return res.status(400).json({ error: "快照日期必填" });
    const ta = num(total_assets), tl = num(total_liabilities);
    const row = await db.insert(financeNetWorthTable).values({
      snapshotDate: snapshot_date,
      totalAssets: String(ta), totalLiabilities: String(tl), netAssets: String(ta - tl),
      cash: String(num(cash)), investment: String(num(investment)), realEstate: String(num(real_estate)), otherAssets: String(num(other_assets)),
      debtBreakdown: debt_breakdown || {},
      note: note || null,
    }).returning();
    res.status(201).json({ ...row[0], totalAssets: ta, totalLiabilities: tl, netAssets: ta - tl });
  } catch (err) { req.log.error({ err }, "POST /finance/net-worth failed"); res.status(400).json({ error: "新增失败" }); }
});

router.put("/finance/net-worth/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    const b = req.body;
    const ta = num(b.total_assets), tl = num(b.total_liabilities);
    const updates: Record<string, unknown> = {};
    if (b.snapshot_date !== undefined) updates.snapshotDate = b.snapshot_date;
    if (b.total_assets !== undefined) { updates.totalAssets = String(ta); updates.netAssets = String(ta - num(b.total_liabilities)); }
    if (b.total_liabilities !== undefined) { updates.totalLiabilities = String(tl); updates.netAssets = String(num(b.total_assets) - tl); }
    if (b.cash !== undefined) updates.cash = String(num(b.cash));
    if (b.investment !== undefined) updates.investment = String(num(b.investment));
    if (b.real_estate !== undefined) updates.realEstate = String(num(b.real_estate));
    if (b.other_assets !== undefined) updates.otherAssets = String(num(b.other_assets));
    if (b.debt_breakdown !== undefined) updates.debtBreakdown = b.debt_breakdown;
    if (b.note !== undefined) updates.note = b.note;
    const row = await db.update(financeNetWorthTable).set(updates).where(eq(financeNetWorthTable.id, id)).returning();
    if (row.length === 0) return res.status(404).json({ error: "记录不存在" });
    res.json({ ...row[0], totalAssets: num(row[0].totalAssets) });
  } catch (err) { req.log.error({ err }, "PUT /finance/net-worth failed"); res.status(400).json({ error: "更新失败" }); }
});

router.delete("/finance/net-worth/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    const row = await db.delete(financeNetWorthTable).where(eq(financeNetWorthTable.id, id)).returning();
    if (row.length === 0) return res.status(404).json({ error: "记录不存在" });
    res.json({ deleted: true });
  } catch (err) { req.log.error({ err }, "DELETE /finance/net-worth failed"); res.status(500).json({ error: "删除失败" }); }
});

// ──────────────── P0-1: 教育基金 / 债务 CRUD（精简）────────────────

router.get("/finance/education-fund", async (req, res) => {
  try {
    const conditions = [];
    if (req.query.child_name) conditions.push(eq(financeEducationFundTable.childName, String(req.query.child_name)));
    const rows = await db.select().from(financeEducationFundTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(financeEducationFundTable.txDate)).limit(200);
    res.json(rows.map((r) => ({ ...r, amount: num(r.amount) })));
  } catch (err) { req.log.error({ err }, "GET /finance/education-fund failed"); res.status(500).json({ error: "查询失败" }); }
});

router.post("/finance/education-fund", async (req, res) => {
  try {
    const { tx_date, amount, direction, child_name, note } = req.body;
    if (!amount || num(amount) <= 0) return res.status(400).json({ error: "金额必须为正数" });
    if (!child_name) return res.status(400).json({ error: "孩子标识必填" });
    const row = await db.insert(financeEducationFundTable).values({
      txDate: tx_date || new Date().toISOString().slice(0, 10),
      amount: String(num(amount)), direction: direction || "存入", childName: child_name, note: note || null,
    }).returning();
    res.status(201).json({ ...row[0], amount: num(row[0].amount) });
  } catch (err) { req.log.error({ err }, "POST /finance/education-fund failed"); res.status(400).json({ error: "新增失败" }); }
});

router.put("/finance/education-fund/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    const b = req.body;
    const updates: Record<string, unknown> = {};
    if (b.tx_date !== undefined) updates.txDate = b.tx_date;
    if (b.amount !== undefined) updates.amount = String(num(b.amount));
    if (b.direction !== undefined) updates.direction = b.direction;
    if (b.child_name !== undefined) updates.childName = b.child_name;
    if (b.note !== undefined) updates.note = b.note;
    const row = await db.update(financeEducationFundTable).set(updates).where(eq(financeEducationFundTable.id, id)).returning();
    if (row.length === 0) return res.status(404).json({ error: "记录不存在" });
    res.json({ ...row[0], amount: num(row[0].amount) });
  } catch (err) { req.log.error({ err }, "PUT /finance/education-fund failed"); res.status(400).json({ error: "更新失败" }); }
});

router.delete("/finance/education-fund/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    await db.delete(financeEducationFundTable).where(eq(financeEducationFundTable.id, id));
    res.json({ deleted: true });
  } catch (err) { req.log.error({ err }, "DELETE /finance/education-fund failed"); res.status(500).json({ error: "删除失败" }); }
});

router.get("/finance/debt", async (_req, res) => {
  try {
    const rows = await db.select().from(financeDebtTable).orderBy(desc(financeDebtTable.txDate)).limit(200);
    res.json(rows.map((r) => ({ ...r, amount: num(r.amount), interestRate: r.interestRate ? num(r.interestRate) : null })));
  } catch (err) { req.log.error({ err }, "GET /finance/debt failed"); res.status(500).json({ error: "查询失败" }); }
});

router.post("/finance/debt", async (req, res) => {
  try {
    const { tx_date, amount, direction, lender, interest_rate, due_date, note } = req.body;
    if (!amount || num(amount) <= 0) return res.status(400).json({ error: "金额必须为正数" });
    const row = await db.insert(financeDebtTable).values({
      txDate: tx_date || new Date().toISOString().slice(0, 10),
      amount: String(num(amount)), direction: direction || "借入",
      lender: lender || null, interestRate: interest_rate ? String(num(interest_rate)) : null,
      dueDate: due_date || null, note: note || null,
    }).returning();
    res.status(201).json({ ...row[0], amount: num(row[0].amount) });
  } catch (err) { req.log.error({ err }, "POST /finance/debt failed"); res.status(400).json({ error: "新增失败" }); }
});

router.put("/finance/debt/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    const b = req.body;
    const updates: Record<string, unknown> = {};
    if (b.tx_date !== undefined) updates.txDate = b.tx_date;
    if (b.amount !== undefined) updates.amount = String(num(b.amount));
    if (b.direction !== undefined) updates.direction = b.direction;
    if (b.lender !== undefined) updates.lender = b.lender;
    if (b.interest_rate !== undefined) updates.interestRate = b.interest_rate ? String(num(b.interest_rate)) : null;
    if (b.due_date !== undefined) updates.dueDate = b.due_date;
    if (b.note !== undefined) updates.note = b.note;
    const row = await db.update(financeDebtTable).set(updates).where(eq(financeDebtTable.id, id)).returning();
    if (row.length === 0) return res.status(404).json({ error: "记录不存在" });
    res.json({ ...row[0], amount: num(row[0].amount) });
  } catch (err) { req.log.error({ err }, "PUT /finance/debt failed"); res.status(400).json({ error: "更新失败" }); }
});

router.delete("/finance/debt/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    await db.delete(financeDebtTable).where(eq(financeDebtTable.id, id));
    res.json({ deleted: true });
  } catch (err) { req.log.error({ err }, "DELETE /finance/debt failed"); res.status(500).json({ error: "删除失败" }); }
});

// ──────────────── P0-2: 石墨导入 ────────────────

router.post("/finance/import/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "未上传文件" });
    const parsed = parseUpload(req.file.buffer, req.file.mimetype);
    res.json(parsed);
  } catch (err) { req.log.error({ err }, "import upload failed"); res.status(400).json({ error: String(err) }); }
});

// 新增：对单个 sheet 做形态识别 + 规范化 + 拆分建议（前端用来决定送哪张表）
router.post("/finance/import/analyze", async (req, res) => {
  try {
    const { name, rows, headers } = req.body;
    if (!Array.isArray(rows) || !Array.isArray(headers)) {
      return res.status(400).json({ error: "name/rows/headers 必填" });
    }
    const shape = detectShape(headers, rows);
    const mapping = inferMapping(headers);
    const suggestedTable = suggestTable(name || "", headers, mapping);

    // 透视表形态支持拆分到多张表
    const splitTargets = shape === "pivot"
      ? ["net_worth", "income", "expense", "debt"].filter((t) => {
          const allText = headers.join(" ");
          if (t === "net_worth") return /总资产|总负债|净资产/.test(allText);
          if (t === "income") return /收入/.test(allText);
          if (t === "expense") return /支出/.test(allText);
          if (t === "debt") return /负债明细|借/.test(allText);
          return false;
        })
      : [suggestedTable];

    res.json({
      shape,
      rowCount: rows.length,
      suggestedTable,
      inferredMapping: mapping,
      splitTargets,
      normalizedRows: rows, // upload 阶段已规范化
    });
  } catch (err) { req.log.error({ err }, "import analyze failed"); res.status(500).json({ error: "分析失败" }); }
});

router.post("/finance/import/preview", async (req, res) => {
  try {
    const { table, rows, mode, mapping } = req.body;
    if (!Array.isArray(rows)) return res.status(400).json({ error: "rows 必须为数组" });
    if (mode === "structured") {
      const result = applyMapping(rows, mapping || {});
      res.json({ mode: "structured", rows: result });
    } else if (mode === "smart") {
      // smart 模式：按目标表 schema LLM 提取
      const { extracted } = await extractRowsLLM(rows, table || "income");
      res.json({ mode: "smart", rows: extracted, table });
    } else if (mode === "pivot") {
      // pivot 模式：单表 LLM 提取（按目标表 schema）
      const { extracted } = await extractRowsLLM(rows, table || "income");
      res.json({ mode: "pivot", rows: extracted, table });
    } else if (mode === "pivot_split") {
      // pivot_split 模式：透视表多表拆分（一行拆成 net_worth+income+expense+debt）
      const { splits } = await extractPivotSplitLLM(rows);
      res.json({ mode: "pivot_split", splits, tables: Object.keys(splits) });
    } else {
      res.status(400).json({ error: "mode 必须为 structured / smart / pivot / pivot_split" });
    }
  } catch (err) { req.log.error({ err }, "import preview failed"); res.status(500).json({ error: "预览失败" }); }
});

router.post("/finance/import/commit", async (req, res) => {
  try {
    const { table, rows, splits } = req.body;

    // pivot_split 模式：一次提交多张表
    if (splits && typeof splits === "object") {
      const results: Record<string, number> = {};
      const tableMap: Record<string, typeof financeIncomeTable> = {
        income: financeIncomeTable, expense: financeExpenseTable, net_worth: financeNetWorthTable,
        education_fund: financeEducationFundTable, debt: financeDebtTable,
      };
      for (const [tbl, tblRows] of Object.entries(splits)) {
        if (!Array.isArray(tblRows) || tblRows.length === 0) continue;
        const target = tableMap[tbl];
        if (!target) continue;
        const values = tblRows.map((r: Record<string, unknown>) => buildRowValues(r, tbl));
        if (values.length > 0) {
          try {
            const inserted = await db.insert(target).values(values).returning();
            results[tbl] = inserted.length;
          } catch (e) { req.log.error({ err: e, table: tbl }, "pivot_split commit partial fail"); results[tbl] = 0; }
        }
      }
      const totalInserted = Object.values(results).reduce((a, b) => a + b, 0);
      res.json({ inserted: totalInserted, splits: results });
      return;
    }

    // 单表模式
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "rows 为空" });
    const tableMap: Record<string, typeof financeIncomeTable> = {
      income: financeIncomeTable, expense: financeExpenseTable, net_worth: financeNetWorthTable,
      education_fund: financeEducationFundTable, debt: financeDebtTable,
    };
    const target = tableMap[table];
    if (!target) return res.status(400).json({ error: "未知表" });
    const values = rows.map((r: Record<string, unknown>) => buildRowValues(r.fields || r, table)).filter((v: Record<string, unknown>) => Object.keys(v).length > 0);
    if (values.length === 0) return res.status(400).json({ error: "无有效数据行" });
    const inserted = await db.insert(target).values(values).returning();
    res.json({ inserted: inserted.length, table });
  } catch (err) { req.log.error({ err }, "import commit failed"); res.status(400).json({ error: "入库失败: " + String(err.message || err) }); }
});

/** 按目标表 schema 构建入库行（v1.3：严格按表类型输出字段）*/
function buildRowValues(f: Record<string, unknown>, table: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const today = new Date().toISOString().slice(0, 10);

  switch (table) {
    case "income":
      out.txDate = f.tx_date || today;
      out.amount = String(num(f.amount));
      out.category = f.category || "其他";
      out.source = f.source || null;
      out.note = f.note || null;
      break;
    case "expense":
      out.txDate = f.tx_date || today;
      out.amount = String(num(f.amount));
      out.category = f.category || "其他";
      out.isMajor = num(f.amount) >= MAJOR_THRESHOLD();
      out.payee = f.payee || null;
      out.note = f.note || null;
      break;
    case "net_worth":
      out.snapshotDate = f.snapshot_date || today;
      out.totalAssets = String(num(f.total_assets));
      out.totalLiabilities = String(num(f.total_liabilities));
      out.netAssets = String(num(f.total_assets) - num(f.total_liabilities));
      out.cash = String(num(f.cash));
      out.investment = String(num(f.investment));
      out.realEstate = String(num(f.real_estate));
      out.otherAssets = String(num(f.other_assets));
      out.debtBreakdown = f.debt_breakdown || {};
      out.note = f.note || null;
      break;
    case "education_fund":
      out.txDate = f.tx_date || today;
      out.amount = String(num(f.amount));
      out.direction = f.direction || "存入";
      out.childName = f.child_name || "未指定";
      out.note = f.note || null;
      break;
    case "debt":
      out.txDate = f.tx_date || today;
      out.amount = String(num(f.amount));
      out.direction = f.direction || "借入";
      out.lender = f.lender || null;
      out.interestRate = f.interest_rate ? String(num(f.interest_rate)) : null;
      out.dueDate = f.due_date || null;
      out.note = f.note || null;
      break;
  }
  return out;
}

// ──────────────── P0-3: NL 插入 ────────────────

// 内存 confirm token store（进程内，足够单用户场景）
const confirmTokens = new Map<string, { parsed: Record<string, unknown>; table: string; createdAt: number }>();

router.post("/finance/nl", async (req, res) => {
  try {
    const { text, caller, target_table } = req.body;
    if (!text) return res.status(400).json({ error: "text 必填" });
    const parsed = await parseInsertionLLM(text);
    if (parsed.intent !== "insert" || !parsed.table) {
      return res.json({ intent: "unknown", message: "未能识别为记账意图，请明确说明金额和收支类型" });
    }
    // target_table 显式指定时覆盖 LLM 判断（用于"记一笔教育基金存入"这类场景）
    const VALID_TABLES = ["income", "expense", "net_worth", "education_fund", "debt"];
    if (target_table && VALID_TABLES.includes(target_table)) {
      parsed.table = target_table as typeof parsed.table;
      parsed.warnings.push(`已按指定目标表 ${target_table} 写入`);
    }
    // 缺省日期
    if (!parsed.fields.tx_date) {
      parsed.fields.tx_date = new Date().toISOString().slice(0, 10);
      parsed.warnings.push("日期缺失，已默认为今天");
    }
    const token = `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    confirmTokens.set(token, { parsed: parsed.fields, table: parsed.table, createdAt: Date.now() });
    // 清理超过 10 分钟的 token
    for (const [k, v] of confirmTokens) {
      if (Date.now() - v.createdAt > 10 * 60 * 1000) confirmTokens.delete(k);
    }
    res.json({
      intent: "insert",
      table: parsed.table,
      fields: parsed.fields,
      confidence: parsed.confidence,
      warnings: parsed.warnings,
      confirm_token: token,
      caller,
    });
  } catch (err) { req.log.error({ err }, "NL insert failed"); res.status(500).json({ error: "解析失败" }); }
});

router.post("/finance/nl/confirm", async (req, res) => {
  try {
    const { confirm_token, edits } = req.body;
    const tokenData = confirmTokens.get(confirm_token);
    if (!tokenData) return res.status(400).json({ error: "confirm_token 无效或已过期" });
    const fields = { ...tokenData.parsed, ...(edits || {}) };
    confirmTokens.delete(confirm_token);
    // 校验金额
    const amount = num(fields.amount);
    if (amount <= 0) return res.status(400).json({ error: "金额必须为正数" });
    const tableMap: Record<string, typeof financeIncomeTable> = {
      income: financeIncomeTable, expense: financeExpenseTable, net_worth: financeNetWorthTable,
      education_fund: financeEducationFundTable, debt: financeDebtTable,
    };
    const target = tableMap[tokenData.table];
    if (!target) return res.status(400).json({ error: "未知表" });
    const insertData: Record<string, unknown> = {
      txDate: fields.tx_date || new Date().toISOString().slice(0, 10),
      amount: String(amount),
      category: fields.category || "其他",
      note: fields.note || null,
    };
    if (tokenData.table === "expense") {
      insertData.isMajor = amount >= MAJOR_THRESHOLD();
      insertData.payee = fields.payee || null;
    } else if (tokenData.table === "income") {
      insertData.source = fields.source || null;
    } else if (tokenData.table === "education_fund") {
      insertData.direction = fields.direction || "存入";
      insertData.childName = fields.child_name || "大宝";
    } else if (tokenData.table === "debt") {
      insertData.direction = fields.direction || "借入";
      insertData.lender = fields.lender || null;
      insertData.interestRate = fields.interest_rate ? String(num(fields.interest_rate)) : null;
      insertData.dueDate = fields.due_date || null;
    }
    const row = await db.insert(target).values(insertData).returning();
    res.status(201).json({ confirmed: true, table: tokenData.table, row: { ...row[0], amount: num(row[0].amount) } });
  } catch (err) { req.log.error({ err }, "NL confirm failed"); res.status(400).json({ error: "写入失败" }); }
});

// ──────────────── P0-4: 周期规则 ────────────────

router.get("/finance/recurring-rules", async (_req, res) => {
  try {
    const rows = await db.select().from(financeRecurringRulesTable).orderBy(desc(financeRecurringRulesTable.createdAt));
    res.json(rows.map((r) => ({ ...r, amount: num(r.amount) })));
  } catch (err) { req.log.error({ err }, "GET recurring-rules failed"); res.status(500).json({ error: "查询失败" }); }
});

router.post("/finance/recurring-rules", async (req, res) => {
  try {
    const { text, rule } = req.body;
    let ruleData: Record<string, unknown>;
    if (text) {
      const parsed = await parseRecurringLLM(text);
      if (!parsed.frequency) return res.status(400).json({ error: "无法识别周期" });
      ruleData = { ...parsed, ...rule };
    } else {
      ruleData = rule || {};
    }
    const name = ruleData.name || "未命名规则";
    const frequency = ruleData.frequency as string;
    const amount = num(ruleData.amount);
    const startDate = ruleData.start_date || new Date().toISOString().slice(0, 10);
    const dayOfMonth = ruleData.day_of_month ?? null;
    if (!frequency || amount <= 0) return res.status(400).json({ error: "frequency 和 amount 必填" });
    // next_run_date: 从 start_date 开始，如果 start_date <= 今天则取今天（首次立即入账）
    const today = new Date().toISOString().slice(0, 10);
    let nextRun = startDate <= today ? today : startDate;
    // 对齐 day_of_month
    if (frequency === "monthly" && dayOfMonth) {
      const d = new Date(nextRun + "T00:00:00Z");
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      nextRun = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), Math.min(Number(dayOfMonth), lastDay))).toISOString().slice(0, 10);
      if (nextRun < today) {
        // 推进到下月
        const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
        const ld = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        nextRun = new Date(Date.UTC(y, m, Math.min(Number(dayOfMonth), ld))).toISOString().slice(0, 10);
      }
    }
    const row = await db.insert(financeRecurringRulesTable).values({
      name, frequency, dayOfMonth: dayOfMonth as number | null,
      amount: String(amount), category: ruleData.category || "其他",
      targetTable: ruleData.target_table === "expense" ? "expense" : "income",
      source: ruleData.source || null, note: ruleData.note || null,
      active: ruleData.active !== false,
      startDate, endDate: ruleData.end_date || null, nextRunDate: nextRun,
    }).returning();
    // 补录历史提示
    let backfillSuggestion: Array<{ date: string; amount: number }> | undefined;
    if (startDate < today) {
      const dates = computeBackfillDates(frequency, startDate, dayOfMonth as number | null, today);
      if (dates.length > 0) {
        backfillSuggestion = dates.map((d) => ({ date: d, amount }));
      }
    }
    res.status(201).json({ ...row[0], amount, backfillSuggestion });
  } catch (err) { req.log.error({ err }, "POST recurring-rules failed"); res.status(400).json({ error: "创建失败" }); }
});

router.put("/finance/recurring-rules/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    const b = req.body;
    const updates: Record<string, unknown> = {};
    if (b.name !== undefined) updates.name = b.name;
    if (b.frequency !== undefined) updates.frequency = b.frequency;
    if (b.day_of_month !== undefined) updates.dayOfMonth = b.day_of_month;
    if (b.amount !== undefined) updates.amount = String(num(b.amount));
    if (b.category !== undefined) updates.category = b.category;
    if (b.target_table !== undefined) updates.targetTable = b.target_table;
    if (b.source !== undefined) updates.source = b.source;
    if (b.note !== undefined) updates.note = b.note;
    if (b.active !== undefined) updates.active = Boolean(b.active);
    if (b.end_date !== undefined) updates.endDate = b.end_date;
    if (b.next_run_date !== undefined) updates.nextRunDate = b.next_run_date;
    const row = await db.update(financeRecurringRulesTable).set(updates).where(eq(financeRecurringRulesTable.id, id)).returning();
    if (row.length === 0) return res.status(404).json({ error: "规则不存在" });
    res.json({ ...row[0], amount: num(row[0].amount) });
  } catch (err) { req.log.error({ err }, "PUT recurring-rules failed"); res.status(400).json({ error: "更新失败" }); }
});

router.delete("/finance/recurring-rules/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    await db.delete(financeRecurringRulesTable).where(eq(financeRecurringRulesTable.id, id));
    res.json({ deleted: true });
  } catch (err) { req.log.error({ err }, "DELETE recurring-rules failed"); res.status(500).json({ error: "删除失败" }); }
});

router.post("/finance/recurring-rules/:id/run", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    const result = await runRuleOnce(id);
    res.json(result);
  } catch (err) { req.log.error({ err }, "run recurring rule failed"); res.status(400).json({ error: String(err) }); }
});

router.post("/finance/recurring-rules/:id/backfill", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    const [rule] = await db.select().from(financeRecurringRulesTable).where(eq(financeRecurringRulesTable.id, id)).limit(1);
    if (!rule) return res.status(404).json({ error: "规则不存在" });
    const today = new Date().toISOString().slice(0, 10);
    const dates = computeBackfillDates(rule.frequency, rule.startDate, rule.dayOfMonth, today);
    let count = 0;
    for (const d of dates) {
      const insertData = {
        txDate: d, amount: rule.amount, category: rule.category || "其他",
        source: rule.source, note: `${rule.name}（补录历史）`, generated: true, recurringRuleId: rule.id,
      };
      if (rule.targetTable === "expense") {
        await db.insert(financeExpenseTable).values({ ...insertData, isMajor: num(rule.amount) >= MAJOR_THRESHOLD(), payee: null });
      } else {
        await db.insert(financeIncomeTable).values(insertData);
      }
      count++;
    }
    res.json({ backfilled: count, dates });
  } catch (err) { req.log.error({ err }, "backfill failed"); res.status(400).json({ error: "补录失败" }); }
});

// ──────────────── P0-5: NL 查询分析 ────────────────

router.post("/finance/query", async (req, res) => {
  try {
    const { question, caller } = req.body;
    if (!question) return res.status(400).json({ error: "question 必填" });
    const gen = await generateSqlLLM(question);
    if (!gen.is_safe || !gen.sql) {
      return res.json({ answer: `无法生成安全查询：${gen.reason || "问题无法理解"}`, rows: [], raw_data: [], is_safe: false, narration_hint: gen.narration_hint, caller });
    }
    const result = await db.execute<Record<string, unknown>>(sql.raw(gen.sql));
    const rows = result.rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        out[k] = typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && v.length < 20 ? Number(v) : v;
      }
      return out;
    });
    const narration = await narrateResultLLM(question, rows);
    const response: Record<string, unknown> = {
      answer: narration.answer,
      rows,
      is_safe: true,
      narration_hint: gen.narration_hint,
      sql: gen.sql,
      caller,
    };
    // Agent 模式增加 raw_data
    if (caller === "agent") {
      response.raw_data = rows.slice(0, 100);
    }
    res.json(response);
  } catch (err) { req.log.error({ err }, "NL query failed"); res.status(500).json({ error: "查询失败" }); }
});

router.get("/finance/metrics", async (_req, res) => {
  try {
    const metrics = await computeMetrics();
    res.json(metrics);
  } catch (err) { req.log.error({ err }, "GET metrics failed"); res.status(500).json({ error: "指标计算失败" }); }
});

router.get("/finance/trends", async (req, res) => {
  try {
    const years = Number(req.query.years) || 5;
    const trends = await getYearlyTrends(years);
    res.json(trends);
  } catch (err) { req.log.error({ err }, "GET trends failed"); res.status(500).json({ error: "趋势查询失败" }); }
});

router.get("/finance/summary/yearly", async (req, res) => {
  try {
    const summary = await getYearlySummary(req.query.from ? Number(req.query.from) : undefined, req.query.to ? Number(req.query.to) : undefined);
    res.json(summary);
  } catch (err) { req.log.error({ err }, "GET yearly summary failed"); res.status(500).json({ error: "年度汇总失败" }); }
});

// ──────────────── P1-3: 大额支出 / P1-4: 导出 ────────────────

router.get("/finance/expenses/major", async (req, res) => {
  try {
    const threshold = req.query.threshold ? Number(req.query.threshold) : MAJOR_THRESHOLD();
    const rows = await db.select().from(financeExpenseTable)
      .where(gte(financeExpenseTable.amount, String(threshold)))
      .orderBy(desc(financeExpenseTable.txDate)).limit(100);
    res.json(rows.map((r) => ({ ...r, amount: num(r.amount) })));
  } catch (err) { req.log.error({ err }, "GET major expenses failed"); res.status(500).json({ error: "查询失败" }); }
});

router.post("/finance/export", async (req, res) => {
  try {
    const { table, query: querySql } = req.body;
    const tableMap: Record<string, string> = {
      income: "finance_income", expense: "finance_expense", net_worth: "finance_net_worth",
      education_fund: "finance_education_fund", debt: "finance_debt",
    };
    const tableName = tableMap[table] || table;
    if (!tableName || !/^finance_/.test(tableName)) return res.status(400).json({ error: "非法表名" });
    const sqlText = querySql && /^select/i.test(querySql) && !/insert|update|delete|drop/i.test(querySql)
      ? querySql
      : `SELECT * FROM ${tableName} ORDER BY 1 DESC LIMIT 1000`;
    const result = await db.execute<Record<string, unknown>>(sql.raw(sqlText));
    const rows = result.rows;
    if (rows.length === 0) return res.status(200).type("text/csv").send("");
    const headers = Object.keys(rows[0]);
    const csvLines = [headers.join(",")];
    for (const r of rows) {
      csvLines.push(headers.map((h) => {
        const v = r[h];
        if (v === null || v === undefined) return "";
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      }).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${table}_export.csv"`);
    res.send("\ufeff" + csvLines.join("\n"));
  } catch (err) { req.log.error({ err }, "export failed"); res.status(400).json({ error: "导出失败" }); }
});

// ──────────────── P1-5: 情景预测 ────────────────

const scenarioTokens = new Map<string, { parsed: Record<string, unknown>; createdAt: number }>();

router.get("/finance/scenarios", async (_req, res) => {
  try {
    const rows = await db.select().from(financeScenariosTable).orderBy(desc(financeScenariosTable.createdAt));
    res.json(rows);
  } catch (err) { req.log.error({ err }, "GET scenarios failed"); res.status(500).json({ error: "查询失败" }); }
});

router.post("/finance/scenarios/parse", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text 必填" });
    const parsed = await parseScenarioLLM(text);
    const token = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    scenarioTokens.set(token, { parsed: parsed as unknown as Record<string, unknown>, createdAt: Date.now() });
    for (const [k, v] of scenarioTokens) {
      if (Date.now() - v.createdAt > 10 * 60 * 1000) scenarioTokens.delete(k);
    }
    res.json({ parsed, confirm_token: token, confirm_message: `情景「${parsed.name}」：收入调整 ${parsed.income_adjustments.length} 项，支出调整 ${parsed.expense_adjustments.length} 项，资产调整 ${parsed.asset_adjustments.length} 项，预测 10 年？` });
  } catch (err) { req.log.error({ err }, "scenario parse failed"); res.status(500).json({ error: "解析失败" }); }
});

router.post("/finance/scenarios/run", async (req, res) => {
  try {
    const { scenario, confirm_token } = req.body;
    let input = scenario;
    if (!input && confirm_token) {
      const t = scenarioTokens.get(confirm_token);
      if (!t) return res.status(400).json({ error: "confirm_token 无效或已过期" });
      input = t.parsed;
      scenarioTokens.delete(confirm_token);
    }
    if (!input) return res.status(400).json({ error: "scenario 或 confirm_token 必填" });
    const result = await runScenario({
      income_adjustments: input.income_adjustments,
      expense_adjustments: input.expense_adjustments,
      asset_adjustments: input.asset_adjustments,
      baseline_year: input.baseline_year ?? new Date().getFullYear(),
      projected_years: input.projected_years ?? 10,
      consider_inflation: input.consider_inflation,
      assumptions: input.assumptions,
    });
    res.json(result);
  } catch (err) { req.log.error({ err }, "scenario run failed"); res.status(500).json({ error: "推演失败" }); }
});

router.post("/finance/scenarios", async (req, res) => {
  try {
    const { name, description, income_adjustments, expense_adjustments, asset_adjustments, baseline_year, projected_years, assumptions } = req.body;
    const row = await db.insert(financeScenariosTable).values({
      name: name || "未命名情景", description: description || null,
      incomeAdjustments: income_adjustments || [], expenseAdjustments: expense_adjustments || [],
      assetAdjustments: asset_adjustments || [],
      baselineYear: baseline_year || new Date().getFullYear(),
      projectedYears: projected_years || 10,
      assumptions: assumptions || { inflation: 0.02, investmentReturn: 0.04, educationGrowth: 0.05, mortgageFixed: true },
    }).returning();
    res.status(201).json(row[0]);
  } catch (err) { req.log.error({ err }, "POST scenarios failed"); res.status(400).json({ error: "保存失败" }); }
});

router.put("/finance/scenarios/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    const { name, description, income_adjustments, expense_adjustments, asset_adjustments, baseline_year, projected_years, assumptions } = req.body;
    const row = await db.update(financeScenariosTable).set({
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description: description || null }),
      ...(income_adjustments !== undefined && { incomeAdjustments: income_adjustments || [] }),
      ...(expense_adjustments !== undefined && { expenseAdjustments: expense_adjustments || [] }),
      ...(asset_adjustments !== undefined && { assetAdjustments: asset_adjustments || [] }),
      ...(baseline_year !== undefined && { baselineYear: baseline_year }),
      ...(projected_years !== undefined && { projectedYears: projected_years }),
      ...(assumptions !== undefined && { assumptions }),
    }).where(eq(financeScenariosTable.id, id)).returning();
    if (row.length === 0) return res.status(404).json({ error: "情景不存在" });
    res.json(row[0]);
  } catch (err) { req.log.error({ err }, "PUT scenario failed"); res.status(500).json({ error: "更新失败" }); }
});

router.delete("/finance/scenarios/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "非法 ID" });
    await db.delete(financeScenariosTable).where(eq(financeScenariosTable.id, id));
    res.json({ deleted: true });
  } catch (err) { req.log.error({ err }, "DELETE scenario failed"); res.status(500).json({ error: "删除失败" }); }
});

// ──────────────── overview（前端总览用）────────────────

router.get("/finance/overview", async (_req, res) => {
  try {
    const [incomeCount] = await db.select({ c: sql<number>`count(*)::int` }).from(financeIncomeTable);
    const [expenseCount] = await db.select({ c: sql<number>`count(*)::int` }).from(financeExpenseTable);
    const [nwCount] = await db.select({ c: sql<number>`count(*)::int` }).from(financeNetWorthTable);
    const [rulesCount] = await db.select({ c: sql<number>`count(*)::int` }).from(financeRecurringRulesTable).where(eq(financeRecurringRulesTable.active, true));
    const [majorCount] = await db.select({ c: sql<number>`count(*)::int` }).from(financeExpenseTable).where(eq(financeExpenseTable.isMajor, true));
    res.json({
      income: incomeCount.c, expense: expenseCount.c, netWorth: nwCount.c,
      activeRules: rulesCount.c, majorExpenses: majorCount.c,
    });
  } catch (err) { req.log.error({ err }, "GET overview failed"); res.status(500).json({ error: "总览失败" }); }
});

export default router;

// 导出调度器供 index.ts 启动
export { processRecurringRules } from "../lib/finance-recurring";
