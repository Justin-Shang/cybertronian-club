/**
 * Finance 模块 LLM 工具集。
 *
 * 复用 DeepSeek 客户端（OpenAI 兼容），与 invest-llm.ts 同模式。
 * 覆盖：NL插入解析 / NL查询SQL生成 / 智能提取 / 情景结构化 / 结果转述 / 周期规则解析
 *
 * 所有 LLM 输出强制 response_format=json_object，失败时返回带 error 字段的对象，
 * 调用方负责降级处理。
 */
import OpenAI from "openai";

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (cachedClient) return cachedClient;
  cachedClient = new OpenAI({
    baseURL: process.env.LLM_BASE_URL || "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY || "no-key",
  });
  return cachedClient;
}

function model(): string {
  return process.env.LLM_MODEL || "deepseek-chat";
}

// ──────────────── 类型定义 ────────────────

export interface ParsedInsertion {
  intent: "insert" | "unknown";
  table: "income" | "expense" | "net_worth" | "education_fund" | "debt" | "";
  fields: Record<string, unknown>;
  confidence: number;
  warnings: string[];
}

export interface GeneratedSql {
  sql: string;
  is_safe: boolean;
  narration_hint: string;
  reason?: string;
}

export interface ExtractedRow {
  row_index: number;
  fields: Record<string, unknown>;
  confidence: number;
  issues: string[];
}

export interface ParsedScenario {
  name: string;
  description: string;
  income_adjustments: Array<Record<string, unknown>>;
  expense_adjustments: Array<Record<string, unknown>>;
  asset_adjustments: Array<Record<string, unknown>>;
}

export interface ParsedRecurring {
  name: string;
  frequency: "monthly" | "weekly" | "yearly" | "";
  day_of_month: number | null;
  amount: number;
  category: string;
  target_table: "income" | "expense";
  source: string;
  note: string;
  confidence: number;
  warnings: string[];
}

// ──────────────── 1. NL 插入解析 ────────────────

const INSERT_SYSTEM_PROMPT = `你是一个家庭财务记账助手。用户会用自然语言描述一笔收支，你需要解析成结构化数据。

输出 JSON schema：
{
  "intent": "insert",              // insert | unknown
  "table": "income",               // income|expense|net_worth|education_fund|debt
  "fields": {
    "tx_date": "2026-08-03",       // YYYY-MM-DD，缺省 null
    "amount": 80000,               // 数字，必须 >0
    "category": "工资",            // 收入:工资/奖金/理财收益/股票收益/房租/其他；支出:生活/教育/医疗/房贷/保险/旅行/大额一次性/其他
    "source": "",                  // 来源方
    "note": "发工资"               // 备注
  },
  "confidence": 0.95,
  "warnings": []
}

规则：
- 金额必须为正数；"8万"=80000，"5千"=5000，"300"=300
- 日期解析为 YYYY-MM-DD；用户只说"8月3号"则年份取今年；缺失则 null
- 收入分类: 工资/奖金/理财收益/股票收益/房租/其他
- 支出分类: 生活/教育/医疗/房贷/保险/旅行/大额一次性/其他
- "发工资/到账/收入"→income；"花了/支出/消费/还款"→expense
- 教育基金相关(存教育金/取教育金)→education_fund，direction=存入/取出/收益
- 借款/还款(非房贷)→debt，direction=借入/还款
- 解析不确定时降低 confidence，加 warning`;

export async function parseInsertionLLM(text: string): Promise<ParsedInsertion> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: model(),
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: INSERT_SYSTEM_PROMPT },
      { role: "user", content: `今天是 ${new Date().toISOString().slice(0, 10)}。请解析：${text}` },
    ],
  });
  const raw = response.choices?.[0]?.message?.content || "{}";
  const p = JSON.parse(raw);
  return {
    intent: p.intent === "insert" ? "insert" : "unknown",
    table: p.table || "",
    fields: typeof p.fields === "object" && p.fields ? p.fields : {},
    confidence: typeof p.confidence === "number" ? p.confidence : 0,
    warnings: Array.isArray(p.warnings) ? p.warnings : [],
  };
}

// ──────────────── 2. NL 查询 SQL 生成 ────────────────

