/**
 * Invest 每周自动初筛执行器。
 *
 * 进程内 setInterval（24h）调度，由 index.ts 启动时调用 processScreenConfigs。
 * next_run_date 持久化在 screen_configs 表，重启幂等（仿 finance-recurring）。
 *
 * 流程：akshare 全市场行情 → 排除(6月内否决/已在资源池或候选池) → 取市值前100 →
 *      DeepSeek 注入所选框架 systemPrompt 选 topN → 建股+同步指标 → 写 candidates(pending)。
 */
import {
  db,
  stocksTable,
  candidatesTable,
  watchlistTable,
  frameworksTable,
  screenConfigsTable,
  screenRunsTable,
} from "@workspace/db";
import { eq, and, lte, gte, inArray, or, not } from "drizzle-orm";
import type { Logger } from "pino";
import { fetchAkshareMarket, fetchAkshareMetrics, type MarketRow } from "./python";
import { upsertStockFromAkshare } from "./invest-notes";
import { screenStocks } from "./invest-llm";
import { advanceNextRun } from "./finance-recurring";

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

export interface ScreeningResult {
  picked: string[];
  poolSize: number;
  summary: string;
}

/** 执行一次初筛。 */
export async function runScreening(config: {
  id: number;
  frameworkIds: string[];
  topN: number;
}): Promise<ScreeningResult> {
  if (!config.frameworkIds || config.frameworkIds.length === 0) {
    throw new Error("未勾选任何框架，无法初筛");
  }

  // 1. 全市场行情粗筛
  const market = await fetchAkshareMarket();
  if (market.length === 0) {
    throw new Error("akshare 全市场行情为空");
  }

  // 2. 取应排除的 code 集合
  const sixMonthsAgo = new Date(Date.now() - SIX_MONTHS_MS);
  const [wlRows, candRows] = await Promise.all([
    db.select({ code: watchlistTable.code }).from(watchlistTable),
    // 已占据的候选：pending/approved（非 rejected）+ 6 个月内 rejected
    db
      .select({ code: candidatesTable.code })
      .from(candidatesTable)
      .where(
        or(
          not(eq(candidatesTable.status, "rejected")),
          and(eq(candidatesTable.status, "rejected"), gte(candidatesTable.rejectedAt, sixMonthsAgo)),
        ),
      ),
  ]);
  const excluded = new Set<string>([
    ...wlRows.map((r) => r.code),
    ...candRows.map((r) => r.code),
  ]);

  // 3. 过滤 + 按市值降序取前 100（控 LLM token 量）
  const pool = market
    .filter((r) => !excluded.has(r.code))
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .slice(0, 100);

  if (pool.length === 0) {
    return { picked: [], poolSize: 0, summary: "过滤后候选池为空" };
  }

  // 4. 读所选框架（仅启用的）
  const frameworks = await db
    .select()
    .from(frameworksTable)
    .where(
      and(
        inArray(frameworksTable.id, config.frameworkIds),
        eq(frameworksTable.isEnabled, true),
      ),
    );
  if (frameworks.length === 0) {
    throw new Error("所选框架均不存在或未启用");
  }

  // 5. DeepSeek 选股
  const picks = await screenStocks({ frameworks, pool, topN: config.topN });

  // 6. 每支建股+补指标+写 candidates
  for (const pick of picks) {
    const marketRow = market.find((r) => r.code === pick.code);
    try {
      const m = await fetchAkshareMetrics(pick.code);
      await upsertStockFromAkshare(pick.code, m);
    } catch {
      // 降级：仅用 market 行情数据建股兜底
      if (marketRow) {
        await db
          .insert(stocksTable)
          .values({ code: pick.code, name: marketRow.name })
          .onConflictDoNothing();
      }
    }
    await db
      .insert(candidatesTable)
      .values({
        code: pick.code,
        name: marketRow?.name ?? pick.code,
        score: pick.score,
        frameworkId: pick.frameworkId,
        reason: pick.reason,
        tags: [],
        peTtm: marketRow?.peTtm ?? null,
        pb: marketRow?.pb ?? null,
        marketCap: marketRow?.marketCap ?? null,
        status: "pending",
      })
      .onConflictDoUpdate({
        target: candidatesTable.code,
        set: {
          name: marketRow?.name ?? pick.code,
          score: pick.score,
          frameworkId: pick.frameworkId,
          reason: pick.reason,
          peTtm: marketRow?.peTtm ?? null,
          pb: marketRow?.pb ?? null,
          marketCap: marketRow?.marketCap ?? null,
          status: "pending",
          rejectedAt: null,
          screenedAt: new Date(),
        },
      });
  }

  const summary = picks
    .map((p) => `${p.code}(${p.score ?? "—"}分): ${p.reason.slice(0, 40)}`)
    .join(" | ");
  return {
    picked: picks.map((p) => p.code),
    poolSize: pool.length,
    summary,
  };
}

/** 处理所有到期配置：执行初筛 + 写记录 + 推进 next_run_date。 */
export async function processScreenConfigs(
  log?: Logger,
): Promise<{ processed: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const configs = await db
    .select()
    .from(screenConfigsTable)
    .where(
      and(eq(screenConfigsTable.enabled, true), lte(screenConfigsTable.nextRunDate, today)),
    );

  for (const config of configs) {
    try {
      const result = await runScreening({
        id: config.id,
        frameworkIds: config.frameworkIds,
        topN: config.topN,
      });
      await db.insert(screenRunsTable).values({
        configId: config.id,
        frameworkIds: config.frameworkIds,
        pickedCodes: result.picked,
        poolSize: result.poolSize,
        summary: result.summary,
        status: "ok",
      });
      log?.info(
        { configId: config.id, picked: result.picked, poolSize: result.poolSize },
        "screening run ok",
      );
    } catch (err) {
      log?.error({ err, configId: config.id }, "screening run failed");
      await db
        .insert(screenRunsTable)
        .values({
          configId: config.id,
          frameworkIds: config.frameworkIds,
          pickedCodes: [],
          status: "failed",
          error: String(err).slice(0, 500),
        })
        .catch(() => {});
    }
    // 推进 next_run_date（失败也推进，避免每周重复失败；跨多周则循环推进到未来）
    let next = advanceNextRun("weekly", config.nextRunDate, null);
    while (next <= today) {
      next = advanceNextRun("weekly", next, null);
    }
    await db
      .update(screenConfigsTable)
      .set({ nextRunDate: next, lastRunAt: new Date() })
      .where(eq(screenConfigsTable.id, config.id));
  }

  if (configs.length > 0) {
    log?.info({ processed: configs.length }, "screening configs processed");
  }
  return { processed: configs.length };
}
