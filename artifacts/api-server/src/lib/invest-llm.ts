/**
 * 投研 LLM 工具集：反思审计 + 牛熊辩论。
 *
 * 复用 DeepSeek 客户端（OpenAI 兼容），不调 Hermes agent —— 避免跨服务器延迟。
 *
 * - reflectAudit(note)：移植 Vibe REFLECT_PROMPT 五块框架，输出固定 JSON schema
 * - runDebate(code, dossier)：13 项事实底稿 → 多空立论 → 分歧清单 + 验证路径
 *
 * 所有 LLM 输出强制 response_format=json_object，失败时返回带 error 字段的对象，
 * 调用方负责降级处理。
 */
import OpenAI from "openai";
import type { Framework } from "@workspace/db";
import type { MarketRow } from "./python";

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

export interface AuditResult {
  supported: Array<{ claim: string; evidence: string }>;
  unsupported: Array<{ claim: string; reason: string }>;
  dataIssues: Array<{ issue: string }>;
  weakestLink: string;
  verifyChecklist: string[];
}

export interface DebateDossier {
  code: string;
  name?: string;
  metrics: Record<string, number | null>;
  valuation: {
    peTtm?: number | null;
    pePercentile?: number | null;
    peBand?: { min: number; p20: number; p50: number; p80: number; max: number } | null;
    pb?: number | null;
    pbPercentile?: number | null;
    pbBand?: { min: number; p20: number; p50: number; p80: number; max: number } | null;
  };
  recentNotes: Array<{ id: number; title?: string | null; conclusion: string; createdAt: string }>;
  fetchedAt: string;
}

export interface DebateResult {
  dossier: DebateDossier;
  bullCase: string;
  bearCase: string;
  disagreements: Array<{
    issue: string;
    bullView: string;
    bearView: string;
    evidence: string;
  }>;
  verifyPaths: string[];
}

// ──────────────── 反思审计（P0-2） ────────────────

const AUDIT_SYSTEM_PROMPT = `你是一位严谨的投研审计员。给定一份投研笔记，你的任务是用五块框架审计它：

1. supported — 有数据支撑的结论：列出笔记中由指标快照/财务数据明确支撑的论断。每条需引用原句（claim）+ 数据依据（evidence）。
2. unsupported — 缺乏数据支撑的论断：列出笔记中的观点/预测/判断但未给出数据依据。每条需说明缺什么数据（reason）。
3. dataIssues — 数据使用问题：指标快照是否被误读？单位是否混淆？时间口径是否错位？同环比是否张冠李戴？
4. weakestLink — 最脆弱一环：整篇分析中最经不起推敲的论证环节（一句话总结）。
5. verifyChecklist — 验证清单：3-6 条可执行的验证步骤，用于核实笔记中的关键论断（每条应可被独立检验）。

严格要求：
- claim 必须引用笔记原文，禁止改写或概括
- evidence 必须引用具体指标/数据，禁止泛泛而谈
- reason 必须指出缺失的具体数据维度
- 输出固定 JSON schema，禁止添加额外字段

输出 JSON schema：
{
  "supported": [{"claim": "原句", "evidence": "数据依据"}],
  "unsupported": [{"claim": "原句", "reason": "缺什么数据"}],
  "dataIssues": [{"issue": "问题描述"}],
  "weakestLink": "最脆弱一环",
  "verifyChecklist": ["验证步骤1", "验证步骤2", "..."]
}`;

