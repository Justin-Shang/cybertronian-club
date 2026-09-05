// PIRS 投研笔记模块 — 共享类型与 API 助手
// 路径拼接（非模板字面量），基础路径 /api/invest

export const API = "/api/invest";

export interface Stock {
  code: string;
  name: string;
  market: string;
  industry: string;
  sector: string;
  isSt: boolean;
  updatedAt: string;
}

export interface StockMetrics {
  code: string;
  peTtm: number | null;
  pb: number | null;
  ps: number | null;
  roe: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  revenueYoy: number | null;
  profitYoy: number | null;
  marketCap: number | null;
  price: number | null;
  priceChangePct: number | null;
  dividendYield: number | null;
  updatedAt: string;
}

export interface WatchlistItem {
  code: string;
  name: string;
  status: string;
  notes: string | null;
  tags: string[];
  isHolding: boolean;
  addedAt: string;
  updatedAt: string;
}

export interface Candidate {
  code: string;
  name: string;
  score: number | null;
  frameworkId: string | null;
  reason: string | null;
  tags: string[];
  status: string;
  peTtm: number | null;
  pb: number | null;
  roe: number | null;
  grossMargin: number | null;
  revenueYoy: number | null;
  marketCap: number | null;
  screenedAt: string;
}

export interface Framework {
  id: string;
  name: string;
  type: string;
  description: string | null;
  isBuiltin: boolean;
  isEnabled: boolean;
  dimensions: unknown[];
  hardFilters: unknown[];
  systemPrompt: string;
  environment: string;
  updatedAt: string;
}

export interface InvestNote {
  id: number;
  code: string;
  frameworkId: string | null;
  title: string | null;
  conclusion: string;
  indicatorsSnapshot: Record<string, unknown>;
  content: string;
  author: string;
  agentName: string | null;
  roomId: number | null;
  workflowExecutionId: number | null;
  createdAt: string;
}

export interface Alert {
  id: number;
  code: string;
  stockName: string;
  level: string;
  signalType: string;
  description: string;
  source: string;
  isRead: boolean;
  noteId: number | null;
  createdAt: string;
}

export interface Overview {
  watchlist: number;
  candidates: number;
  notes: number;
  unreadAlerts: number;
  recentNotes: InvestNote[];
}

// 初筛配置（单条全局配置，id=1）
export interface ScreenConfig {
  id: number;
  enabled: boolean;
  frameworkIds: string[];
  topN: number;
  dayOfWeek: number; // 0=周日..6=周六
  nextRunDate: string; // YYYY-MM-DD
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// 初筛执行记录
export interface ScreenRun {
  id: number;
  configId: number;
  frameworkIds: string[];
  pickedCodes: string[];
  poolSize: number | null;
  summary: string | null;
  status: string; // ok | failed
  error: string | null;
  createdAt: string;
}

// POST /screen/run 返回
export interface ScreenRunResult {
  picked: string[];
  poolSize: number;
  summary: string;
}

// 估值历史分位（近5年）
export interface Valuation {
  code: string;
  peTtm: number | null;
  pePercentile: number | null; // 0-100
  peBand: { min: number; max: number; p50: number } | null;
  pb: number | null;
  pbPercentile: number | null; // 0-100
  pbBand: { min: number; max: number; p50: number } | null;
  source: string | null;
  updatedAt: string | null;
}

// 反思审计结果
export interface AuditResult {
  supported: string[];
  unsupported: string[];
  dataIssues: string[];
  weakestLink: string | null;
  verifyChecklist: string[];
  auditedAt: string | null;
}

// 牛熊辩论
export interface Debate {
  id: number;
  code: string;
  frameworkId: string | null;
  dossier: {
    valuation: Valuation;
    metrics: Record<string, number | null>;
  };
  bullCase: string;
  bearCase: string;
  disagreements: string[];
  verifyPaths: string[];
  createdAt: string;
}

// 股票扩展数据（研报/公告/两融/解禁/股东户数）
export interface ExtraData {
  code: string;
  research_reports: { title: string; org: string; rating: string | null; epsForecast: number | null; peForecast: number | null; date: string | null }[];
  announcements: { title: string; date: string | null }[];
  margin: { date: string | null; financeBalance: number | null; financeBuy: number | null; securitiesBalance?: number | null; source: string | null };
  lockup: { date: string | null; marketCount: number | null; marketValue: number | null; note: string | null }[];
  holders: { date: string | null; holders: number | null; change: number | null; avgValue: number | null; avgHold: number | null; abs: number | null }[];
  _degraded: { source: string; reason: string }[];
  updatedAt: string | null;
}

// 格式化数字：null → "—"，否则保留指定小数位
export function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

// 百分比格式（0.1057 → "10.57%"）
export function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return (v * 100).toFixed(digits) + "%";
}

