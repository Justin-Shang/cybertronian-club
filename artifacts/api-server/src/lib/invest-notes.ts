/**
 * 投研笔记写入网关（单一入口）。
 *
 * chat 事后解析与 workflow write_note 节点均调用此函数，
 * 保证校验 / 自动快照 / 溯源字段一致。路由 POST /invest/notes 也复用它。
 *
 * 行为：
 * 1. 校验 code / conclusion / content；
 * 2. 若 stocks 表无该 code，则调用 akshare 自动建股 + 同步指标（失败则建最小记录）；
 * 3. 拷贝当前 stock_metrics 作为 indicators_snapshot；
 * 4. 写入 invest_notes 并返回。
 */
import { db } from "@workspace/db";
import {
  stocksTable,
  stockMetricsTable,
  investNotesTable,
  valuationSnapshotsTable,
  type InvestNote,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { fetchAkshareMetrics, type AkshareMetrics } from "./python";

export interface SaveNoteInput {
  code: string;
  frameworkId?: string | null;
  title?: string | null;
  conclusion: string;
  content: string;
  author?: string; // agent | user | workflow
  agentName?: string | null;
  roomId?: number | null;
  workflowExecutionId?: number | null;
}

/** 把 akshare 原始指标（snake_case）映射并 upsert 到 stocks + stock_metrics。 */
export async function upsertStockFromAkshare(
  code: string,
  m: AkshareMetrics,
): Promise<void> {
  const name = m.name || code;
  const industry = m.industry || "未分类";
  await db
    .insert(stocksTable)
    .values({ code, name, industry })
    .onConflictDoUpdate({
      target: stocksTable.code,
      set: {
        name,
        industry,
        updatedAt: new Date(),
      },
    });
  await db
    .insert(stockMetricsTable)
    .values({
      code,
      peTtm: m.pe_ttm,
      pb: m.pb,
      ps: m.ps,
      roe: m.roe,
      grossMargin: m.gross_margin,
      netMargin: m.net_margin,
      revenueYoy: m.revenue_yoy,
      profitYoy: m.profit_yoy,
      operatingCashflow: m.operating_cashflow,
      debtToEquity: m.debt_to_equity,
      dividendYield: m.dividend_yield,
      marketCap: m.market_cap,
      price: m.price,
      priceChangePct: m.price_change_pct,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: stockMetricsTable.code,
      set: {
        peTtm: m.pe_ttm,
        pb: m.pb,
        ps: m.ps,
        roe: m.roe,
        grossMargin: m.gross_margin,
        netMargin: m.net_margin,
        revenueYoy: m.revenue_yoy,
        profitYoy: m.profit_yoy,
        operatingCashflow: m.operating_cashflow,
        debtToEquity: m.debt_to_equity,
        dividendYield: m.dividend_yield,
        marketCap: m.market_cap,
        price: m.price,
        priceChangePct: m.price_change_pct,
        updatedAt: new Date(),
      },
    });

  // 同步估值分位快照（每日一条，UNIQUE(code, snapshot_date) 防重）
  if (m.pe_percentile !== null || m.pb_percentile !== null) {
    const today = new Date().toISOString().slice(0, 10);
    try {
      await db
        .insert(valuationSnapshotsTable)
        .values({
          code,
          snapshotDate: today,
          peTtm: m.pe_ttm,
          pePercentile: m.pe_percentile,
          peBand: m.pe_band,
          pbPercentile: m.pb_percentile,
          pbBand: m.pb_band,
          source: "akshare",
        })
        .onConflictDoUpdate({
          target: [valuationSnapshotsTable.code, valuationSnapshotsTable.snapshotDate],
          set: {
            peTtm: m.pe_ttm,
            pePercentile: m.pe_percentile,
            peBand: m.pe_band,
            pbPercentile: m.pb_percentile,
            pbBand: m.pb_band,
          },
        });
    } catch (err) {
      // 快照写入失败不阻塞主流程
      console.error("[invest] valuation snapshot upsert failed", err);
    }
  }
}

/** 取当前 stock_metrics 的快照（写入笔记时冻结）。 */
async function snapshotMetrics(code: string): Promise<Record<string, unknown>> {
  const [m] = await db
    .select()
    .from(stockMetricsTable)
    .where(eq(stockMetricsTable.code, code));
  if (!m) return {};
  return {
    peTtm: m.peTtm,
    pb: m.pb,
    ps: m.ps,
    roe: m.roe,
    grossMargin: m.grossMargin,
    netMargin: m.netMargin,
    revenueYoy: m.revenueYoy,
    profitYoy: m.profitYoy,
    operatingCashflow: m.operatingCashflow,
    debtToEquity: m.debtToEquity,
    marketCap: m.marketCap,
    price: m.price,
    priceChangePct: m.priceChangePct,
    dividendYield: m.dividendYield,
    updatedAt: m.updatedAt,
  };
}

/** 确保股票存在；不存在则尝试 akshare 自动建股。 */
async function ensureStock(code: string): Promise<void> {
  const [existing] = await db
    .select({ code: stocksTable.code })
    .from(stocksTable)
    .where(eq(stocksTable.code, code));
  if (existing) return;
  try {
    const metrics = await fetchAkshareMetrics(code);
    await upsertStockFromAkshare(code, metrics);
  } catch {
    // akshare 不可用时建最小记录，保证笔记可写
    await db
      .insert(stocksTable)
      .values({ code, name: code })
      .onConflictDoNothing();
  }
}

/** 笔记写入网关核心：校验 → 建股 → 快照 → 插入。 */
export async function saveInvestNote(input: SaveNoteInput): Promise<InvestNote> {
  const code = String(input.code || "").trim();
  const conclusion = String(input.conclusion || "").trim();
  const content = String(input.content || "").trim();
  if (!code) throw new Error("code is required");
  if (!conclusion) throw new Error("conclusion is required");
  if (!content) throw new Error("content is required");

  await ensureStock(code);
  const snapshot = await snapshotMetrics(code);

  const [note] = await db
    .insert(investNotesTable)
    .values({
      code,
      frameworkId: input.frameworkId || null,
      title: input.title || null,
      conclusion,
      content,
      indicatorsSnapshot: snapshot,
      author: input.author || "agent",
      agentName: input.agentName || null,
      roomId: input.roomId || null,
      workflowExecutionId: input.workflowExecutionId || null,
    })
    .returning();

  if (!note) {
    throw new Error("Failed to insert invest note");
  }
  return note;
}