const SQL_SYSTEM_PROMPT = `你是一个财务数据查询 SQL 生成器。基于用户自然语言问题，生成只读 SELECT 查询。

可用表（全部 finance_ 前缀）：
- finance_income(id, tx_date, amount, category, source, note, generated)
- finance_expense(id, tx_date, amount, category, is_major, payee, note)
- finance_net_worth(id, snapshot_date, total_assets, total_liabilities, net_assets, cash, investment, real_estate, other_assets, debt_breakdown)
- finance_education_fund(id, tx_date, amount, direction, child_name, note)
- finance_debt(id, tx_date, amount, direction, lender, interest_rate, due_date)
- finance_recurring_rules(id, name, frequency, amount, active, next_run_date)

amount 字段是 NUMERIC 类型，可用 SUM/AVG 聚合。

输出 JSON schema：
{
  "sql": "SELECT category, SUM(amount) FROM finance_income WHERE tx_date >= '2026-01-01' GROUP BY category ORDER BY 2 DESC",
  "is_safe": true,
  "narration_hint": "按收入分类汇总",
  "reason": ""
}

严格要求：
- 只能生成 SELECT 语句；禁止 INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE
- 表名必须用上述白名单
- 日期范围默认取今年（除非用户指定）
- "今年"= WHERE tx_date >= 'YYYY-01-01'
- "上月"= 上一自然月
- amount 求和用 SUM(amount)，注意 NUMERIC 结果可 CAST(sum(amount) AS FLOAT) 便于前端解析
- 无法生成安全 SQL 时 is_safe=false 并在 reason 说明`;

const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i;
const TABLE_WHITELIST = /finance_(income|expense|net_worth|education_fund|debt|recurring_rules|scenarios)/;

export async function generateSqlLLM(question: string): Promise<GeneratedSql> {
  const client = getClient();
  const year = new Date().getFullYear();
  const response = await client.chat.completions.create({
    model: model(),
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SQL_SYSTEM_PROMPT },
      { role: "user", content: `当前年份 ${year}。问题：${question}` },
    ],
  });
  const raw = response.choices?.[0]?.message?.content || "{}";
  const p = JSON.parse(raw);
  let sql = typeof p.sql === "string" ? p.sql.trim() : "";
  let isSafe = p.is_safe === true;
  let reason = typeof p.reason === "string" ? p.reason : "";

  // 代码二次校验（不信任 LLM）
  if (sql && !/^select/i.test(sql)) {
    isSafe = false;
    reason = "SQL 不以 SELECT 开头";
    sql = "";
  }
  if (sql && FORBIDDEN.test(sql)) {
    isSafe = false;
    reason = "SQL 含禁止的关键字";
    sql = "";
  }
  if (sql && !TABLE_WHITELIST.test(sql)) {
    isSafe = false;
    reason = "SQL 未使用白名单表";
    sql = "";
  }
  return {
    sql,
    is_safe: isSafe,
    narration_hint: typeof p.narration_hint === "string" ? p.narration_hint : "",
    reason,
  };
}

// ──────────────── 3. 智能提取（石墨非结构化行）────────────────

/** 各目标表的 schema 定义，用于动态构建 LLM prompt */
const TABLE_EXTRACT_SCHEMAS: Record<string, { label: string; fields: string; rules: string }> = {
  income: {
    label: "收入明细",
    fields: "tx_date(日期), amount(金额), category(工资/奖金/理财收益/股票收益/房租/其他), source(来源方), note(备注)",
    rules: 'category 必须是枚举之一；"8万"=80000',
  },
  expense: {
    label: "支出明细",
    fields: "tx_date(日期), amount(金额), category(生活/教育/医疗/房贷/保险/旅行/大额一次性/其他), payee(收款方), note(备注)",
    rules: "category 必须是枚举之一；is_major 不需要填（系统按阈值自动判定）",
  },
  net_worth: {
    label: "资产负债快照",
    fields: "snapshot_date(快照日期), total_assets(总资产), total_liabilities(总负债), cash(现金), investment(投资), real_estate(房产), other_assets(其他资产), note(备注)",
    rules: "net_assets 系统自动计算（总资产-总负债），不需要填；金额单位元，1405万=14050000",
  },
  education_fund: {
    label: "教育基金",
    fields: "tx_date(日期), amount(金额), direction(存入/取出/收益), child_name(大宝/二宝/孩子名), note(备注)",
    rules: "direction 必须是 存入/取出/收益 之一；child_name 必填；每个孩子各一条记录",
  },
  debt: {
    label: "债务明细",
    fields: "tx_date(日期), amount(金额), direction(借入/还款), lender(债权人), interest_rate(利率%), due_date(到期日), note(备注)",
    rules: "direction 必须是 借入/还款 之一；每个债权人一条借入记录（非还款流水）；还款明细放 note",
  },
};

