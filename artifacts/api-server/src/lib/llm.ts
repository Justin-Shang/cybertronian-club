import OpenAI from "openai";
import type { Logger } from "pino";

// LLM via DeepSeek (OpenAI-compatible) + Tavily web search.
// 配置优先级：DB 路由配置 > 环境变量 (DEEPSEEK_API_KEY, LLM_BASE_URL, LLM_MODEL)

interface RoutingMatrixCell {
  model: string;
  reasoning?: string;
  base_url?: string;
  api_key?: string;
  fallback?: { model: string; provider?: string; base_url?: string; api_key?: string };
}
interface RoutingConfig {
  enabled: boolean;
  time_routing_enabled: boolean;
  time_periods: Array<{ name: string; start: string; end: string; weekdays?: number[] }>;
  matrix: Record<string, Record<string, RoutingMatrixCell>>;
  base_url?: string;
  api_key?: string;
}

let routingConfig: RoutingConfig | null = null;
let routingConfigTs = 0;
const ROUTING_CONFIG_TTL = 30_000; // 30s 缓存

const clientCache = new Map<string, OpenAI>();

// 从 DB 读取路由配置（带缓存）
async function loadRoutingConfig(): Promise<RoutingConfig | null> {
  if (routingConfig && Date.now() - routingConfigTs < ROUTING_CONFIG_TTL) return routingConfig;
  try {
    const { db, modelRoutingConfigsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const row = await db.select().from(modelRoutingConfigsTable).where(eq(modelRoutingConfigsTable.target, "cybertron")).limit(1);
    if (row.length > 0) {
      routingConfig = row[0].config as RoutingConfig;
      routingConfigTs = Date.now();
      return routingConfig;
    }
  } catch {
    // DB 不可用或表不存在，退化为环境变量
  }
  routingConfig = null;
  routingConfigTs = Date.now();
  return null;
}

// 匹配当前时间段
function getCurrentPeriod(config: RoutingConfig): string | null {
  if (!config.time_routing_enabled || !config.time_periods?.length) return null;
  const now = new Date();
  const hhmm = now.getHours() * 100 + now.getMinutes();
  const weekday = now.getDay() || 7; // 周日=7

  for (const p of config.time_periods) {
    const start = parseInt(p.start.replace(":", ""), 10);
    const end = parseInt(p.end.replace(":", ""), 10);
    if (p.weekdays?.length && !p.weekdays.includes(weekday)) continue;

    if (start <= end) {
      if (hhmm >= start && hhmm < end) return p.name;
    } else {
      // 跨午夜：如 18:00 → 09:00
      if (hhmm >= start || hhmm < end) return p.name;
    }
  }
  return null;
}

// 解析路由：tier + 当前时间 → {model, baseURL, apiKey}
async function resolveModel(tier: string = "default"): Promise<{ model: string; baseURL: string; apiKey: string }> {
  const config = await loadRoutingConfig();
  const fallback = {
    model: process.env.LLM_MODEL || "deepseek-chat",
    baseURL: process.env.LLM_BASE_URL || "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY || "no-key",
  };

  if (!config || !config.enabled) return fallback;

  const tierMatrix = config.matrix?.[tier];
  if (!tierMatrix) return fallback;

  const period = getCurrentPeriod(config);
  const cell = (period && tierMatrix[period]) || tierMatrix._default;
  if (!cell) return fallback;

  return {
    model: cell.model || fallback.model,
    baseURL: cell.base_url || config.base_url || fallback.baseURL,
    apiKey: cell.api_key || config.api_key || fallback.apiKey,
  };
}

async function getClient(tier: string = "default"): Promise<OpenAI> {
  const { baseURL, apiKey } = await resolveModel(tier);
  const cacheKey = baseURL + "|" + apiKey.slice(-8);
  let client = clientCache.get(cacheKey);
  if (client) return client;
  client = new OpenAI({ baseURL, apiKey });
  clientCache.set(cacheKey, client);
  return client;
}

async function getModel(tier: string = "default"): Promise<string> {
  const { model } = await resolveModel(tier);
  return model;
}

async function resolveFallback(): Promise<{ model: string; baseURL: string; apiKey: string } | null> {
  const config = await loadRoutingConfig();
  if (!config?.fallback?.model) return null;
  const env = {
    model: process.env.LLM_MODEL || "deepseek-chat",
    baseURL: process.env.LLM_BASE_URL || "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY || "no-key",
  };
  return {
    model: config.fallback.model,
    baseURL: config.fallback.base_url || config.base_url || env.baseURL,
    apiKey: config.fallback.api_key || config.api_key || env.apiKey,
  };
}

async function chatComplete(
  tier: string,
  params: Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, "model">,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const { model, baseURL, apiKey } = await resolveModel(tier);
  const client = new OpenAI({ baseURL, apiKey });
  try {
    return await client.chat.completions.create({ ...params, model });
  } catch (err) {
    const fb = await resolveFallback();
    if (!fb) throw err;
    const fbClient = new OpenAI({ baseURL: fb.baseURL, apiKey: fb.apiKey });
    return await fbClient.chat.completions.create({ ...params, model: fb.model });
  }
}

// 同步兼容方法（首次调用可能未命中缓存，退化为环境变量）
function getClientSync(): OpenAI {
  return getClient().catch(() => {
    if (!clientCache.has("sync-fallback")) {
      clientCache.set("sync-fallback", new OpenAI({
        baseURL: process.env.LLM_BASE_URL || "https://api.deepseek.com/v1",
        apiKey: process.env.DEEPSEEK_API_KEY || "no-key",
      }));
    }
    return clientCache.get("sync-fallback")!;
  }) as unknown as OpenAI;
}

function modelSync(): string {
  return process.env.LLM_MODEL || "deepseek-chat";
}

// P0-2 step 1: extract key entities from a user question.
export async function extractEntities(question: string, log?: Logger): Promise<string[]> {
  try {
    const response = await chatComplete("light", {
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Extract the key entities (concepts, methods, terms) from the user question. ' +
            'Return JSON: {"entities": ["entity1", "entity2", ...]}. Use the original language of the question. ' +
            'Only include substantive entities, not stop words.',
        },
        { role: "user", content: question },
      ],
    });
    const data = JSON.parse(response.choices?.[0]?.message?.content || '{"entities":[]}');
    const entities: unknown = data.entities;
    if (Array.isArray(entities)) {
      return entities.filter((e): e is string => typeof e === "string" && e.trim().length > 0);
    }
    return [];
  } catch (err) {
    log?.error({ err }, "extractEntities failed");
    return [];
  }
}

