// Finance 家庭财务模块 — 共享类型与 API 助手
// 路径拼接（非模板字面量），基础路径 /api/finance

export const API = "/api/finance";

export const INCOME_CATEGORIES = ["工资", "奖金", "理财收益", "股票收益", "房租", "其他"];
export const EXPENSE_CATEGORIES = ["生活", "教育", "医疗", "房贷", "保险", "旅行", "大额一次性", "其他"];
export const EDUCATION_DIRECTIONS = ["存入", "取出", "收益"];
export const DEBT_DIRECTIONS = ["借入", "还款"];
export const FREQUENCIES = ["monthly", "weekly", "yearly"];

export interface Income {
  id: number; txDate: string; amount: number; category: string;
  source: string | null; note: string | null; generated: boolean; recurringRuleId: number | null; createdAt: string;
}
export interface Expense {
  id: number; txDate: string; amount: number; category: string;
  isMajor: boolean; payee: string | null; note: string | null; generated: boolean; createdAt: string;
}
export interface NetWorth {
  id: number; snapshotDate: string; totalAssets: number; totalLiabilities: number; netAssets: number;
  cash: number; investment: number; realEstate: number; otherAssets: number;
  debtBreakdown: Record<string, unknown>; note: string | null; createdAt: string;
}
export interface EducationFund {
  id: number; txDate: string; amount: number; direction: string; childName: string; note: string | null; createdAt: string;
}
export interface Debt {
  id: number; txDate: string; amount: number; direction: string; lender: string | null;
  interestRate: number | null; dueDate: string | null; note: string | null; createdAt: string;
}
export interface RecurringRule {
  id: number; name: string; frequency: string; dayOfMonth: number | null; amount: number;
  category: string | null; targetTable: string; source: string | null; note: string | null;
  active: boolean; startDate: string; endDate: string | null; nextRunDate: string; createdAt: string;
}
export interface Scenario {
  id: number; name: string; description: string | null;
  incomeAdjustments: unknown[]; expenseAdjustments: unknown[]; assetAdjustments: unknown[];
  baselineYear: number; projectedYears: number; assumptions: Record<string, unknown>; createdAt: string;
}
export interface Metrics {
  netAssets: number; totalAssets: number; totalLiabilities: number;
  debtRatio: number; realEstateRatio: number; cashRatio: number; yearlySavingRate: number;
  yearlyIncome: number; yearlyExpense: number; yearlySurplus: number; snapshotDate: string | null;
}
export interface Overview {
  income: number; expense: number; netWorth: number; activeRules: number; majorExpenses: number;
}
export interface YearPoint {
  year: number; netWorth: number; income: number; expense: number; surplus: number; debtRatio: number;
  totalAssets: number; totalDebt: number;
  incomeBreakdown: Record<string, number>;
  expenseBreakdown: Record<string, number>;
}
export interface YearlySummary {
  year: number; income: number; expense: number; surplus: number;
}
export interface MonthlyPoint {
  year: number; month: number; income: number; expense: number; surplus: number;
}
export interface ScenarioResult {
  baseline: YearPoint[]; scenario: YearPoint[];
  monthly: { baseline: MonthlyPoint[]; scenario: MonthlyPoint[] };
  diffs: Array<{ year: number; netWorthDiff: number }>;
  keyTurningPoints: Array<{ year: number; type: string; label: string; value: number }>;
  startNetWorth: number;
}

export const money = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + " 元";
};
export const fmt = (v: number | null | undefined, suffix = ""): string => {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + suffix;
};
export const pct = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return (n * 100).toFixed(1) + "%";
};

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(API + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "请求失败");
  }
  return res.json();
}