function buildExtractPrompt(tableHint: string): string {
  const schema = TABLE_EXTRACT_SCHEMAS[tableHint] || TABLE_EXTRACT_SCHEMAS.income;
  return `你是一个财务数据提取器。给定石墨表格的原始行（单元格文本+数字混杂），逐行提取为结构化字段。

目标表：${schema.label}
输出字段（仅输出以下字段，不要输出其他表的字段）：
  ${schema.fields}

特殊规则：
  ${schema.rules}

通用规则：
- amount 必须为数字（去掉"元/万/约"等单位，"8万"=80000，"1405万"=14050000）
- 日期解析为 YYYY-MM-DD；Excel 序列号 45407 = 2024/4/25
- 千分位清洗："4,900"=4900
- confidence: 数据完整清晰 0.9+；含模糊表述/需推断 0.5-0.8；无法解析 <0.4
- issues 列出推断/存疑点，如"金额含'约'字已取近似值"、"单位已从万转换为元"

输出 JSON：
{
  "extracted": [
    {
      "row_index": 0,
      "fields": { /* 仅包含目标表 schema 定义的字段 */ },
      "confidence": 0.92,
      "issues": ["单位已从万转换为元"]
    }
  ]
}`;
}

export async function extractRowsLLM(
  rows: Array<Record<string, string>>,
  tableHint: string,
): Promise<{ extracted: ExtractedRow[] }> {
  const client = getClient();
  const prompt = buildExtractPrompt(tableHint);
  const response = await client.chat.completions.create({
    model: model(),
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: `目标表: ${tableHint}\n原始行(JSON数组):\n${JSON.stringify(rows, null, 2)}` },
    ],
  });
  const raw = response.choices?.[0]?.message?.content || "{}";
  const p = JSON.parse(raw);
  const extracted = Array.isArray(p.extracted) ? p.extracted : [];
  return {
    extracted: extracted.map((e: Record<string, unknown>, i: number) => ({
      row_index: typeof e.row_index === "number" ? e.row_index : i,
      fields: typeof e.fields === "object" && e.fields ? (e.fields as Record<string, unknown>) : {},
      confidence: typeof e.confidence === "number" ? e.confidence : 0,
      issues: Array.isArray(e.issues) ? e.issues : [],
    })),
  };
}

// ──────────────── 3b. 透视表多表拆分提取 ────────────────

const PIVOT_SPLIT_PROMPT = `你是一个财务透视表拆分器。给定透视表的一行（包含收入/支出/资产/负债多个维度的混杂数据），你需要将其拆分成多张表的记录。

一行透视表数据可能包含：
- 时间列（如"2020年末"）→ 各条记录的日期
- 收入明细 + 总收入 → income 表的多条记录
- 支出明细 + 总支出 → expense 表的多条记录
- 财产明细 + 总资产 + 总负债 + 净资产 → net_worth 表的 1 条快照记录
- 负债明细 → debt 表的多条记录

输出 JSON：
{
  "splits": {
    "net_worth": [
      {"snapshot_date":"2020-12-31","total_assets":14050000,"total_liabilities":1500000,"cash":0,"investment":1650000,"real_estate":12400000,"other_assets":0,"note":"2020年末快照"}
    ],
    "income": [
      {"tx_date":"2020-12-31","amount":390000,"category":"工资","source":"尚进","note":"尚进工资"},
      {"tx_date":"2020-12-31","amount":360000,"category":"工资","source":"朴影","note":"朴影工资"},
      {"tx_date":"2020-12-31","amount":83000,"category":"房租","source":"金域东郡","note":"房租"}
    ],
    "expense": [
      {"tx_date":"2020-12-31","amount":104000,"category":"房贷","payee":"金域东郡","note":"房贷"},
      {"tx_date":"2020-12-31","amount":81000,"category":"教育","payee":"东禾","note":"东禾学费"}
    ],
    "debt": [
      {"tx_date":"2020-12-31","amount":1500000,"direction":"借入","lender":"金域东郡房贷","interest_rate":null,"due_date":null,"note":"房贷余额"}
    ]
  }
}

规则：
- 金额单位元，"83.3万"=833000，"1405万"=14050000
- 从"收入明细"单元格中拆分出多条 income 记录（如"尚进工资39万+朴影工资36万+房租8.3万"→3条）
- 从"支出明细"单元格中拆分出多条 expense 记录
- "总资产/总负债/净资产"→ net_worth 表 1 条快照
- "负债明细"→ debt 表记录（direction=借入）
- 日期从"时间"列解析，"2020年末"→"2020-12-31"
- 投资额从"财产明细"中提取（股票+理财等）
- cash 字段如无明确数据填 0
- 只输出有数据的表，空数组也要输出`;