// P0-2 step 5: answer from graph context, with sufficiency flag.
export async function generateAnswer(
  question: string,
  context: string,
  citedNodes: { id: number; label: string }[],
  log?: Logger,
): Promise<{ answer: string; citedNodeIds: number[]; sufficient: boolean }> {
  try {
    const nodeLegend = citedNodes.map((n) => `[${n.id}] ${n.label}`).join("\n");
    const response = await chatComplete("default", {
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a knowledge-graph QA assistant. Answer the user's question based on the provided graph context. " +
            'Return JSON: {"answer":"...","citedNodeIds":[1,2],"sufficient":true}. ' +
            "Set sufficient=true ONLY if the graph context contains enough information to fully answer. " +
            "If the graph context is missing, partial, or cannot answer the question, set sufficient=false and briefly note what's missing. " +
            "Answer in the same language as the question. Cite node ids you actually used.",
        },
        {
          role: "user",
          content: `Graph context:\n${context}\n\nCitable nodes (id → label):\n${nodeLegend}\n\nQuestion: ${question}`,
        },
      ],
    });
    const data = JSON.parse(response.choices?.[0]?.message?.content || '{"answer":"","citedNodeIds":[],"sufficient":false}');
    const answer: string = typeof data.answer === "string" ? data.answer : "No answer available.";
    const rawIds: unknown = data.citedNodeIds;
    const citedNodeIds: number[] = Array.isArray(rawIds)
      ? rawIds.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
      : [];
    const sufficient: boolean = data.sufficient === true;
    return { answer, citedNodeIds, sufficient };
  } catch (err) {
    log?.error({ err }, "generateAnswer failed");
    return { answer: "问答服务暂不可用，请稍后重试。", citedNodeIds: [], sufficient: false };
  }
}

