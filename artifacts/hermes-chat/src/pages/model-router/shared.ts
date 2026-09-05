// 模型路由器：类型定义 + API 工具

export const API = "/api/model-router";

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const resp = await fetch(API + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export interface TimePeriod {
  name: string;
  start: string;
  end: string;
  weekdays?: number[];
}

export interface MatrixCell {
  model: string;
  reasoning: string;
  provider?: string;
  base_url?: string;
  api_key?: string;
}

export interface RoutingConfig {
  enabled: boolean;
  time_routing_enabled: boolean;
  time_periods: TimePeriod[];
  matrix: Record<string, Record<string, MatrixCell>>;
  keywords: { light: string[]; research: string[] };
  base_url?: string;
  api_key?: string;
  model?: { default: string; provider: string; base_url: string };
  vision?: { provider: string; model: string; base_url: string; api_key: string };
  fallback?: { model: string; provider?: string; base_url?: string; api_key?: string };
}

export interface HermesAgent {
  id: string;
  name: string;
  role: string;
  hermesHome: string;
  config: RoutingConfig;
}

export interface ModelPrice {
  id: string;
  name: string;
  prompt_price: number;
  completion_price: number;
  context_length: number;
  input_modalities: string[];
  reasoning: boolean;
  currency?: string; // "USD" | "CNY"
  source?: string;   // 数据来源（OpenRouter / 官方定价页）
}

export interface ComparisonItem extends ModelPrice {
  prompt_per_m: number;
  completion_per_m: number;
  total_per_m: number;
  cost_performance: number;
}

export interface ComparisonResult {
  comparison: ComparisonItem[];
  recommendations: {
    cheapest: ComparisonItem;
    best_performance: ComparisonItem;
    best_value: ComparisonItem;
  } | null;
}

export const TIERS = ["light", "default", "research"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABELS: Record<string, string> = {
  light: "Light（轻量）",
  default: "Default（默认）",
  research: "Research（深度）",
};
export const REASONING_LEVELS = ["low", "medium", "high"] as const;
export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
