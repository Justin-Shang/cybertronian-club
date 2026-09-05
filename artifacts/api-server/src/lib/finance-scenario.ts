/**
 * Finance 情景预测模型（what-if 推演）。
 * 结果实时推演，不入库（PRD 设计原则）。
 *
 * 基线 = 近12月 income/expense 按 category 月均 + 最新 net_worth 快照 + 当前 debt 余额
 * 逐年推演：情景叠加调整项；「考虑通胀」开关控制收支是否按通胀/教育增长（默认关闭=平推）。
 * 投资收益作为收入类别单列（按净资产 × 投资占比 × 回报率），不受通胀开关影响。
 */
import { db, financeIncomeTable, financeExpenseTable, financeNetWorthTable, financeDebtTable } from "@workspace/db";
import { desc, sql, gte, lte, and } from "drizzle-orm";

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

interface Adjustment {
  year_offset?: number;
  type?: string;
  category?: string;
  delta?: number;
  field?: string;
  note?: string;
}

export interface ScenarioInput {
  income_adjustments?: Adjustment[];
  expense_adjustments?: Adjustment[];
  asset_adjustments?: Adjustment[];
  baseline_year?: number;
  projected_years?: number;
  consider_inflation?: boolean;
  assumptions?: {
    inflation?: number;
    investmentReturn?: number;
    educationGrowth?: number;
    mortgageFixed?: boolean;
  };
}

export interface YearPoint {
  year: number;
  netWorth: number;
  income: number;
  expense: number;
  surplus: number;
  debtRatio: number;
  totalAssets: number;
  totalDebt: number;
  incomeBreakdown: Record<string, number>;
  expenseBreakdown: Record<string, number>;
}

export interface TurningPoint {
  year: number;
  type: string;
  label: string;
  value: number;
}

export interface MonthlyPoint {
  year: number;
  month: number;
  income: number;
  expense: number;
  surplus: number;
}

export interface ScenarioResult {
  baseline: YearPoint[];
  scenario: YearPoint[];
  monthly: { baseline: MonthlyPoint[]; scenario: MonthlyPoint[] };
  diffs: Array<{ year: number; netWorthDiff: number }>;
  keyTurningPoints: TurningPoint[];
  // 推演起点的当前净资产快照（最新 net_worth 快照值），供前端绘制参考线
  startNetWorth: number;
}

interface Baseline {
  year: number;
  monthlyIncome: number;
  monthlyExpense: number;
  educationMonthly: number;
  netWorth: number;
  investment: number;
  totalDebt: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
  monthlyIncomePattern: number[];  // index 1-12, 实际月度收入
  monthlyExpensePattern: number[];  // index 1-12, 实际月度支出
}