export interface PivotSplitResult {
  splits: {
    net_worth?: Array<Record<string, unknown>>;
    income?: Array<Record<string, unknown>>;
    expense?: Array<Record<string, unknown>>;
    debt?: Array<Record<string, unknown>>;
    education_fund?: Array<Record<string, unknown>>;
  };
}

export async function extractPivotSplitLLM(
  rows: Array<Record<string, string>>,
): Promise<PivotSplitResult> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: model(),
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PIVOT_SPLIT_PROMPT },
      { role: "user", content: `透视表原始行(JSON数组):\n${JSON.stringify(rows, null, 2)}` },
    ],
  });
  const raw = response.choices?.[0]?.message?.content || "{}";
  const p = JSON.parse(raw);
  return { splits: p.splits || {} };
}

// ──────────────── 4. 情景结构化 ────────────────

const SCENARIO_SYSTEM_PROMPT = `你是一个财务情景预测参数生成器。用户描述一种未来变化，你将其结构化为可推演的调整项。

输出 JSON schema：
{
  "name": "辞职创业",
  "description": "工资归零，前两年零收入，创业启动金50万",
  "income_adjustments": [
    {"year_offset": 0, "type": "remove", "category": "工资", "delta": 0, "note": "工资归零"},
    {"year_offset": 2, "type": "add", "category": "股票收益", "delta": 150000, "note": "炒股年收入15万"}
  ],
  "expense_adjustments": [
    {"year_offset": 0, "type": "add", "category": "大额一次性", "delta": 500000, "note": "创业启动金"}
  ],
  "asset_adjustments": [
    {"year_offset": 0, "field": "cash", "delta": -500000, "note": "启动金支出"}
  ]
}

规则：
- 基线年 = 当前年份（系统在用户消息中告知"当前年份 XXXX 年"）。
- year_offset: 相对基线年的偏移。0 = 基线年当年，1 = 基线年+1 年，2 = 基线年+2 年，以此类推。
- 若用户提到具体年份（如"2027 年"），year_offset = 该年份 − 基线年。例：基线年 2026 年时，2027 年→offset=1，2028 年→offset=2，2030 年→offset=4。
- 关键语义："到 XXXX 年才不工作/才停止"表示 XXXX 年之前该项正常存在。调整项的 year_offset 应为 (XXXX − 基线年)，不是 0。例：基线年 2026 年，"2028 年才不工作"→ offset=2，表示 2026/2027 年工资正常、2028 年起移除。
- 若用户与配偶分别在不同年份停止（如"我 2027 年、配偶 2028 年"），拆成两条：一条 offset=(2027−基线年) 移除本人工资部分，另一条 offset=(2028−基线年) 移除配偶工资部分；无法精确拆分金额时用 modify 按比例递减，切勿在第一年就 remove 全部工资。
- income/expense adjustments: type=remove(从该年起移除该 category 基线)/add(从该年起新增)/modify(从该年起增减)
- asset_adjustments: field=cash/investment/real_estate/other_assets，delta 为一次性变动（可负），仅在 year_offset 对应年份生效
- 金额单位元，"50万"=500000
- 无法结构化的部分放 description，不要硬塞 adjustments`;

