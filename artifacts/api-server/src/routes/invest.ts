/**
 * PIRS 投研笔记模块 API 路由。
 *
 * 挂载于 /api 前缀下，故所有路径以 /invest 开头，对外为 /api/invest/...。
 *
 * 覆盖：
 *  - 股票 / 指标同步（akshare）
 *  - 资源池 watchlist CRUD
 *  - 候选池 candidates CRUD + promote
 *  - 框架 frameworks CRUD
 *  - 笔记写入网关 POST /invest/notes（chat / workflow 共用）
 *  - 预警 alerts
 */
import { Router } from "express";
import {
  db,
  stocksTable,
  stockMetricsTable,
  watchlistTable,
  candidatesTable,
  frameworksTable,
  investNotesTable,
  alertsTable,
  alertRulesTable,
  valuationSnapshotsTable,
  debatesTable,
  screenConfigsTable,
  screenRunsTable,
  investTradesTable,
  investReviewsTable,
} from "@workspace/db";
import { eq, and, desc, ilike, or, sql } from "drizzle-orm";
import { fetchAkshareMetrics, fetchAkshareExtraData } from "../lib/python";
import {
  saveInvestNote,
  upsertStockFromAkshare,
} from "../lib/invest-notes";
import { reflectAudit, runDebate, type DebateDossier } from "../lib/invest-llm";
import { runScreening } from "../lib/invest-screen";

const router = Router();

// ──────────────── 预警规则评估引擎 ────────────────

const OP_LABEL: Record<string, string> = {
  gt: ">", lt: "<", gte: "≥", lte: "≤",
  crosses_up: "向上突破", crosses_down: "向下突破",
};

const METRIC_LABEL: Record<string, string> = {
  peTtm: "PE(TTM)", pb: "PB", ps: "PS", roe: "ROE",
  grossMargin: "毛利率", netMargin: "净利率",
  revenueYoy: "营收同比", profitYoy: "利润同比",
  operatingCashflow: "经营现金流", debtToEquity: "资产负债率",
  dividendYield: "股息率", marketCap: "市值(亿)", price: "现价", priceChangePct: "涨跌幅",
  pePercentile: "PE分位(%)", pbPercentile: "PB分位(%)",
};

function compareValue(value: number, op: string, threshold: number): boolean {
  switch (op) {
    case "gt": return value > threshold;
    case "lt": return value < threshold;
    case "gte": return value >= threshold;
    case "lte": return value <= threshold;
    // crosses_*：无历史快照，简化为阈值突破即触发，靠去重避免重复
    case "crosses_up": return value >= threshold;
    case "crosses_down": return value <= threshold;
    default: return false;
  }
}

// 取出 stock_metrics 行 → 扁平化为 metric→number 映射
function metricsToRecord(m: typeof stockMetricsTable.$inferSelect | undefined): Record<string, number | null> {
  if (!m) return {};
  return {
    peTtm: m.peTtm, pb: m.pb, ps: m.ps, roe: m.roe,
    grossMargin: m.grossMargin, netMargin: m.netMargin,
    revenueYoy: m.revenueYoy, profitYoy: m.profitYoy,
    operatingCashflow: m.operatingCashflow, debtToEquity: m.debtToEquity,
    dividendYield: m.dividendYield, marketCap: m.marketCap,
    price: m.price, priceChangePct: m.priceChangePct,
  };
}

// 从 valuation_snapshots 取最新一条分位数据，注入到 rec 中（支持 pePercentile/pbPercentile 规则）
async function enrichWithValuation(code: string, rec: Record<string, number | null>): Promise<void> {
  try {
    const [snap] = await db
      .select()
      .from(valuationSnapshotsTable)
      .where(eq(valuationSnapshotsTable.code, code))
      .orderBy(desc(valuationSnapshotsTable.snapshotDate))
      .limit(1);
    if (snap) {
      rec.pePercentile = snap.pePercentile;
      rec.pbPercentile = snap.pbPercentile;
    }
  } catch (err) {
    // 不阻塞主流程
    console.error("[invest] enrichWithValuation failed", err);
  }
}

// 同步后评估某只股票的所有启用规则，命中则生成 alert（同规则未读去重）
async function evaluateAlertRules(code: string): Promise<void> {
  try {
    const rules = await db
      .select()
      .from(alertRulesTable)
      .where(and(eq(alertRulesTable.code, code), eq(alertRulesTable.isEnabled, true)));
    if (rules.length === 0) return;

    const [m] = await db
      .select()
      .from(stockMetricsTable)
      .where(eq(stockMetricsTable.code, code));
    const rec = metricsToRecord(m);
    // 注入估值分位（支持 pePercentile/pbPercentile 规则）
    await enrichWithValuation(code, rec);

    const [stock] = await db
      .select({ name: stocksTable.name })
      .from(stocksTable)
      .where(eq(stocksTable.code, code));
    const stockName = stock?.name || code;

    for (const rule of rules) {
      const value = rec[rule.metric];
      if (value === null || value === undefined || Number.isNaN(value)) continue;
      if (!compareValue(value, rule.operator, rule.threshold)) continue;

      // 去重：同规则存在未读 alert 则跳过
      const [existing] = await db
        .select({ id: alertsTable.id })
        .from(alertsTable)
        .where(
          and(
            eq(alertsTable.code, code),
            eq(alertsTable.signalType, `rule:${rule.id}`),
            eq(alertsTable.isRead, false),
          ),
        )
        .limit(1);
      if (existing) continue;

      const metricLabel = METRIC_LABEL[rule.metric] || rule.metric;
      const opLabel = OP_LABEL[rule.operator] || rule.operator;
      const description = `${metricLabel} ${opLabel} ${rule.threshold}（当前 ${value.toFixed(2)}）${rule.note ? " · " + rule.note : ""}`;

      await db.insert(alertsTable).values({
        code,
        stockName,
        level: rule.level,
        signalType: `rule:${rule.id}`,
        description,
        source: "rule",
      });
      await db
        .update(alertRulesTable)
        .set({ lastTriggeredAt: new Date() })
        .where(eq(alertRulesTable.id, rule.id));
    }
  } catch (err) {
    // 规则评估失败不应阻塞同步主流程
    console.error("[invest] evaluateAlertRules failed", err);
  }
}