// External web search via Tavily (LLM-friendly, returns clean snippets + AI answer).
export interface TavilyResult {
  title: string;
  url: string;
  content: string;
}
export interface TavilySearchResponse {
  answer: string;
  results: TavilyResult[];
}

export async function tavilySearch(
  query: string,
  maxResults = 5,
  log?: Logger,
): Promise<TavilySearchResponse> {
  try {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      log?.warn("TAVILY_API_KEY not set, skipping web search");
      return { answer: "", results: [] };
    }
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: maxResults,
        include_answer: true,
      }),
    });
    if (!res.ok) {
      log?.error({ status: res.status }, "Tavily search HTTP error");
      return { answer: "", results: [] };
    }
    const data = (await res.json()) as { answer?: string; results?: Array<{ title?: string; url?: string; content?: string }> };
    const results: TavilyResult[] = Array.isArray(data.results)
      ? data.results
          .filter((r): r is Record<string, string> => typeof r === "object" && r !== null)
          .map((r) => ({ title: r.title ?? "", url: r.url ?? "", content: r.content ?? "" }))
          .filter((r) => r.url)
      : [];
    return { answer: data.answer ?? "", results };
  } catch (err) {
    log?.error({ err }, "tavilySearch failed");
    return { answer: "", results: [] };
  }
}

// Synthesize final answer from graph context + web search results (LLM reasoning).
export async function synthesizeAnswer(
  question: string,
  graphContext: string,
  searchResults: TavilyResult[],
  citedNodes: { id: number; label: string }[],
  log?: Logger,
): Promise<{ answer: string; citedNodeIds: number[] }> {
  try {
    const nodeLegend = citedNodes.map((n) => `[${n.id}] ${n.label}`).join("\n");
    const searchContext = searchResults
      .map((r, i) => `[web${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 600)}`)
      .join("\n\n");
    const response = await chatComplete("research", {
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a knowledge-graph QA assistant with web search augmentation. " +
            "Synthesize an answer using BOTH the graph context (internal knowledge) and web search results (external). " +
            "Prefer graph-sourced facts and cite node ids; supplement with web sources when the graph is incomplete. " +
            'Return JSON: {"answer":"...","citedNodeIds":[1,2]}. ' +
            "Answer in the same language as the question. Be precise and note where information comes from (graph vs web) when relevant.",
        },
        {
          role: "user",
          content:
            `Graph context:\n${graphContext}\n\n` +
            `Citable graph nodes (id → label):\n${nodeLegend}\n\n` +
            `Web search results:\n${searchContext}\n\n` +
            `Question: ${question}`,
        },
      ],
    });
    const data = JSON.parse(response.choices?.[0]?.message?.content || '{"answer":"","citedNodeIds":[]}');
    const answer: string = typeof data.answer === "string" ? data.answer : "No answer available.";
    const rawIds: unknown = data.citedNodeIds;
    const citedNodeIds: number[] = Array.isArray(rawIds)
      ? rawIds.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
      : [];
    return { answer, citedNodeIds };
  } catch (err) {
    log?.error({ err }, "synthesizeAnswer failed");
    return { answer: "综合推理失败，请稍后重试。", citedNodeIds: [] };
  }
}