export async function parseScenarioLLM(text: string): Promise<ParsedScenario> {
  const client = getClient();
  const year = new Date().getFullYear();
  const response = await client.chat.completions.create({
    model: model(),
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SCENARIO_SYSTEM_PROMPT },
      { role: "user", content: `当前年份 ${year} 年（即基线年=${year}，year_offset=0 对应 ${year} 年，year_offset=1 对应 ${year + 1} 年，以此类推）。请结构化情景：${text}` },
    ],
  });
  const raw = response.choices?.[0]?.message?.content || "{}";
  const p = JSON.parse(raw);
  return {
    name: typeof p.name === "string" ? p.name : "未命名情景",
    description: typeof p.description === "string" ? p.description : "",
    income_adjustments: Array.isArray(p.income_adjustments) ? p.income_adjustments : [],
    expense_adjustments: Array.isArray(p.expense_adjustments) ? p.expense_adjustments : [],
    asset_adjustments: Array.isArray(p.asset_adjustments) ? p.asset_adjustments : [],
  };
}

// ──────────────── 5. 结果转述 ────────────────

const NARRATE_SYSTEM_PROMPT = `你是一个财务数据转述员。给定用户问题和 SQL 查询结果（JSON 行数组），用自然语言回答。

严格要求：
- 数字必须来自查询结果，禁止编造或近似
- 回答简洁，直接给数字和结论
- 如结果为空，明确说"没有相关数据"
- 可做简单计算（占比、差值），但必须基于结果中的数字`;

export async function narrateResultLLM(
  question: string,
  rows: Array<Record<string, unknown>>,
): Promise<{ answer: string; cited_rows: number[] }> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: model(),
    temperature: 0.2,
    messages: [
      { role: "system", content: NARRATE_SYSTEM_PROMPT },
      { role: "user", content: `问题：${question}\n查询结果(${rows.length}行)：\n${JSON.stringify(rows.slice(0, 50), null, 2)}` },
    ],
  });
  const answer = response.choices?.[0]?.message?.content || "(无回答)";
  return { answer, cited_rows: rows.slice(0, 20).map((_, i) => i) };
}

// ──────────────── 6. 周期规则解析 ────────────────

const RECURRING_SYSTEM_PROMPT = `你是一个周期收入/支出规则解析器。用户用一句话描述周期性收支，你解析为规则定义。

输出 JSON schema：
{
  "name": "工资",
  "frequency": "monthly",         // monthly|weekly|yearly
  "day_of_month": 31,             // 每月几号（1-31），非 monthly 为 null
  "amount": 80000,                // 每期金额
  "category": "工资",             // 收入:工资/奖金/理财收益/股票收益/房租/其他；支出:生活/教育/医疗/房贷/保险/旅行/大额一次性/其他
  "target_table": "income",       // income|expense
  "source": "",                   // 来源方
  "note": "每月工资",
  "confidence": 0.95,
  "warnings": []
}

规则：
- "每月31号发工资8万"→frequency=monthly, day_of_month=31, amount=80000, target_table=income, category=工资
- "每月15号还房贷5000"→target_table=expense, category=房贷
- "每周"→frequency=weekly, day_of_month=null
- "每年"→frequency=yearly, day_of_month=null
- "每月底/月末"→day_of_month=31（系统自动取月末）
- 金额"8万"=80000`;

export async function parseRecurringLLM(text: string): Promise<ParsedRecurring> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: model(),
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: RECURRING_SYSTEM_PROMPT },
      { role: "user", content: `请解析周期规则：${text}` },
    ],
  });
  const raw = response.choices?.[0]?.message?.content || "{}";
  const p = JSON.parse(raw);
  return {
    name: typeof p.name === "string" ? p.name : "未命名规则",
    frequency: ["monthly", "weekly", "yearly"].includes(p.frequency) ? p.frequency : "",
    day_of_month: typeof p.day_of_month === "number" ? p.day_of_month : null,
    amount: typeof p.amount === "number" ? p.amount : 0,
    category: typeof p.category === "string" ? p.category : "其他",
    target_table: p.target_table === "expense" ? "expense" : "income",
    source: typeof p.source === "string" ? p.source : "",
    note: typeof p.note === "string" ? p.note : "",
    confidence: typeof p.confidence === "number" ? p.confidence : 0,
    warnings: Array.isArray(p.warnings) ? p.warnings : [],
  };
}