async function computeBaseline(year: number): Promise<Baseline> {
  // 取最新收支记录所在年份，避免年度快照数据被多年度累加
  // （用户数据为年度快照，每年12月31日一条，若查 "去年1月至今" 会把两年数据加在一起）
  const [latestInc] = await db
    .select({ maxDate: sql<string>`MAX(${financeIncomeTable.txDate})::text` })
    .from(financeIncomeTable);
  const [latestExp] = await db
    .select({ maxDate: sql<string>`MAX(${financeExpenseTable.txDate})::text` })
    .from(financeExpenseTable);
  const incYear = latestInc?.maxDate ? new Date(latestInc.maxDate).getFullYear() : year;
  const expYear = latestExp?.maxDate ? new Date(latestExp.maxDate).getFullYear() : year;

  // 按数据所在年份查询，避免跨年度累加
  const incomeRows = await db
    .select({
      category: financeIncomeTable.category,
      total: sql<string>`COALESCE(SUM(${financeIncomeTable.amount}), 0)`,
    })
    .from(financeIncomeTable)
    .where(and(
      gte(financeIncomeTable.txDate, `${incYear}-01-01`),
      lte(financeIncomeTable.txDate, `${incYear}-12-31`),
    ))
    .groupBy(financeIncomeTable.category);
  const expenseRows = await db
    .select({
      category: financeExpenseTable.category,
      total: sql<string>`COALESCE(SUM(${financeExpenseTable.amount}), 0)`,
    })
    .from(financeExpenseTable)
    .where(and(
      gte(financeExpenseTable.txDate, `${expYear}-01-01`),
      lte(financeExpenseTable.txDate, `${expYear}-12-31`),
    ))
    .groupBy(financeExpenseTable.category);

  const monthlyIncome = incomeRows.reduce((s, r) => s + num(r.total), 0) / 12;
  const educationMonthly = num(expenseRows.find((r) => r.category === "教育")?.total) / 12;
  const monthlyExpense = expenseRows.reduce((s, r) => s + num(r.total), 0) / 12;

  // 按 category 存月均，供逐年推演拆分
  const incomeByCategory: Record<string, number> = {};
  for (const r of incomeRows) incomeByCategory[r.category] = num(r.total) / 12;
  const expenseByCategory: Record<string, number> = {};
  for (const r of expenseRows) expenseByCategory[r.category] = num(r.total) / 12;

  // 按月查询实际收支 pattern（保留季节性：奖金月、学费月等）
  const monthlyIncomeRows = await db
    .select({
      month: sql<number>`EXTRACT(MONTH FROM ${financeIncomeTable.txDate})::int`,
      total: sql<string>`COALESCE(SUM(${financeIncomeTable.amount}), 0)`,
    })
    .from(financeIncomeTable)
    .where(and(
      gte(financeIncomeTable.txDate, `${incYear}-01-01`),
      lte(financeIncomeTable.txDate, `${incYear}-12-31`),
    ))
    .groupBy(sql`EXTRACT(MONTH FROM ${financeIncomeTable.txDate})`);
  const monthlyExpenseRows = await db
    .select({
      month: sql<number>`EXTRACT(MONTH FROM ${financeExpenseTable.txDate})::int`,
      total: sql<string>`COALESCE(SUM(${financeExpenseTable.amount}), 0)`,
    })
    .from(financeExpenseTable)
    .where(and(
      gte(financeExpenseTable.txDate, `${expYear}-01-01`),
      lte(financeExpenseTable.txDate, `${expYear}-12-31`),
    ))
    .groupBy(sql`EXTRACT(MONTH FROM ${financeExpenseTable.txDate})`);
  const monthlyIncomePattern = Array(13).fill(0);
  for (const r of monthlyIncomeRows) monthlyIncomePattern[r.month] = num(r.total);
  const monthlyExpensePattern = Array(13).fill(0);
  for (const r of monthlyExpenseRows) monthlyExpensePattern[r.month] = num(r.total);

  // 最新快照
  const [snap] = await db
    .select()
    .from(financeNetWorthTable)
    .orderBy(desc(financeNetWorthTable.snapshotDate))
    .limit(1);

  // 当前债务余额
  const debtRows = await db
    .select({
      direction: financeDebtTable.direction,
      total: sql<string>`COALESCE(SUM(${financeDebtTable.amount}), 0)`,
    })
    .from(financeDebtTable)
    .groupBy(financeDebtTable.direction);
  const borrowed = num(debtRows.find((r) => r.direction === "借入")?.total);
  const repaid = num(debtRows.find((r) => r.direction === "还款")?.total);
  const totalDebt = Math.max(0, borrowed - repaid);

  return {
    year,
    monthlyIncome,
    monthlyExpense,
    educationMonthly,
    netWorth: num(snap?.netAssets),
    investment: num(snap?.investment),
    totalDebt,
    incomeByCategory,
    expenseByCategory,
    monthlyIncomePattern,
    monthlyExpensePattern,
  };
}

/**
 * 按类别推演：基线月均 × 通胀系数，叠加调整项（增/减/移除某 category）。
 * 教育类用 eduFactor，其余用 inflFactor。返回各 category 年化金额。
 */
function projectBreakdown(
  baseMonthlyByCat: Record<string, number>,
  adjustments: Adjustment[] | undefined,
  yearOffset: number,
  inflFactor: number,
  eduFactor: number,
): Record<string, number> {
  const adjusted: Record<string, number> = { ...baseMonthlyByCat };
  if (adjustments) {
    // 统计每个 category 的 remove 调整项总数（用于多人分阶段退休等部分移除场景）
    const removeTotalByCat: Record<string, number> = {};
    for (const adj of adjustments) {
      if (adj.type === "remove") {
        const cat = adj.category || "其他";
        removeTotalByCat[cat] = (removeTotalByCat[cat] || 0) + 1;
      }
    }
    // 按 year_offset 排序，确保部分移除比例递减正确
    const sorted = [...adjustments].sort((a, b) => (a.year_offset ?? 0) - (b.year_offset ?? 0));
    const triggeredRemoveByCat: Record<string, number> = {};
    for (const adj of sorted) {
      if ((adj.year_offset ?? 0) > yearOffset) continue;
      const cat = adj.category || "其他";
      if (adj.type === "remove") {
        triggeredRemoveByCat[cat] = (triggeredRemoveByCat[cat] || 0) + 1;
        const total = removeTotalByCat[cat] || 1;
        const triggered = triggeredRemoveByCat[cat];
        if (triggered >= total) {
          adjusted[cat] = 0;
        } else {
          // 多人分阶段退休：按已触发比例递减
          // 如 2 人各 1 条 remove，第 1 条触发时保留 50%，第 2 条触发时清零
          adjusted[cat] = (adjusted[cat] || 0) * (1 - triggered / total);
        }
      } else if (adj.type === "add") {
        adjusted[cat] = (adjusted[cat] || 0) + num(adj.delta) / 12;
      } else if (adj.type === "modify") {
        adjusted[cat] = Math.max(0, (adjusted[cat] || 0) + num(adj.delta) / 12);
      }
    }
  }
  const result: Record<string, number> = {};
  for (const [cat, monthly] of Object.entries(adjusted)) {
    const factor = cat === "教育" ? eduFactor : inflFactor;
    result[cat] = monthly * 12 * factor;
  }
  return result;
}