// P0-3: extract structured facts from content for graph ingestion.
export interface ExtractedFactNode {
  label: string;
  type: string;
  content: string;
}
export interface ExtractedFactEdge {
  fromLabel: string;
  toLabel: string;
  edgeType: string;
}
export interface ExtractedFacts {
  nodes: ExtractedFactNode[];
  edges: ExtractedFactEdge[];
}

const VALID_EDGE_TYPES = new Set(["属于", "先修", "矛盾", "替代", "应用于", "信号来源", "配合", "其他"]);

export async function extractFacts(
  content: string,
  existingLabels: string[],
  log?: Logger,
): Promise<ExtractedFacts> {
  try {
    const labelsHint = existingLabels.slice(0, 80).join(", ");
    const response = await chatComplete("research", {
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extract structured knowledge facts from the given content for a knowledge graph. " +
            "Identify key concepts/methods/entities as nodes, and relationships as edges. " +
            "Prefer reusing existing node labels when the concept already exists. " +
            "Edge types MUST be one of: 属于, 先修, 矛盾, 替代, 应用于, 信号来源, 配合, 其他. " +
            'Return JSON: {"nodes":[{"label":"","type":"concept|method|entity|tool|person|company","content":""}], ' +
            '"edges":[{"fromLabel":"","toLabel":"","edgeType":""}]}. ' +
            "Node content should be a 1-2 sentence summary. Keep labels concise. " +
            "Only extract facts explicitly stated or strongly implied in the content.",
        },
        {
          role: "user",
          content: `Existing node labels (prefer reuse): ${labelsHint}\n\nContent:\n${content}`,
        },
      ],
    });
    const data = JSON.parse(response.choices?.[0]?.message?.content || '{"nodes":[],"edges":[]}');
    const nodes: ExtractedFactNode[] = Array.isArray(data.nodes)
      ? data.nodes
          .filter((n: unknown): n is Record<string, unknown> => typeof n === "object" && n !== null)
          .map((n: Record<string, unknown>) => ({
            label: String(n.label ?? "").trim(),
            type: String(n.type ?? "concept").trim() || "concept",
            content: String(n.content ?? "").trim(),
          }))
          .filter((n: ExtractedFactNode) => n.label.length > 0)
      : [];
    const edges: ExtractedFactEdge[] = Array.isArray(data.edges)
      ? data.edges
          .filter((e: unknown): e is Record<string, unknown> => typeof e === "object" && e !== null)
          .map((e: Record<string, unknown>) => ({
            fromLabel: String(e.fromLabel ?? "").trim(),
            toLabel: String(e.toLabel ?? "").trim(),
            edgeType: VALID_EDGE_TYPES.has(String(e.edgeType)) ? String(e.edgeType) : "其他",
          }))
          .filter((e: ExtractedFactEdge) => e.fromLabel.length > 0 && e.toLabel.length > 0)
      : [];
    return { nodes, edges };
  } catch (err) {
    log?.error({ err }, "extractFacts failed");
    return { nodes: [], edges: [] };
  }
}

// M4.1 fallback: classify a single edge label into edge type.
export async function classifyEdgeLabel(label: string, log?: Logger): Promise<string> {
  try {
    const response = await chatComplete("light", {
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Classify the relationship described by the edge label into exactly one of: " +
            "属于, 先修, 矛盾, 替代, 应用于, 信号来源, 配合, 其他. " +
            'Return JSON: {"edgeType": "..."}.',
        },
        { role: "user", content: `Edge label: "${label}"` },
      ],
    });
    const data = JSON.parse(response.choices?.[0]?.message?.content || '{"edgeType":"其他"}');
    const t = String(data.edgeType ?? "其他");
    return VALID_EDGE_TYPES.has(t) ? t : "其他";
  } catch (err) {
    log?.error({ err }, "classifyEdgeLabel failed");
    return "其他";
  }
}

// 导出路由解析函数（供其他模块使用）
export { getClient, getModel, getClientSync, modelSync };
