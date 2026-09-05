/**
 * akshare 指标抓取调用器。
 *
 * 通过子进程调用 artifacts/api-server/src/python/akshare_fetch.py，
 * 解析其 JSON 输出。Python 侧使用 cybertronian-club/.venv 中的 akshare。
 *
 * 进程 cwd 为仓库根 /home/ubuntu/cybertronian-club（由 start.sh 固定），
 * 因此脚本与 venv 路径均相对仓库根解析，并附加绝对路径兜底。
 */
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

/** akshare_fetch.py 输出的原始指标（snake_case，与 Python 脚本对齐）。 */
export interface AkshareMetrics {
  pe_ttm: number | null;
  pb: number | null;
  ps: number | null;
  roe: number | null;
  gross_margin: number | null;
  net_margin: number | null;
  revenue_yoy: number | null;
  profit_yoy: number | null;
  operating_cashflow: number | null;
  debt_to_equity: number | null;
  dividend_yield: number | null;
  market_cap: number | null;
  price: number | null;
  price_change_pct: number | null;
  name: string | null;
  industry: string | null;
  /** 近 5 年 PE 分位（0-100），数据不足时为 null */
  pe_percentile: number | null;
  pe_band: { min: number; p20: number; p50: number; p80: number; max: number } | null;
  pb_percentile: number | null;
  pb_band: { min: number; p20: number; p50: number; p80: number; max: number } | null;
}

/** 5 个扩展数据源（研报/公告/两融/解禁/股东户数），各自独立降级。 */
export interface AkshareExtraData {
  research_reports: Array<{
    title: string | null;
    org: string | null;
    rating: string | null;
    targetPrice: number | null;
    date: string | null;
  }>;
  announcements: Array<{ title: string | null; date: string | null }>;
  margin: Record<string, unknown>;
  lockup: Array<{ date: string; code: string; amount: number | null; value: number | null }>;
  holders: Array<{
    date: string;
    holders: number | null;
    change: number | null;
    avgHold: number | null;
  }>;
  _degraded: Array<{ source: string; reason: string }>;
}

/** 全市场实时行情行（akshare_fetch.py market 命令输出）。 */
export interface MarketRow {
  code: string;
  name: string;
  price: number | null;
  peTtm: number | null;
  pb: number | null;
  marketCap: number | null;
  priceChangePct: number | null;
}

function resolveVenvPython(): string {
  const candidates = [
    path.resolve(process.cwd(), ".venv/bin/python"),
    path.resolve(process.cwd(), "../.venv/bin/python"),
    "/home/ubuntu/cybertronian-club/.venv/bin/python",
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function resolveAkshareScript(): string {
  const candidates = [
    path.resolve(process.cwd(), "artifacts/api-server/src/python/akshare_fetch.py"),
    path.resolve(process.cwd(), "src/python/akshare_fetch.py"),
    path.resolve(__dirname, "../python/akshare_fetch.py"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

/**
 * 调用 akshare 抓取单只 A 股的最新指标 + 5 年估值分位。
 * 超时 90s（akshare 的 stock_financial_abstract_ths 单请求约 5s）。
 */
export function fetchAkshareMetrics(code: string): Promise<AkshareMetrics> {
  return new Promise((resolve, reject) => {
    const py = resolveVenvPython();
    const script = resolveAkshareScript();
    const proc = spawn(py, [script, code], { timeout: 90_000 });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (err: Error) => reject(err));
    proc.on("close", (exitCode: number | null) => {
      const trimmed = stdout.trim();
      if (exitCode !== 0) {
        reject(
          new Error(
            `akshare_fetch.py exited ${exitCode}: ${stderr.trim() || trimmed}`,
          ),
        );
        return;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && parsed.error) {
          reject(new Error(String(parsed.error)));
          return;
        }
        resolve(parsed as AkshareMetrics);
      } catch {
        reject(
          new Error(`Failed to parse akshare output: ${trimmed.slice(0, 500)}`),
        );
      }
    });
  });
}

/**
 * 调用 akshare 抓取 5 个扩展数据源（研报/公告/两融/解禁/股东户数）。
 * 每个源在 Python 侧独立 try-catch 降级，单个失败不影响其他。
 * 超时 60s。
 */
export function fetchAkshareExtraData(code: string): Promise<AkshareExtraData> {
  return new Promise((resolve, reject) => {
    const py = resolveVenvPython();
    const script = resolveAkshareScript();
    const proc = spawn(py, [script, code, "extra"], { timeout: 60_000 });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (err: Error) => reject(err));
    proc.on("close", (exitCode: number | null) => {
      const trimmed = stdout.trim();
      if (exitCode !== 0) {
        reject(
          new Error(
            `akshare_fetch.py extra exited ${exitCode}: ${stderr.trim() || trimmed}`,
          ),
        );
        return;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && parsed.error) {
          reject(new Error(String(parsed.error)));
          return;
        }
        resolve(parsed as AkshareExtraData);
      } catch {
        reject(
          new Error(`Failed to parse akshare extra output: ${trimmed.slice(0, 500)}`),
        );
      }
    });
  });
}

/**
 * 调用 akshare 抓取全 A 股实时行情快照（用于每周初筛股票池）。
 * 通过 akshare_fetch.py market 子命令，已基础过滤 ST/小市值(<50亿)/亏损(PE<=0)。
 * 超时 120s（stock_zh_a_spot_em 拉全市场约 30-60s）。
 */
export function fetchAkshareMarket(): Promise<MarketRow[]> {
  return new Promise((resolve, reject) => {
    const py = resolveVenvPython();
    const script = resolveAkshareScript();
    const proc = spawn(py, [script, "market"], { timeout: 120_000 });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", (err: Error) => reject(err));
    proc.on("close", (exitCode: number | null) => {
      const trimmed = stdout.trim();
      if (exitCode !== 0) {
        reject(new Error(`akshare_fetch.py market exited ${exitCode}: ${stderr.trim() || trimmed}`));
        return;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && parsed.error) {
          reject(new Error(String(parsed.error)));
          return;
        }
        resolve(Array.isArray(parsed) ? (parsed as MarketRow[]) : []);
      } catch {
        reject(new Error(`Failed to parse akshare market output: ${trimmed.slice(0, 500)}`));
      }
    });
  });
}