// 批量取多只股票的最新估值分位快照（用于列表展示）
async function fetchLatestValuations(codes: string[]): Promise<Record<string, { pePercentile: number | null; pbPercentile: number | null }>> {
  if (codes.length === 0) return {};
  const result: Record<string, { pePercentile: number | null; pbPercentile: number | null }> = {};
  try {
    for (const code of codes) {
      const [snap] = await db
        .select({
          pePercentile: valuationSnapshotsTable.pePercentile,
          pbPercentile: valuationSnapshotsTable.pbPercentile,
          snapshotDate: valuationSnapshotsTable.snapshotDate,
        })
        .from(valuationSnapshotsTable)
        .where(eq(valuationSnapshotsTable.code, code))
        .orderBy(desc(valuationSnapshotsTable.snapshotDate))
        .limit(1);
      if (snap) {
        result[code] = { pePercentile: snap.pePercentile, pbPercentile: snap.pbPercentile };
      }
    }
  } catch (err) {
    console.error("[invest] fetchLatestValuations failed", err);
  }
  return result;
}

// ──────────────── 总览 ────────────────

// GET /invest/overview
router.get("/invest/overview", async (_req, res) => {
  try {
    const [watchlistCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(watchlistTable);
    const [candidateCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(candidatesTable)
      .where(eq(candidatesTable.status, "pending"));
    const [noteCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(investNotesTable);
    const [alertCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(alertsTable)
      .where(eq(alertsTable.isRead, false));

    const recentNotes = await db
      .select()
      .from(investNotesTable)
      .orderBy(desc(investNotesTable.createdAt))
      .limit(5);

    res.json({
      watchlist: watchlistCount?.count ?? 0,
      candidates: candidateCount?.count ?? 0,
      notes: noteCount?.count ?? 0,
      unreadAlerts: alertCount?.count ?? 0,
      recentNotes,
    });
  } catch (err) {
    _req.log.error({ err }, "Failed to get invest overview");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────── 股票 / 指标 ────────────────

// GET /invest/stocks?q=
router.get("/invest/stocks", async (req, res) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    const rows = q
      ? await db
          .select()
          .from(stocksTable)
          .where(
            or(
              ilike(stocksTable.code, `%${q}%`),
              ilike(stocksTable.name, `%${q}%`),
            ),
          )
          .limit(50)
      : await db.select().from(stocksTable).limit(50);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list stocks");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /invest/stocks/:code — 股票 + 指标 + 最近笔记
router.get("/invest/stocks/:code", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const [stock] = await db
      .select()
      .from(stocksTable)
      .where(eq(stocksTable.code, code));
    if (!stock) {
      res.status(404).json({ error: "Stock not found" });
      return;
    }
    const [metrics] = await db
      .select()
      .from(stockMetricsTable)
      .where(eq(stockMetricsTable.code, code));
    const notes = await db
      .select()
      .from(investNotesTable)
      .where(eq(investNotesTable.code, code))
      .orderBy(desc(investNotesTable.createdAt));
    res.json({ ...stock, metrics, notes });
  } catch (err) {
    req.log.error({ err }, "Failed to get stock detail");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /invest/stocks/:code/sync — akshare 同步单只股票指标
router.post("/invest/stocks/:code/sync", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const metrics = await fetchAkshareMetrics(code);
    await upsertStockFromAkshare(code, metrics);
    await evaluateAlertRules(code);
    res.json({ code, ...metrics });
  } catch (err) {
    req.log.error({ err }, "Failed to sync stock via akshare");
    res.status(502).json({ error: err instanceof Error ? err.message : "akshare sync failed" });
  }
});

// POST /invest/sync/watchlist — 批量同步资源池中所有股票指标
router.post("/invest/sync/watchlist", async (_req, res) => {
  try {
    const items = await db.select().from(watchlistTable);
    const results: Array<{ code: string; ok: boolean; error?: string }> = [];
    for (const item of items) {
      try {
        const metrics = await fetchAkshareMetrics(item.code);
        await upsertStockFromAkshare(item.code, metrics);
        await evaluateAlertRules(item.code);
        results.push({ code: item.code, ok: true });
      } catch (e) {
        results.push({
          code: item.code,
          ok: false,
          error: e instanceof Error ? e.message : "failed",
        });
      }
    }
    res.json({ total: items.length, results });
  } catch (err) {
    _req.log.error({ err }, "Failed to batch sync watchlist");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────── 资源池 watchlist ────────────────

// GET /invest/watchlist
router.get("/invest/watchlist", async (_req, res) => {
  try {
    const rows = await db
      .select({
        watchlist: watchlistTable,
        metrics: stockMetricsTable,
      })
      .from(watchlistTable)
      .leftJoin(stockMetricsTable, eq(watchlistTable.code, stockMetricsTable.code))
      .orderBy(desc(watchlistTable.updatedAt));
    // 附加最新估值分位
    const codes = rows.map((r) => r.watchlist.code);
    const valuations = await fetchLatestValuations(codes);
    const enriched = rows.map((r) => ({
      ...r,
      valuation: valuations[r.watchlist.code] || null,
    }));
    res.json(enriched);
  } catch (err) {
    _req.log.error({ err }, "Failed to list watchlist");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /invest/watchlist — 加入资源池（自动建股 + 同步指标）
router.post("/invest/watchlist", async (req, res) => {
  try {
    const { code, name, notes, tags, status } = req.body;
    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "code is required" });
      return;
    }
    // 确保股票存在（含 akshare 自动建股）
    const [existing] = await db
      .select({ code: stocksTable.code })
      .from(stocksTable)
      .where(eq(stocksTable.code, code));
    if (!existing) {
      try {
        const metrics = await fetchAkshareMetrics(code);
        await upsertStockFromAkshare(code, metrics);
      } catch {
        await db
          .insert(stocksTable)
          .values({ code, name: name || code })
          .onConflictDoNothing();
      }
    }
    const stockName =
      name ||
      (
        await db
          .select({ name: stocksTable.name })
          .from(stocksTable)
          .where(eq(stocksTable.code, code))
      )[0]?.name ||
      code;

    const [row] = await db
      .insert(watchlistTable)
      .values({
        code,
        name: stockName,
        notes: notes ?? null,
        tags: Array.isArray(tags) ? tags : [],
        status: status || "stable",
      })
      .onConflictDoUpdate({
        target: watchlistTable.code,
        set: {
          name: stockName,
          notes: notes ?? null,
          tags: Array.isArray(tags) ? tags : [],
          status: status || "stable",
          updatedAt: new Date(),
        },
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to add watchlist");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /invest/watchlist/:code
router.put("/invest/watchlist/:code", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const { name, notes, tags, status, isHolding } = req.body;
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) update.name = name;
    if (notes !== undefined) update.notes = notes;
    if (tags !== undefined) update.tags = Array.isArray(tags) ? tags : [];
    if (status !== undefined) update.status = status;
    if (isHolding !== undefined) update.isHolding = isHolding;
    const [row] = await db
      .update(watchlistTable)
      .set(update)
      .where(eq(watchlistTable.code, code))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Watchlist item not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update watchlist");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /invest/watchlist/:code
router.delete("/invest/watchlist/:code", async (req, res) => {
  try {
    const code = req.params.code.trim();
    await db.delete(watchlistTable).where(eq(watchlistTable.code, code));
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "Failed to delete watchlist");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────── 候选池 candidates ────────────────

// GET /invest/candidates?status=
router.get("/invest/candidates", async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const includeRejected = req.query.includeRejected === "1" || req.query.includeRejected === "true";
    const conds = [];
    if (status) conds.push(eq(candidatesTable.status, status));
    else if (!includeRejected) conds.push(sql`status != 'rejected'`);
    const rows = await db
      .select({ candidate: candidatesTable, metrics: stockMetricsTable })
      .from(candidatesTable)
      .leftJoin(stockMetricsTable, eq(candidatesTable.code, stockMetricsTable.code))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(candidatesTable.screenedAt));
    // 附加最新估值分位
    const codes = rows.map((r) => r.candidate.code);
    const valuations = await fetchLatestValuations(codes);
    const enriched = rows.map((r) => ({
      ...r,
      valuation: valuations[r.candidate.code] || null,
    }));
    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "Failed to list candidates");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /invest/candidates — agent 筛选出的候选（默认 pending，待用户同意）
router.post("/invest/candidates", async (req, res) => {
  try {
    const {
      code, name, score, frameworkId, reason, tags,
      peTtm, pb, roe, grossMargin, revenueYoy, marketCap,
    } = req.body;
    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "code is required" });
      return;
    }
    // 确保股票存在
    const [existing] = await db
      .select({ code: stocksTable.code })
      .from(stocksTable)
      .where(eq(stocksTable.code, code));
    if (!existing) {
      try {
        const m = await fetchAkshareMetrics(code);
        await upsertStockFromAkshare(code, m);
      } catch {
        await db
          .insert(stocksTable)
          .values({ code, name: name || code })
          .onConflictDoNothing();
      }
    }
    const stockName =
      name ||
      (
        await db
          .select({ name: stocksTable.name })
          .from(stocksTable)
          .where(eq(stocksTable.code, code))
      )[0]?.name ||
      code;

    const [row] = await db
      .insert(candidatesTable)
      .values({
        code,
        name: stockName,
        score: score ?? null,
        frameworkId: frameworkId ?? null,
        reason: reason ?? null,
        tags: Array.isArray(tags) ? tags : [],
        peTtm: peTtm ?? null,
        pb: pb ?? null,
        roe: roe ?? null,
        grossMargin: grossMargin ?? null,
        revenueYoy: revenueYoy ?? null,
        marketCap: marketCap ?? null,
        status: "pending",
      })
      .onConflictDoUpdate({
        target: candidatesTable.code,
        set: {
          name: stockName,
          score: score ?? null,
          frameworkId: frameworkId ?? null,
          reason: reason ?? null,
          tags: Array.isArray(tags) ? tags : [],
          peTtm: peTtm ?? null,
          pb: pb ?? null,
          roe: roe ?? null,
          grossMargin: grossMargin ?? null,
          revenueYoy: revenueYoy ?? null,
          marketCap: marketCap ?? null,
          screenedAt: new Date(),
        },
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to add candidate");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /invest/candidates/:code/promote — 候选 → 资源池（用户同意后）
router.post("/invest/candidates/:code/promote", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const [cand] = await db
      .select()
      .from(candidatesTable)
      .where(eq(candidatesTable.code, code));
    if (!cand) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    // 加入资源池
    const [wl] = await db
      .insert(watchlistTable)
      .values({
        code: cand.code,
        name: cand.name,
        tags: cand.tags,
        status: "stable",
      })
      .onConflictDoUpdate({
        target: watchlistTable.code,
        set: { name: cand.name, tags: cand.tags, updatedAt: new Date() },
      })
      .returning();
    // 标记候选为 approved
    await db
      .update(candidatesTable)
      .set({ status: "approved" })
      .where(eq(candidatesTable.code, code));
    res.json({ watchlist: wl, candidate: { ...cand, status: "approved" } });
  } catch (err) {
    req.log.error({ err }, "Failed to promote candidate");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /invest/candidates/:code — 更新状态（approved/rejected）
router.put("/invest/candidates/:code", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const { status, score, reason, tags } = req.body;
    const update: Record<string, unknown> = {};
    if (status !== undefined) update.status = status;
    if (score !== undefined) update.score = score;
    if (reason !== undefined) update.reason = reason;
    if (tags !== undefined) update.tags = Array.isArray(tags) ? tags : [];
    if (status === "rejected") update.rejectedAt = new Date();
    else if (status !== undefined) update.rejectedAt = null;
    const [row] = await db
      .update(candidatesTable)
      .set(update)
      .where(eq(candidatesTable.code, code))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update candidate");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /invest/candidates/:code
router.delete("/invest/candidates/:code", async (req, res) => {
  try {
    const code = req.params.code.trim();
    await db.delete(candidatesTable).where(eq(candidatesTable.code, code));
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "Failed to delete candidate");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────── 框架 frameworks ────────────────

// GET /invest/frameworks
router.get("/invest/frameworks", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(frameworksTable)
      .orderBy(desc(frameworksTable.updatedAt));
    res.json(rows);
  } catch (err) {
    _req.log.error({ err }, "Failed to list frameworks");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /invest/frameworks
router.post("/invest/frameworks", async (req, res) => {
  try {
    const { id, name, description, type, dimensions, hardFilters, systemPrompt, environment, isBuiltin, isEnabled } = req.body;
    if (!id || !name) {
      res.status(400).json({ error: "id and name are required" });
      return;
    }
    const [row] = await db
      .insert(frameworksTable)
      .values({
        id,
        name,
        description: description ?? null,
        type: type || "custom",
        dimensions: dimensions ?? [],
        hardFilters: hardFilters ?? [],
        systemPrompt: systemPrompt || "",
        environment: environment || "neutral",
        isBuiltin: isBuiltin ?? false,
        isEnabled: isEnabled ?? true,
      })
      .onConflictDoUpdate({
        target: frameworksTable.id,
        set: {
          name,
          description: description ?? null,
          dimensions: dimensions ?? [],
          hardFilters: hardFilters ?? [],
          systemPrompt: systemPrompt || "",
          environment: environment || "neutral",
          isEnabled: isEnabled ?? true,
          updatedAt: new Date(),
        },
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create framework");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /invest/frameworks/:id
router.put("/invest/frameworks/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { name, description, dimensions, hardFilters, systemPrompt, environment, isEnabled } = req.body;
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (dimensions !== undefined) update.dimensions = dimensions;
    if (hardFilters !== undefined) update.hardFilters = hardFilters;
    if (systemPrompt !== undefined) update.systemPrompt = systemPrompt;
    if (environment !== undefined) update.environment = environment;
    if (isEnabled !== undefined) update.isEnabled = isEnabled;
    const [row] = await db
      .update(frameworksTable)
      .set(update)
      .where(eq(frameworksTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Framework not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update framework");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /invest/frameworks/:id
router.delete("/invest/frameworks/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await db.delete(frameworksTable).where(eq(frameworksTable.id, id));
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "Failed to delete framework");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────── 笔记写入网关 ────────────────

// POST /invest/notes — chat / workflow / 用户统一写入入口
router.post("/invest/notes", async (req, res) => {
  try {
    const note = await saveInvestNote(req.body);
    res.status(201).json(note);

    // P0-2: 自动触发反思审计（fire-and-forget，不阻塞响应）
    // 仅当作者为 agent/workflow 时自动跑，用户手动写的笔记需手动触发
    if (note.author === "agent" || note.author === "workflow") {
      reflectAudit({
        content: note.content,
        conclusion: note.conclusion,
        indicatorsSnapshot: (note.indicatorsSnapshot as Record<string, unknown>) || {},
        title: note.title,
      })
        .then(async (audit) => {
          try {
            await db
              .update(investNotesTable)
              .set({ audit, auditedAt: new Date() })
              .where(eq(investNotesTable.id, note.id));
            req.log.info({ noteId: note.id }, "auto-audit completed");
          } catch (e) {
            req.log.error({ err: e, noteId: note.id }, "auto-audit save failed");
          }
        })
        .catch((err) => {
          req.log.error({ err, noteId: note.id }, "auto-audit failed");
        });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save note";
    req.log.error({ err }, "Failed to save invest note");
    res.status(400).json({ error: msg });
  }
});

// GET /invest/notes — 全部笔记流（可按 code/author/frameworkId 筛选）
router.get("/invest/notes", async (req, res) => {
  try {
    const { code, author, frameworkId } = req.query;
    const conds = [];
    if (code) conds.push(eq(investNotesTable.code, String(code)));
    if (author) conds.push(eq(investNotesTable.author, String(author)));
    if (frameworkId) conds.push(eq(investNotesTable.frameworkId, String(frameworkId)));
    const rows = await db
      .select()
      .from(investNotesTable)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(investNotesTable.createdAt))
      .limit(200);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list notes");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /invest/stocks/:code/notes
router.get("/invest/stocks/:code/notes", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const rows = await db
      .select()
      .from(investNotesTable)
      .where(eq(investNotesTable.code, code))
      .orderBy(desc(investNotesTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list stock notes");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /invest/notes/:id
router.get("/invest/notes/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [row] = await db
      .select()
      .from(investNotesTable)
      .where(eq(investNotesTable.id, id));
    if (!row) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to get note");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /invest/notes/:id
router.put("/invest/notes/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const { title, conclusion, content, frameworkId } = req.body;
    const update: Record<string, unknown> = {};
    if (title !== undefined) update.title = title;
    if (conclusion !== undefined) update.conclusion = conclusion;
    if (content !== undefined) update.content = content;
    if (frameworkId !== undefined) update.frameworkId = frameworkId;
    const [row] = await db
      .update(investNotesTable)
      .set(update)
      .where(eq(investNotesTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update note");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /invest/notes/:id
router.delete("/invest/notes/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    await db.delete(investNotesTable).where(eq(investNotesTable.id, id));
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "Failed to delete note");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────── 预警规则 alert_rules ────────────────

// GET /invest/alert-rules?code=
router.get("/invest/alert-rules", async (req, res) => {
  try {
    const code = req.query.code as string | undefined;
    const rows = await db
      .select()
      .from(alertRulesTable)
      .where(code ? eq(alertRulesTable.code, code) : undefined)
      .orderBy(desc(alertRulesTable.updatedAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list alert rules");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /invest/alert-rules — 创建规则
router.post("/invest/alert-rules", async (req, res) => {
  try {
    const { code, metric, operator, threshold, level, isEnabled, note } = req.body;
    if (!code || !metric || !operator || threshold === undefined || threshold === null) {
      res.status(400).json({ error: "code, metric, operator, threshold are required" });
      return;
    }
    const [row] = await db
      .insert(alertRulesTable)
      .values({
        code,
        metric,
        operator,
        threshold: Number(threshold),
        level: level || "blue",
        isEnabled: isEnabled ?? true,
        note: note ?? null,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create alert rule");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /invest/alert-rules/:id
router.put("/invest/alert-rules/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const { metric, operator, threshold, level, isEnabled, note } = req.body;
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (metric !== undefined) update.metric = metric;
    if (operator !== undefined) update.operator = operator;
    if (threshold !== undefined && threshold !== null) update.threshold = Number(threshold);
    if (level !== undefined) update.level = level;
    if (isEnabled !== undefined) update.isEnabled = isEnabled;
    if (note !== undefined) update.note = note;
    const [row] = await db
      .update(alertRulesTable)
      .set(update)
      .where(eq(alertRulesTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update alert rule");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /invest/alert-rules/:id
router.delete("/invest/alert-rules/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    await db.delete(alertRulesTable).where(eq(alertRulesTable.id, id));
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "Failed to delete alert rule");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────── 预警 alerts ────────────────

// GET /invest/alerts
router.get("/invest/alerts", async (req, res) => {
  try {
    const onlyUnread = req.query.unread === "1" || req.query.unread === "true";
    const rows = await db
      .select()
      .from(alertsTable)
      .where(onlyUnread ? eq(alertsTable.isRead, false) : undefined)
      .orderBy(desc(alertsTable.createdAt))
      .limit(200);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list alerts");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /invest/alerts — agent / workflow 可创建预警
router.post("/invest/alerts", async (req, res) => {
  try {
    const { code, stockName, level, signalType, description, source, noteId } = req.body;
    if (!code || !signalType || !description) {
      res.status(400).json({ error: "code, signalType, description are required" });
      return;
    }
    const [row] = await db
      .insert(alertsTable)
      .values({
        code,
        stockName: stockName || code,
        level: level || "blue",
        signalType,
        description,
        source: source || "system",
        noteId: noteId ?? null,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create alert");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /invest/alerts/:id/read
router.post("/invest/alerts/:id/read", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [row] = await db
      .update(alertsTable)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(alertsTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Alert not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to mark alert read");
    res.status(500).json({ error: "Internal server error" });
  }
});


// ──────────────── 估值历史分位（P0-1） ────────────────

// GET /invest/stocks/:code/valuation — 实时估值分位（含 5 年区间带）
router.get("/invest/stocks/:code/valuation", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const metrics = await fetchAkshareMetrics(code);
    res.json({
      code,
      peTtm: metrics.pe_ttm,
      pePercentile: metrics.pe_percentile,
      peBand: metrics.pe_band,
      pb: metrics.pb,
      pbPercentile: metrics.pb_percentile,
      pbBand: metrics.pb_band,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch valuation");
    res.status(502).json({ error: err instanceof Error ? err.message : "valuation fetch failed" });
  }
});

// GET /invest/stocks/:code/valuation/history — 历史估值分位走势
router.get("/invest/stocks/:code/valuation/history", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const days = parseInt(String(req.query.days || "180"), 10);
    const rows = await db
      .select()
      .from(valuationSnapshotsTable)
      .where(eq(valuationSnapshotsTable.code, code))
      .orderBy(desc(valuationSnapshotsTable.snapshotDate))
      .limit(Math.min(days, 365));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch valuation history");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /invest/stocks/:code/extra-data — 5 个扩展数据源（各自独立降级）
router.get("/invest/stocks/:code/extra-data", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const data = await fetchAkshareExtraData(code);
    res.json({ code, ...data, fetchedAt: new Date().toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch extra data");
    res.status(502).json({ error: err instanceof Error ? err.message : "extra data fetch failed" });
  }
});

// ──────────────── 反思审计（P0-2） ────────────────

// POST /invest/notes/:id/reflect — 跑反思审计，结果写入 notes.audit + audited_at
router.post("/invest/notes/:id/reflect", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [note] = await db
      .select()
      .from(investNotesTable)
      .where(eq(investNotesTable.id, id));
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    // 缓存：已审计且 force!=1 时直接返回
    const force = req.query.force === "1" || req.body?.force === true;
    if (note.audit && note.auditedAt && !force) {
      res.json({ audit: note.audit, auditedAt: note.auditedAt, cached: true });
      return;
    }
    const audit = await reflectAudit({
      content: note.content,
      conclusion: note.conclusion,
      indicatorsSnapshot: (note.indicatorsSnapshot as Record<string, unknown>) || {},
      title: note.title,
    });
    await db
      .update(investNotesTable)
      .set({ audit, auditedAt: new Date() })
      .where(eq(investNotesTable.id, id));
    res.json({ audit, auditedAt: new Date(), cached: false });
  } catch (err) {
    req.log.error({ err }, "Failed to run reflect audit");
    res.status(500).json({ error: err instanceof Error ? err.message : "audit failed" });
  }
});

// ──────────────── 牛熊辩论（P1-1） ────────────────

// POST /invest/stocks/:code/debate — 发起牛熊辩论
router.post("/invest/stocks/:code/debate", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const noteId = req.body?.noteId ? parseInt(req.body.noteId, 10) : null;

    const [m] = await db
      .select()
      .from(stockMetricsTable)
      .where(eq(stockMetricsTable.code, code));
    const [stock] = await db
      .select()
      .from(stocksTable)
      .where(eq(stocksTable.code, code));

    // 实时估值分位（akshare）
    let valuation: DebateDossier["valuation"] = {};
    try {
      const ak = await fetchAkshareMetrics(code);
      valuation = {
        peTtm: ak.pe_ttm,
        pePercentile: ak.pe_percentile,
        peBand: ak.pe_band,
        pb: ak.pb,
        pbPercentile: ak.pb_percentile,
        pbBand: ak.pb_band,
      };
    } catch (e) {
      req.log.warn({ err: e }, "debate: valuation fetch failed, degrade");
    }

    // 最近 3 条笔记作为分析上下文
    const recentNotes = await db
      .select({
        id: investNotesTable.id,
        title: investNotesTable.title,
        conclusion: investNotesTable.conclusion,
        createdAt: investNotesTable.createdAt,
      })
      .from(investNotesTable)
      .where(eq(investNotesTable.code, code))
      .orderBy(desc(investNotesTable.createdAt))
      .limit(3);

    const metricsRec: Record<string, number | null> = m ? {
      peTtm: m.peTtm, pb: m.pb, ps: m.ps, roe: m.roe,
      grossMargin: m.grossMargin, netMargin: m.netMargin,
      revenueYoy: m.revenueYoy, profitYoy: m.profitYoy,
      operatingCashflow: m.operatingCashflow, debtToEquity: m.debtToEquity,
      dividendYield: m.dividendYield, marketCap: m.marketCap,
      price: m.price, priceChangePct: m.priceChangePct,
    } : {};

    const dossier: DebateDossier = {
      code,
      name: stock?.name,
      metrics: metricsRec,
      valuation,
      recentNotes: recentNotes.map((n) => ({
        id: n.id,
        title: n.title,
        conclusion: n.conclusion,
        createdAt: n.createdAt.toISOString(),
      })),
      fetchedAt: new Date().toISOString(),
    };

    const { bullCase, bearCase, disagreements, verifyPaths } = await runDebate(dossier);

    const [debate] = await db
      .insert(debatesTable)
      .values({
        code,
        noteId: noteId || null,
        dossier,
        bullCase,
        bearCase,
        disagreements,
        verifyPaths,
      })
      .returning();

    res.status(201).json(debate);
  } catch (err) {
    req.log.error({ err }, "Failed to run debate");
    res.status(500).json({ error: err instanceof Error ? err.message : "debate failed" });
  }
});

// GET /invest/stocks/:code/debates — 列出该股票历史辩论
router.get("/invest/stocks/:code/debates", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const rows = await db
      .select()
      .from(debatesTable)
      .where(eq(debatesTable.code, code))
      .orderBy(desc(debatesTable.createdAt))
      .limit(20);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list debates");
    res.status(500).json({ error: "Internal server error" });
  }
});


// ──────────────── 初筛 screen ────────────────

// GET /invest/screen/config
router.get("/invest/screen/config", async (_req, res) => {
  try {
    const [config] = await db.select().from(screenConfigsTable).where(eq(screenConfigsTable.id, 1));
    if (config) { res.json(config); return; }
    const [created] = await db.insert(screenConfigsTable).values({ id: 1, nextRunDate: new Date().toISOString().slice(0, 10) }).onConflictDoNothing().returning();
    res.json(created ?? { id: 1, enabled: false, frameworkIds: [], topN: 5, dayOfWeek: 0, nextRunDate: new Date().toISOString().slice(0, 10) });
  } catch (err) {
    _req.log.error({ err }, "Failed to get screen config");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /invest/screen/config
router.put("/invest/screen/config", async (req, res) => {
  try {
    const { enabled, frameworkIds, topN, dayOfWeek } = req.body;
    const dow = typeof dayOfWeek === "number" ? ((Math.trunc(dayOfWeek) % 7) + 7) % 7 : 0;
    const now = new Date();
    const todayDow = now.getDay();
    let diff = (dow - todayDow + 7) % 7;
    if (diff === 0) diff = 7;
    const nextRunDate = new Date(now.getTime() + diff * 86400000).toISOString().slice(0, 10);

    const [existing] = await db.select().from(screenConfigsTable).where(eq(screenConfigsTable.id, 1));
    if (existing) {
      const update: Record<string, unknown> = { nextRunDate, updatedAt: new Date() };
      if (enabled !== undefined) update.enabled = enabled;
      if (Array.isArray(frameworkIds)) update.frameworkIds = frameworkIds;
      if (typeof topN === "number") update.topN = topN;
      if (typeof dayOfWeek === "number") update.dayOfWeek = dow;
      const [row] = await db.update(screenConfigsTable).set(update).where(eq(screenConfigsTable.id, 1)).returning();
      res.json(row);
    } else {
      const [row] = await db.insert(screenConfigsTable).values({
        id: 1, enabled: enabled ?? false,
        frameworkIds: Array.isArray(frameworkIds) ? frameworkIds : [],
        topN: typeof topN === "number" ? topN : 5, dayOfWeek: dow, nextRunDate,
      }).returning();
      res.status(201).json(row);
    }
  } catch (err) {
    req.log.error({ err }, "Failed to update screen config");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /invest/screen/run — 手动触发一次初筛（立即跑，不等下周）
router.post("/invest/screen/run", async (req, res) => {
  try {
    const [config] = await db.select().from(screenConfigsTable).where(eq(screenConfigsTable.id, 1));
    if (!config) { res.status(404).json({ error: "No screen config; save one first" }); return; }
    if (!config.frameworkIds || config.frameworkIds.length === 0) {
      res.status(400).json({ error: "未勾选任何框架，无法初筛" });
      return;
    }
    const result = await runScreening({ id: config.id, frameworkIds: config.frameworkIds, topN: config.topN });
    await db.insert(screenRunsTable).values({
      configId: config.id, frameworkIds: config.frameworkIds,
      pickedCodes: result.picked, poolSize: result.poolSize, summary: result.summary, status: "ok",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Screen run failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "screen run failed" });
  }
});

// GET /invest/screen/runs
router.get("/invest/screen/runs", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || "20"), 10) || 20, 100);
    const rows = await db.select().from(screenRunsTable).orderBy(desc(screenRunsTable.createdAt)).limit(limit);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list screen runs");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────── 持仓交易记录 ────────────────

// GET /invest/stocks/:code/trades
router.get("/invest/stocks/:code/trades", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const rows = await db
      .select()
      .from(investTradesTable)
      .where(eq(investTradesTable.code, code))
      .orderBy(desc(investTradesTable.tradedAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch trades");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /invest/stocks/:code/trades
router.post("/invest/stocks/:code/trades", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const { type, quantity, price, tradedAt, note, decision, source } = req.body;

    // 输入校验
    const tradeType = type === "sell" ? "sell" : type === "buy" ? "buy" : null;
    if (!tradeType) {
      res.status(400).json({ error: "type must be 'buy' or 'sell'" });
      return;
    }
    const qty = Number(quantity);
    const px = Number(price);
    if (!Number.isFinite(qty) || qty <= 0) {
      res.status(400).json({ error: "quantity must be a positive number" });
      return;
    }
    if (!Number.isFinite(px) || px <= 0) {
      res.status(400).json({ error: "price must be a positive number" });
      return;
    }

    const [row] = await db
      .insert(investTradesTable)
      .values({
        code,
        type: tradeType,
        quantity: qty,
        price: px,
        tradedAt: tradedAt ? new Date(tradedAt) : new Date(),
        note: note || null,
        decision: decision || null,
        source: source || "manual",
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to add trade");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /invest/stocks/:code/trades/:id
router.delete("/invest/stocks/:code/trades/:id", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid trade id" });
      return;
    }
    // 归属校验：必须同时匹配 code 和 id
    const [existing] = await db
      .select()
      .from(investTradesTable)
      .where(eq(investTradesTable.id, id));
    if (!existing || existing.code !== code) {
      res.status(404).json({ error: "Trade not found for this stock" });
      return;
    }
    await db.delete(investTradesTable).where(eq(investTradesTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete trade");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /invest/stocks/:code/trades/summary — 盈亏汇总（移动加权平均成本）
router.get("/invest/stocks/:code/trades/summary", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const trades = await db
      .select()
      .from(investTradesTable)
      .where(eq(investTradesTable.code, code));

    // 按时间升序处理，移动加权平均
    const sorted = [...trades].sort((a, b) => new Date(a.tradedAt).getTime() - new Date(b.tradedAt).getTime());

    let avgCost = 0;       // 移动加权平均成本
    let netQty = 0;        // 当前净持仓
    let realizedPnl = 0;   // 已实现盈亏
    let totalBuyAmount = 0;
    let totalSellAmount = 0;
    let totalBuyQty = 0;
    let totalSellQty = 0;

    for (const t of sorted) {
      if (t.type === "buy") {
        // 买入：加权平均成本 = (旧成本×旧数量 + 买入金额) / 新总数量
        const buyAmount = t.quantity * t.price;
        avgCost = (avgCost * netQty + buyAmount) / (netQty + t.quantity);
        netQty += t.quantity;
        totalBuyAmount += buyAmount;
        totalBuyQty += t.quantity;
      } else {
        // 卖出：成本不变，已实现盈亏 = (卖出价 - 当前成本) × 卖出数量
        const sellAmount = t.quantity * t.price;
        realizedPnl += (t.price - avgCost) * t.quantity;
        netQty -= t.quantity;
        totalSellAmount += sellAmount;
        totalSellQty += t.quantity;
      }
    }

    // 获取现价
    const [metrics] = await db
      .select()
      .from(stockMetricsTable)
      .where(eq(stockMetricsTable.code, code));
    const currentPrice = metrics?.price ?? null;
    const currentValue = currentPrice !== null && netQty > 0 ? netQty * currentPrice : null;
    const unrealizedPnl = currentPrice !== null && netQty > 0 ? netQty * (currentPrice - avgCost) : null;
    // 清仓后浮动盈亏为 0，百分比也为 0（避免 0/0 → NaN）
    const unrealizedPnlFinal = netQty === 0 ? 0 : unrealizedPnl;
    const costBasis = netQty * avgCost;
    const unrealizedPnlPct = unrealizedPnlFinal !== null && costBasis > 0
      ? Math.round((unrealizedPnlFinal / costBasis) * 10000) / 100
      : (netQty === 0 ? 0 : null);

    res.json({
      totalBuyQty,
      totalSellQty,
      netQty,
      avgCost: Math.round(avgCost * 100) / 100,
      totalBuyAmount: Math.round(totalBuyAmount * 100) / 100,
      totalSellAmount: Math.round(totalSellAmount * 100) / 100,
      realizedPnl: Math.round(realizedPnl * 100) / 100,
      currentPrice,
      currentValue: currentValue !== null ? Math.round(currentValue * 100) / 100 : null,
      unrealizedPnl: unrealizedPnlFinal !== null ? Math.round(unrealizedPnlFinal * 100) / 100 : null,
      unrealizedPnlPct,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get trades summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ──────────────── 复盘 ────────────────

// GET /invest/stocks/:code/reviews
router.get("/invest/stocks/:code/reviews", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const rows = await db
      .select()
      .from(investReviewsTable)
      .where(eq(investReviewsTable.code, code))
      .orderBy(desc(investReviewsTable.createdAt))
      .limit(20);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch reviews");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /invest/stocks/:code/reviews — 生成复盘（调 LLM）
router.post("/invest/stocks/:code/reviews", async (req, res) => {
  try {
    const code = req.params.code.trim();
    const { frameworkId } = req.body;

    // 并行获取交易记录、指标、估值、近期笔记
    const [trades, metricsRows, valuationRows, notes] = await Promise.all([
      db.select().from(investTradesTable).where(eq(investTradesTable.code, code)).orderBy(desc(investTradesTable.tradedAt)),
      db.select().from(stockMetricsTable).where(eq(stockMetricsTable.code, code)),
      db.select().from(valuationSnapshotsTable).where(eq(valuationSnapshotsTable.code, code)).orderBy(desc(valuationSnapshotsTable.createdAt)).limit(1),
      db.select().from(investNotesTable).where(eq(investNotesTable.code, code)).orderBy(desc(investNotesTable.createdAt)).limit(5),
    ]);

    const metrics = metricsRows[0] || null;
    const valuation = valuationRows[0] || null;

    // 计算盈亏汇总
    let totalBuyAmount = 0, totalBuyQty = 0, totalSellAmount = 0, totalSellQty = 0;
    for (const t of trades) {
      if (t.type === "buy") { totalBuyAmount += t.quantity * t.price; totalBuyQty += t.quantity; }
      else { totalSellAmount += t.quantity * t.price; totalSellQty += t.quantity; }
    }
    const netQty = totalBuyQty - totalSellQty;
    const avgCost = totalBuyQty > 0 ? totalBuyAmount / totalBuyQty : 0;
    const realizedPnl = totalSellAmount - totalSellQty * avgCost;
    const currentPrice = metrics?.price ?? null;
    const unrealizedPnl = currentPrice !== null ? netQty * (currentPrice - avgCost) : null;

    // 获取框架
    let framework = null;
    if (frameworkId) {
      const [fw] = await db.select().from(frameworksTable).where(eq(frameworksTable.id, frameworkId));
      framework = fw || null;
    }

    // 构建 LLM 输入
    const dossier = {
      code,
      name: (await db.select().from(stocksTable).where(eq(stocksTable.code, code)))[0]?.name || code,
      trades: trades.map(t => ({ type: t.type, quantity: t.quantity, price: t.price, tradedAt: t.tradedAt, note: t.note, decision: t.decision, source: t.source })),
      pnl: { netQty, avgCost, currentPrice, realizedPnl, unrealizedPnl },
      metrics: metrics ? {
        peTtm: metrics.peTtm, pb: metrics.pb, roe: metrics.roe,
        grossMargin: metrics.grossMargin, netMargin: metrics.netMargin,
        revenueYoy: metrics.revenueYoy, profitYoy: metrics.profitYoy,
        marketCap: metrics.marketCap, price: metrics.price,
      } : null,
      valuation: valuation ? { pePercentile: valuation.pePercentile, pbPercentile: valuation.pbPercentile } : null,
      recentNotes: notes.map(n => ({ title: n.title, conclusion: n.conclusion, createdAt: n.createdAt })),
      framework: framework ? { name: framework.name, systemPrompt: framework.systemPrompt } : null,
    };

    // 调 LLM
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({
      baseURL: process.env.LLM_BASE_URL || "https://api.deepseek.com/v1",
      apiKey: process.env.DEEPSEEK_API_KEY || "no-key",
    });
    const model = process.env.LLM_MODEL || "deepseek-chat";

    const prompt = `你是一位专业投资复盘助手。请基于以下数据生成一份结构化复盘报告。

## 持仓与交易记录
- 持仓数量: ${netQty}
- 平均成本: ${avgCost.toFixed(2)}
- 现价: ${currentPrice ?? "无数据"}
- 已实现盈亏: ${realizedPnl.toFixed(2)}
- 浮动盈亏: ${unrealizedPnl !== null ? unrealizedPnl.toFixed(2) : "无数据"}
- 交易明细: ${JSON.stringify(dossier.trades)}

## 基本面指标
${dossier.metrics ? JSON.stringify(dossier.metrics) : "无数据"}

## 估值分位
${dossier.valuation ? JSON.stringify(dossier.valuation) : "无数据"}

## 近期投研笔记
${dossier.recentNotes.length > 0 ? JSON.stringify(dossier.recentNotes) : "无"}

请从以下角度进行复盘：
1. **交易回顾**：买入/卖出时点是否合理？有没有追涨杀跌？
2. **基本面变化**：持仓期间基本面（营收、利润、ROE等）有何变化？是否验证了当初的买入逻辑？
3. **估值审视**：当前估值分位是否合理？是否有泡沫或被错杀？
4. **持仓建议**：是否需要加仓、减仓或清仓？给出明确建议。
5. **经验教训**：从这笔交易中能学到什么？

请用 markdown 格式输出复盘内容，在 content 字段中。同时提供一句话总结放 summary 字段。
输出 JSON: {"content": "markdown复盘全文", "summary": "一句话总结"}`;

    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const result = JSON.parse(completion.choices[0].message.content || "{}");

    // 存入复盘记录
    const [review] = await db
      .insert(investReviewsTable)
      .values({
        code,
        content: result.content || "复盘生成失败",
        summary: result.summary || null,
        tradeSnapshot: { trades: dossier.trades, pnl: dossier.pnl },
        metricsSnapshot: dossier.metrics || {},
        frameworkId: frameworkId || null,
      })
      .returning();

    res.status(201).json(review);
  } catch (err) {
    req.log.error({ err }, "Failed to generate review");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