export async function reflectAudit(input: {
  content: string;
  conclusion: string;
  indicatorsSnapshot: Record<string, unknown>;
  title?: string | null;
}): Promise<AuditResult> {
  const client = getClient();
  const userPrompt = `请审计以下投研笔记：

标题：${input.title || "(无标题)"}
结论：${input.conclusion}
指标快照：${JSON.stringify(input.indicatorsSnapshot, null, 2)}

笔记正文：
${input.content}`;

  const response = await client.chat.completions.create({
    model: model(),
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: AUDIT_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw) as AuditResult;

  // 防御：保证字段结构完整
  return {
    supported: Array.isArray(parsed.supported) ? parsed.supported : [],
    unsupported: Array.isArray(parsed.unsupported) ? parsed.unsupported : [],
    dataIssues: Array.isArray(parsed.dataIssues) ? parsed.dataIssues : [],
    weakestLink: typeof parsed.weakestLink === "string" ? parsed.weakestLink : "",
    verifyChecklist: Array.isArray(parsed.verifyChecklist) ? parsed.verifyChecklist : [],
  };
}

// ──────────────── 牛熊辩论（P1-1） ────────────────

const DEBATE_SYSTEM_PROMPT = `你是一位投资辩论主持人。给定一份事实底稿（dossier，13 项数据），你需要扮演三个角色依次发言：

1. 多方（bull）：基于 dossier 中的数据，论证看多该标的的理由。要求每条论据必须引用具体数据。
2. 空方（bear）：基于同一份 dossier，论证看空该标的的理由。同样要求引用数据。
3. 主持人：综合多空双方观点，输出分歧清单和验证路径。

严格要求：
- 多方和空方都必须基于 dossier 中的真实数据立论，禁止编造数据
- 分歧清单聚焦"同一数据不同解读"或"数据缺失导致判断分歧"
- 验证路径必须是可执行的（如"跟踪未来 3 个月经营现金流变化"），不能是"加强研究"这种空话
- 不做买卖裁决，输出到分歧+验证为止

输出固定 JSON schema：
{
  "bullCase": "多方立论（多段文本）",
  "bearCase": "空方立论（多段文本）",
  "disagreements": [
    {"issue": "争议焦点", "bullView": "多方观点", "bearView": "空方观点", "evidence": "数据依据"}
  ],
  "verifyPaths": ["验证路径1", "验证路径2", "..."]
}`;

export async function runDebate(dossier: DebateDossier): Promise<{
  bullCase: string;
  bearCase: string;
  disagreements: DebateResult["disagreements"];
  verifyPaths: string[];
}> {
  const client = getClient();
  const userPrompt = `请基于以下事实底稿展开牛熊辩论：

${JSON.stringify(dossier, null, 2)}`;

  const response = await client.chat.completions.create({
    model: model(),
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: DEBATE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw);

  return {
    bullCase: typeof parsed.bullCase === "string" ? parsed.bullCase : "",
    bearCase: typeof parsed.bearCase === "string" ? parsed.bearCase : "",
    disagreements: Array.isArray(parsed.disagreements) ? parsed.disagreements : [],
    verifyPaths: Array.isArray(parsed.verifyPaths) ? parsed.verifyPaths : [],
  };
}

// ──────────────── 初筛选股（每周自动初筛） ────────────────

const SCREEN_SYSTEM_PROMPT = `你是一位严谨的 A 股选股分析师。你将收到：
1. 一组投资框架的分析视角（systemPrompt）
2. 一批候选股票的实时指标（代码/名称/PE(TTM)/市净率(PB)/总市值(亿)/涨跌幅）

你的任务：严格按照所给框架的选股视角，从候选股票中选出最具投资价值的 N 支，每支给出：
- code：股票代码（必须来自候选列表）
- reason：入选理由（必须引用具体指标数据，结合框架视角说明为何入选）
- score：0-100 综合评分
- frameworkId：最契合的框架 id（从所给框架中选）

严格要求：
- 只能从候选列表中选，禁止编造代码
- 数量恰好为指定 N 支（若候选不足 N，则全选）
- reason 必须引用具体数据，禁止空话

输出 JSON schema：
{
  "picks": [
    {"code": "600000", "reason": "...", "score": 88, "frameworkId": "value"}
  ]
}`;

export interface ScreenPick {
  code: string;
  reason: string;
  score: number | null;
  frameworkId: string;
}

export async function screenStocks(input: {
  frameworks: Framework[];
  pool: MarketRow[];
  topN: number;
}): Promise<ScreenPick[]> {
  const client = getClient();
  const frameworksView = input.frameworks
    .map((f) => `### 框架：${f.id}（${f.name}）\n${f.systemPrompt}`)
    .join("\n\n");
  const poolLines = input.pool
    .map((r) => `${r.code} ${r.name} | PE=${r.peTtm ?? "—"} PB=${r.pb ?? "—"} 市值=${r.marketCap ?? "—"}亿 涨跌幅=${r.priceChangePct ?? "—"}%`)
    .join("\n");
  const userPrompt = `请按以下框架视角，从候选股票中选出 ${input.topN} 支：

${frameworksView}

候选股票：
${poolLines}

请输出恰好 ${input.topN} 支。`;

  const response = await client.chat.completions.create({
    model: model(),
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SCREEN_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw) as { picks?: Array<{ code?: unknown; reason?: unknown; score?: unknown; frameworkId?: unknown }> };
  const picks = Array.isArray(parsed.picks) ? parsed.picks : [];
  return picks
    .filter((x) => x && typeof x.code === "string")
    .slice(0, input.topN)
    .map((x) => ({
      code: String(x.code),
      reason: typeof x.reason === "string" ? x.reason : "",
      score: typeof x.score === "number" ? x.score : null,
      frameworkId: typeof x.frameworkId === "string" ? x.frameworkId : (input.frameworks[0]?.id ?? ""),
    }));
}