const sumValues = (obj: Record<string, number>): number =>
  Object.values(obj).reduce((s, v) => s + v, 0);

/** 计算某年起所有生效调整项的月度 delta 合计 */
function getMonthlyDelta(adjustments: Adjustment[] | undefined, yearOffset: number): number {
  if (!adjustments) return 0;
  let delta = 0;
  for (const adj of adjustments) {
    if ((adj.year_offset ?? 0) > yearOffset) continue;
    if (adj.type === "remove") delta -= num(adj.delta) / 12;
    else if (adj.type === "add" || adj.type === "modify") delta += num(adj.delta) / 12;
  }
  return delta;
}

export async function runScenario(input: ScenarioInput): Promise<ScenarioResult> {
  const baselineYear = input.baseline_year ?? new Date().getFullYear();
  const projectedYears = input.projected_years ?? 10;
  // 「考虑通胀」开关：默认关闭 → 通胀与教育增长均为 0（按当前金额平推）。
  // 投资收益不受此开关影响（是资产实际回报，非通胀）。
  const considerInflation = input.consider_inflation ?? false;
  const inflation = considerInflation ? (input.assumptions?.inflation ?? 0.02) : 0;
  const educationGrowth = considerInflation ? (input.assumptions?.educationGrowth ?? 0.05) : 0;
  // 投资回报率默认 4%，独立于「考虑通胀」开关（资产实际回报，非通胀系数）
  const investmentReturn = input.assumptions?.investmentReturn ?? 0;

  const base = await computeBaseline(baselineYear);
  const baseline: YearPoint[] = [];
  const scenario: YearPoint[] = [];
  let prevBaselineNet = base.netWorth;
  let prevScenarioNet = base.netWorth;
  let debtAdj = 0;

  for (let y = 0; y < projectedYears; y++) {
    const year = baselineYear + y;
    const inflFactor = Math.pow(1 + inflation, y);
    const eduFactor = Math.pow(1 + educationGrowth, y);

    // ── 基线推演（按 category 拆分）──
    const bIncomeBreakdown = projectBreakdown(base.incomeByCategory, undefined, y, inflFactor, eduFactor);
    const bExpenseBreakdown = projectBreakdown(base.expenseByCategory, undefined, y, inflFactor, eduFactor);
    // 投资收益作为收入类别单列（按上年净资产 × 投资占比 × 回报率估算）
    const bInvestReturn = prevBaselineNet * investmentReturn * (base.investment > 0 && base.netWorth > 0 ? base.investment / base.netWorth : 0.5);
    if (bInvestReturn > 0) bIncomeBreakdown["投资收益"] = (bIncomeBreakdown["投资收益"] || 0) + bInvestReturn;
    const bIncome = sumValues(bIncomeBreakdown);
    const bExpense = sumValues(bExpenseBreakdown);
    const bNetWorth = prevBaselineNet + bIncome - bExpense;
    const bDebtRatio = bNetWorth > 0 ? base.totalDebt / bNetWorth : 1;
    baseline.push({
      year, netWorth: bNetWorth, income: bIncome, expense: bExpense,
      surplus: bIncome - bExpense, debtRatio: bDebtRatio,
      totalAssets: bNetWorth + base.totalDebt, totalDebt: base.totalDebt,
      incomeBreakdown: bIncomeBreakdown, expenseBreakdown: bExpenseBreakdown,
    });
    prevBaselineNet = bNetWorth;

    // ── 情景推演（叠加调整，按 category）──
    const sIncomeBreakdown = projectBreakdown(base.incomeByCategory, input.income_adjustments, y, inflFactor, eduFactor);
    const sExpenseBreakdown = projectBreakdown(base.expenseByCategory, input.expense_adjustments, y, inflFactor, eduFactor);
    // 投资收益作为收入类别单列（按上年净资产 × 投资占比 × 回报率估算）
    const sInvestReturn = prevScenarioNet * investmentReturn * (base.investment > 0 && base.netWorth > 0 ? base.investment / base.netWorth : 0.5);
    if (sInvestReturn > 0) sIncomeBreakdown["投资收益"] = (sIncomeBreakdown["投资收益"] || 0) + sInvestReturn;
    const sIncome = sumValues(sIncomeBreakdown);
    const sExpense = sumValues(sExpenseBreakdown);
    // 一次性资产变动
    let assetOneTime = 0;
    if (input.asset_adjustments) {
      for (const aa of input.asset_adjustments) {
        if ((aa.year_offset ?? 0) === y) {
          if (aa.field === "debt") { debtAdj += num(aa.delta); }
          else assetOneTime += num(aa.delta);
        }
      }
    }
    const sDebt = Math.max(0, base.totalDebt + debtAdj);
    const sNetWorth = prevScenarioNet + sIncome - sExpense + assetOneTime;
    const sDebtRatio = sNetWorth > 0 ? sDebt / sNetWorth : 1;
    scenario.push({
      year, netWorth: sNetWorth, income: sIncome, expense: sExpense,
      surplus: sIncome - sExpense, debtRatio: sDebtRatio,
      totalAssets: sNetWorth + sDebt, totalDebt: sDebt,
      incomeBreakdown: sIncomeBreakdown, expenseBreakdown: sExpenseBreakdown,
    });
    prevScenarioNet = sNetWorth;
  }

  // ── 月度推演（保留季节性 pattern，按月通胀系数推演）──
  const monthlyBaseline: MonthlyPoint[] = [];
  const monthlyScenario: MonthlyPoint[] = [];
  for (let y = 0; y < projectedYears; y++) {
    const incomeDelta = getMonthlyDelta(input.income_adjustments, y);
    const expenseDelta = getMonthlyDelta(input.expense_adjustments, y);
    for (let m = 1; m <= 12; m++) {
      const fracY = y + (m - 1) / 12;
      const inflFactor = Math.pow(1 + inflation, fracY);
      const bIncome = base.monthlyIncomePattern[m] * inflFactor;
      const bExpense = base.monthlyExpensePattern[m] * inflFactor;
      monthlyBaseline.push({
        year: baselineYear + y, month: m,
        income: bIncome, expense: bExpense, surplus: bIncome - bExpense,
      });
      const sIncome = (base.monthlyIncomePattern[m] + incomeDelta) * inflFactor;
      const sExpense = (base.monthlyExpensePattern[m] + expenseDelta) * inflFactor;
      monthlyScenario.push({
        year: baselineYear + y, month: m,
        income: sIncome, expense: sExpense, surplus: sIncome - sExpense,
      });
    }
  }

  // ── 拐点判定 ──
  const keyTurningPoints: TurningPoint[] = [];
  for (let i = 0; i < projectedYears; i++) {
    const b = baseline[i];
    const s = scenario[i];
    // 净资产交叉
    if (i > 0) {
      const prevDiff = scenario[i - 1].netWorth - baseline[i - 1].netWorth;
      const curDiff = s.netWorth - b.netWorth;
      if ((prevDiff <= 0 && curDiff > 0) || (prevDiff >= 0 && curDiff < 0)) {
        keyTurningPoints.push({
          year: s.year, type: "crossover",
          label: curDiff > 0 ? "情景净资产反超基线" : "情景净资产跌破基线",
          value: curDiff,
        });
      }
    }
    // 负债率破阈值
    if (s.debtRatio > 0.5 && (i === 0 || baseline[i - 1].debtRatio <= 0.5 || scenario[i - 1].debtRatio <= 0.5)) {
      keyTurningPoints.push({ year: s.year, type: "debt_high", label: "负债率突破50%", value: s.debtRatio });
    }
    if (s.debtRatio > 0.6 && (i === 0 || scenario[i - 1].debtRatio <= 0.6)) {
      keyTurningPoints.push({ year: s.year, type: "debt_danger", label: "负债率突破60%(危险)", value: s.debtRatio });
    }
    // 现金流为负
    if (s.surplus < 0 && (i === 0 || scenario[i - 1].surplus >= 0)) {
      keyTurningPoints.push({ year: s.year, type: "negative_cashflow", label: "现金流转负", value: s.surplus });
    }
  }

  const diffs = baseline.map((b, i) => ({
    year: b.year,
    netWorthDiff: scenario[i].netWorth - b.netWorth,
  }));

  return { baseline, scenario, monthly: { baseline: monthlyBaseline, scenario: monthlyScenario }, diffs, keyTurningPoints, startNetWorth: base.netWorth };
}
