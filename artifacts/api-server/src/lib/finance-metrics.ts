/**
 * Finance 综合指标实时计算 + 年度趋势。
 * 衍生指标不存表，查询时实时计算（PRD 设计原则）。
 */
import { db, financeIncomeTable, financeExpenseTable, financeNetWorthTable, financeDebtTable } from "@workspace/db";
import { desc, sql, gte, lte, and } from "drizzle-orm";

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

export interface FinanceMetrics {
  netAssets: number;
  totalAssets: number;
  totalLiabilities: number;
  debtRatio: number;       // 资产负债率 = 总负债/总资产
  realEstateRatio: number; // 房产占比 = 房产/总资产
  cashRatio: number;       // 流动比率(简化) = (现金+投资)/总资产
  yearlySavingRate: number; // 年度储蓄率 = (收入-支出)/收入
  yearlyIncome: number;
  yearlyExpense: number;
  yearlySurplus: number;
  snapshotDate: string | null;
}

export async function computeMetrics(): Promise<FinanceMetrics> {
  // 最新净资产快照
  const [snap] = await db
    .select()
    .from(financeNetWorthTable)
    .orderBy(desc(financeNetWorthTable.snapshotDate))
    .limit(1);

  const totalAssets = num(snap?.totalAssets);
  const totalLiabilities = num(snap?.totalLiabilities);
  const netAssets = num(snap?.netAssets);
  const cash = num(snap?.cash);
  const investment = num(snap?.investment);
  const realEstate = num(snap?.realEstate);

  // 今年收支
  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  const incomeRows = await db
    .select({ total: sql<string>`COALESCE(SUM(${financeIncomeTable.amount}), 0)` })
    .from(financeIncomeTable)
    .where(gte(financeIncomeTable.txDate, yearStart));
  const expenseRows = await db
    .select({ total: sql<string>`COALESCE(SUM(${financeExpenseTable.amount}), 0)` })
    .from(financeExpenseTable)
    .where(gte(financeExpenseTable.txDate, yearStart));

  const yearlyIncome = num(incomeRows[0]?.total);
  const yearlyExpense = num(expenseRows[0]?.total);
  const yearlySurplus = yearlyIncome - yearlyExpense;

  return {
    netAssets,
    totalAssets,
    totalLiabilities,
    debtRatio: totalAssets > 0 ? totalLiabilities / totalAssets : 0,
    realEstateRatio: totalAssets > 0 ? realEstate / totalAssets : 0,
    cashRatio: totalAssets > 0 ? (cash + investment) / totalAssets : 0,
    yearlySavingRate: yearlyIncome > 0 ? yearlySurplus / yearlyIncome : 0,
    yearlyIncome,
    yearlyExpense,
    yearlySurplus,
    snapshotDate: snap?.snapshotDate ?? null,
  };
}

export interface YearlyTrendPoint {
  year: number;
  netAssets: number;
  income: number;
  expense: number;
  surplus: number;
  debtRatio: number;
}

export async function getYearlyTrends(years = 5): Promise<YearlyTrendPoint[]> {
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - years + 1;
  const startDate = `${startYear}-01-01`;

  // 历史快照
  const snapshots = await db
    .select()
    .from(financeNetWorthTable)
    .where(gte(financeNetWorthTable.snapshotDate, startDate))
    .orderBy(desc(financeNetWorthTable.snapshotDate));

  // 按年聚合收支
  const incomeByYear = await db
    .select({
      year: sql<number>`EXTRACT(YEAR FROM ${financeIncomeTable.txDate})::int`,
      total: sql<string>`COALESCE(SUM(${financeIncomeTable.amount}), 0)`,
    })
    .from(financeIncomeTable)
    .where(gte(financeIncomeTable.txDate, startDate))
    .groupBy(sql`EXTRACT(YEAR FROM ${financeIncomeTable.txDate})`);
  const expenseByYear = await db
    .select({
      year: sql<number>`EXTRACT(YEAR FROM ${financeExpenseTable.txDate})::int`,
      total: sql<string>`COALESCE(SUM(${financeExpenseTable.amount}), 0)`,
    })
    .from(financeExpenseTable)
    .where(gte(financeExpenseTable.txDate, startDate))
    .groupBy(sql`EXTRACT(YEAR FROM ${financeExpenseTable.txDate})`);

  const incomeMap = new Map(incomeByYear.map((r) => [r.year, num(r.total)]));
  const expenseMap = new Map(expenseByYear.map((r) => [r.year, num(r.total)]));

  // 每年取该年最后一个快照
  const snapByYear = new Map<number, typeof snapshots[number]>();
  for (const s of snapshots) {
    const y = new Date(s.snapshotDate).getFullYear();
    if (!snapByYear.has(y) || new Date(s.snapshotDate) > new Date(snapByYear.get(y)!.snapshotDate)) {
      snapByYear.set(y, s);
    }
  }

  const result: YearlyTrendPoint[] = [];
  for (let y = startYear; y <= currentYear; y++) {
    const snap = snapByYear.get(y);
    const income = incomeMap.get(y) ?? 0;
    const expense = expenseMap.get(y) ?? 0;
    const totalAssets = num(snap?.totalAssets);
    result.push({
      year: y,
      netAssets: num(snap?.netAssets),
      income,
      expense,
      surplus: income - expense,
      debtRatio: totalAssets > 0 ? num(snap?.totalLiabilities) / totalAssets : 0,
    });
  }
  return result;
}

export interface YearlySummary {
  year: number;
  income: number;
  expense: number;
  surplus: number;
}

export async function getYearlySummary(fromYear?: number, toYear?: number): Promise<YearlySummary[]> {
  const currentYear = new Date().getFullYear();
  const startYear = fromYear ?? currentYear - 5;
  const endYear = toYear ?? currentYear;
  const startDate = `${startYear}-01-01`;
  const endDate = `${endYear}-12-31`;

  const incomeRows = await db
    .select({
      year: sql<number>`EXTRACT(YEAR FROM ${financeIncomeTable.txDate})::int`,
      total: sql<string>`COALESCE(SUM(${financeIncomeTable.amount}), 0)`,
    })
    .from(financeIncomeTable)
    .where(and(gte(financeIncomeTable.txDate, startDate), lte(financeIncomeTable.txDate, endDate)))
    .groupBy(sql`EXTRACT(YEAR FROM ${financeIncomeTable.txDate})`);
  const expenseRows = await db
    .select({
      year: sql<number>`EXTRACT(YEAR FROM ${financeExpenseTable.txDate})::int`,
      total: sql<string>`COALESCE(SUM(${financeExpenseTable.amount}), 0)`,
    })
    .from(financeExpenseTable)
    .where(and(gte(financeExpenseTable.txDate, startDate), lte(financeExpenseTable.txDate, endDate)))
    .groupBy(sql`EXTRACT(YEAR FROM ${financeExpenseTable.txDate})`);

  const incomeMap = new Map(incomeRows.map((r) => [r.year, num(r.total)]));
  const expenseMap = new Map(expenseRows.map((r) => [r.year, num(r.total)]));
  const years = new Set<number>([...incomeMap.keys(), ...expenseMap.keys()]);
  return Array.from(years).sort((a, b) => a - b).map((year) => ({
    year,
    income: incomeMap.get(year) ?? 0,
    expense: expenseMap.get(year) ?? 0,
    surplus: (incomeMap.get(year) ?? 0) - (expenseMap.get(year) ?? 0),
  }));
}