// 分位格式（0-100 的分位值 → "NN%"）
export function pctile(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits) + "%";
}

// 市值（亿元）
export function cap(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(0) + "亿";
}

export const LEVEL_COLOR: Record<string, string> = {
  red: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  yellow: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  blue: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
};

// 预警规则
export interface AlertRule {
  id: number;
  code: string;
  metric: string;
  operator: string;
  threshold: number;
  level: string; // blue | yellow | red
  isEnabled: boolean;
  note: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// 可被预警规则引用的指标（与 stock_metrics 字段对齐）
export const ALERT_METRICS: { key: string; label: string }[] = [
  { key: "peTtm", label: "PE (TTM)" },
  { key: "pb", label: "PB" },
  { key: "ps", label: "PS" },
  { key: "roe", label: "ROE" },
  { key: "grossMargin", label: "毛利率" },
  { key: "netMargin", label: "净利率" },
  { key: "revenueYoy", label: "营收同比" },
  { key: "profitYoy", label: "利润同比" },
  { key: "dividendYield", label: "股息率" },
  { key: "marketCap", label: "市值(亿)" },
  { key: "price", label: "现价" },
  { key: "priceChangePct", label: "涨跌幅" },
];

export const ALERT_OPERATORS: { key: string; label: string }[] = [
  { key: "gt", label: "高于" },
  { key: "lt", label: "低于" },
  { key: "gte", label: "不低于" },
  { key: "lte", label: "不高于" },
  { key: "crosses_up", label: "上穿" },
  { key: "crosses_down", label: "下穿" },
];

export const ALERT_LEVELS: { key: string; label: string }[] = [
  { key: "blue", label: "提示" },
  { key: "yellow", label: "关注" },
  { key: "red", label: "紧急" },
];

// 框架类型
export const FRAMEWORK_TYPES: { key: string; label: string }[] = [
  { key: "value", label: "价值" },
  { key: "growth", label: "成长" },
  { key: "quality", label: "质量" },
  { key: "momentum", label: "动量" },
  { key: "dividend", label: "红利" },
  { key: "macro", label: "宏观" },
  { key: "technical", label: "技术" },
  { key: "custom", label: "自定义" },
];

export const FRAMEWORK_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  FRAMEWORK_TYPES.map((t) => [t.key, t.label]),
);

// 交易记录
export interface Trade {
  id: number;
  code: string;
  type: string; // buy | sell
  quantity: number;
  price: number;
  tradedAt: string;
  note: string | null;
  decision: string | null;
  source: string; // manual | ai-daily-deep | committee
  createdAt: string;
}

export const TRADE_SOURCES: { key: string; label: string }[] = [
  { key: 'manual', label: '手动' },
  { key: 'ai-daily-deep', label: 'AI每日深度' },
  { key: 'committee', label: '委员会' },
];

// 交易盈亏汇总
export interface TradeSummary {
  totalBuyQty: number;
  totalSellQty: number;
  netQty: number;
  avgCost: number;
  totalBuyAmount: number;
  totalSellAmount: number;
  realizedPnl: number;
  currentPrice: number | null;
  currentValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
}

// 复盘记录
export interface Review {
  id: number;
  code: string;
  content: string;
  summary: string | null;
  frameworkId: string | null;
  createdAt: string;
}
