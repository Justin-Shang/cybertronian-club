/**
 * 模型路由器 API 路由。
 *
 * 三组端点：
 *  1. Hermes Agent 路由配置（SSH 到 120 读写 config.yaml）
 *  2. Cybertron 路由配置（DB 存储 + 修改 llm.ts 路由逻辑）
 *  3. 模型价格对比（代理 OpenRouter API）
 *
 * 挂载于 /api 前缀下，对外为 /api/model-router/...
 */
import { Router } from "express";
import { execSync } from "child_process";
import { db, modelRoutingConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as yaml from "js-yaml";

const router = Router();

// ──────────────── Hermes Agent 配置 ────────────────

const HERMES_AGENTS = [
  { id: "optimus", name: "擎天柱", role: "投研专家", hermesHome: "/home/ubuntu/hermes-agent/local_config" },
  { id: "tongtianxiao", name: "通天晓", role: "OPC经营", hermesHome: "/home/ubuntu/hermes-agent/local_config_personal" },
  { id: "hotrod", name: "补天士", role: "智算GPU", hermesHome: "/home/ubuntu/hermes-agent/local_config_research" },
  { id: "arcee", name: "阿尔茜", role: "教育专家", hermesHome: "/home/ubuntu/.hermes-transformers/arcee" },
  { id: "bumblebee", name: "大黄蜂", role: "全栈杂学", hermesHome: "/home/ubuntu/.hermes-transformers/bumblebee" },
];

const REMOTE_HOST = "ubuntu@120.53.234.118";
const HERMES_CLI = "/home/ubuntu/hermes-agent/.venv/bin/hermes";

function sshExec(cmd: string): string {
  return execSync(`ssh -o ConnectTimeout=5 ${REMOTE_HOST} '${cmd.replace(/'/g, "'\\''")}'`, {
    encoding: "utf-8",
    timeout: 15000,
  });
}

// 读取 config.yaml 并解析为结构化路由配置
function readHermesConfig(hermesHome: string): Record<string, unknown> {
  try {
    const raw = sshExec(`cat ${hermesHome}/config.yaml`);
    return (yaml.load(raw) as Record<string, unknown>) || {};
  } catch {
    return {};
  }
}

// 将 config.yaml 结构提取为前端所需的路由配置 JSON
function extractRoutingConfig(cfg: Record<string, unknown>) {
  const agent = (cfg.agent as Record<string, unknown>) || {};
  const model = (cfg.model as Record<string, unknown>) || {};
  const vision = (model.vision as Record<string, unknown>) || {};

  const enabled = agent.auto_task_routing_enabled === true;
  const timeRoutingEnabled = agent.time_routing_enabled === true;
  const timePeriods = (agent.time_periods as Array<Record<string, unknown>>) || [];
  const routingMatrix = (agent.routing_matrix as Record<string, Record<string, unknown>>) || {};
  const lightKeywords = (agent.auto_task_routing_light_keywords as string[]) || [];
  const researchKeywords = (agent.auto_task_routing_research_keywords as string[]) || [];

  return {
    enabled,
    time_routing_enabled: timeRoutingEnabled,
    time_periods: timePeriods,
    matrix: maskMatrixKeys(routingMatrix),
    keywords: { light: lightKeywords, research: researchKeywords },
    model: {
      default: model.default || "",
      provider: model.provider || "",
      base_url: model.base_url || "",
    },
    vision: {
      provider: vision.provider || "",
      model: vision.model || "",
      base_url: vision.base_url || "",
      api_key: vision.api_key ? maskKey(String(vision.api_key)) : "",
    },
    fallback: extractFallback(cfg),
  };
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

function maskMatrixKeys(matrix: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [tier, periods] of Object.entries(matrix || {})) {
    result[tier] = {};
    for (const [period, cell] of Object.entries((periods as Record<string, unknown>) || {})) {
      const cc = (cell as Record<string, unknown>) || {};
      result[tier][period] = cc.api_key
        ? { ...cc, api_key: maskKey(String(cc.api_key)) }
        : cc;
    }
  }
  return result;
}

function extractFallback(cfg: Record<string, unknown>) {
  const fbs = (cfg.fallback_providers as Array<Record<string, unknown>>) || [];
  const fb = fbs[0] || {};
  return {
    model: String(fb.model || ""),
    provider: String(fb.provider || ""),
    base_url: String(fb.base_url || ""),
    api_key: fb.api_key ? maskKey(String(fb.api_key)) : "",
  };
}

// GET /api/model-router/hermes/agents
router.get("/model-router/hermes/agents", (_req, res) => {
  try {
    const agents = HERMES_AGENTS.map((a) => {
      const cfg = readHermesConfig(a.hermesHome);
      const routing = extractRoutingConfig(cfg);
      return { id: a.id, name: a.name, role: a.role, hermesHome: a.hermesHome, config: routing };
    });
    res.json(agents);
  } catch (err) {
    req.log.error({ err }, "GET hermes agents failed");
    res.status(500).json({ error: "读取 Hermes 配置失败" });
  }
});

// GET /api/model-router/hermes/agents/:agentId
router.get("/model-router/hermes/agents/:agentId", (req, res) => {
  try {
    const agent = HERMES_AGENTS.find((a) => a.id === req.params.agentId);
    if (!agent) return res.status(404).json({ error: "Agent 不存在" });
    const cfg = readHermesConfig(agent.hermesHome);
    const routing = extractRoutingConfig(cfg);
    res.json({ id: agent.id, name: agent.name, role: agent.role, hermesHome: agent.hermesHome, config: routing });
  } catch (err) {
    req.log.error({ err }, "GET hermes agent failed");
    res.status(500).json({ error: "读取配置失败" });
  }
});

// PUT /api/model-router/hermes/agents/:agentId
// 通过 Python 脚本写入 config.yaml（保留其他字段，只更新路由相关字段）
router.put("/model-router/hermes/agents/:agentId", (req, res) => {
  try {
    const agent = HERMES_AGENTS.find((a) => a.id === req.params.agentId);
    if (!agent) return res.status(404).json({ error: "Agent 不存在" });

    const { config } = req.body;
    if (!config) return res.status(400).json({ error: "config 必填" });

    // 构建 Python 脚本来更新 config.yaml
    const pyScript = buildHermesConfigUpdateScript(config);
    const result = sshExec(
      `HERMES_HOME=${agent.hermesHome} python3 -c '${pyScript.replace(/'/g, "'\\''")}'`
    );

    // 重启对应的 systemd 服务
    const serviceName = `hermes-${agent.id === "optimus" ? "work" : agent.id === "tongtianxiao" ? "personal" : agent.id === "hotrod" ? "research" : agent.id}`;
    try {
      sshExec(`sudo systemctl restart ${serviceName}`);
    } catch {
      // 重启失败不阻断，只记录
    }

    res.json({ updated: true, agent: agent.id, output: result.trim() });
  } catch (err) {
    req.log.error({ err }, "PUT hermes agent failed");
    res.status(500).json({ error: "更新配置失败" });
  }
});

// 生成 Python 脚本：读取 config.yaml → 更新路由字段 → 写回
function buildHermesConfigUpdateScript(config: Record<string, unknown>): string {
  // 将 config 序列化为 JSON，Python 脚本读取并更新 YAML
  const jsonStr = JSON.stringify(config);
  return `
import json, os, sys
try:
    import yaml
except ImportError:
    os.system("pip install pyyaml -q")
    import yaml

hermes_home = os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes"))
config_path = os.path.join(hermes_home, "config.yaml")

with open(config_path, "r") as f:
    cfg = yaml.safe_load(f) or {}

new_config = json.loads(${JSON.stringify(jsonStr)})

# 更新 agent 路由配置
agent = cfg.setdefault("agent", {})
agent["auto_task_routing_enabled"] = new_config.get("enabled", True)
agent["time_routing_enabled"] = new_config.get("time_routing_enabled", False)

if "time_periods" in new_config:
    agent["time_periods"] = new_config["time_periods"]
if "matrix" in new_config:
    agent["routing_matrix"] = new_config["matrix"]
if "keywords" in new_config:
    kw = new_config["keywords"]
    agent["auto_task_routing_light_keywords"] = kw.get("light", [])
    agent["auto_task_routing_research_keywords"] = kw.get("research", [])

# 更新 model 配置
if "model" in new_config:
    m = new_config["model"]
    model = cfg.setdefault("model", {})
    if m.get("default"):
        model["default"] = m["default"]
    if m.get("provider"):
        model["provider"] = m["provider"]
    if m.get("base_url"):
        model["base_url"] = m["base_url"]

# 更新 vision 配置
if "vision" in new_config:
    v = new_config["vision"]
    vision = model.setdefault("vision", {})
    if v.get("provider"):
        vision["provider"] = v["provider"]
    if v.get("model"):
        vision["model"] = v["model"]
    if v.get("base_url"):
        vision["base_url"] = v["base_url"]
    # api_key: 如果是掩码值（含 ****），不更新
    ak = v.get("api_key", "")
    if ak and "****" not in ak:
        vision["api_key"] = ak

# Update fallback_providers
fb = new_config.get("fallback")
if fb and isinstance(fb, dict) and fb.get("model"):
    cfg["fallback_providers"] = [{
        "provider": fb.get("provider", ""),
        "model": fb.get("model", ""),
        "base_url": fb.get("base_url", ""),
        "api_key": fb.get("api_key", ""),
    }]
else:
    cfg["fallback_providers"] = []

with open(config_path, "w") as f:
    yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

print("OK")
`;
}

// ──────────────── Cybertron 配置 ────────────────

const CYBERTRON_TARGET = "cybertron";

function defaultCybertronConfig() {
  return {
    enabled: false,
    time_routing_enabled: false,
    time_periods: [
      { name: "busy", start: "09:00", end: "18:00", weekdays: [1, 2, 3, 4, 5] },
      { name: "idle", start: "18:00", end: "09:00" },
    ],
    matrix: {
      light: {
        busy: { model: process.env.LLM_MODEL || "deepseek-chat", reasoning: "low" },
        idle: { model: process.env.LLM_MODEL || "deepseek-chat", reasoning: "low" },
        _default: { model: process.env.LLM_MODEL || "deepseek-chat", reasoning: "low" },
      },
      default: {
        busy: { model: process.env.LLM_MODEL || "deepseek-chat", reasoning: "medium" },
        idle: { model: process.env.LLM_MODEL || "deepseek-chat", reasoning: "medium" },
        _default: { model: process.env.LLM_MODEL || "deepseek-chat", reasoning: "medium" },
      },
      research: {
        busy: { model: process.env.LLM_MODEL || "deepseek-chat", reasoning: "high" },
        idle: { model: process.env.LLM_MODEL || "deepseek-chat", reasoning: "high" },
        _default: { model: process.env.LLM_MODEL || "deepseek-chat", reasoning: "high" },
      },
    },
    keywords: { light: [], research: [] },
    base_url: process.env.LLM_BASE_URL || "https://api.deepseek.com/v1",
    api_key: maskKey(process.env.DEEPSEEK_API_KEY || ""),
    fallback: {
      model: process.env.LLM_MODEL || "deepseek-chat",
      provider: "deepseek",
      base_url: process.env.LLM_BASE_URL || "https://api.deepseek.com/v1",
      api_key: maskKey(process.env.DEEPSEEK_API_KEY || ""),
    },
  };
}

// GET /api/model-router/cybertron
router.get("/model-router/cybertron", async (_req, res) => {
  try {
    const row = await db.select().from(modelRoutingConfigsTable).where(eq(modelRoutingConfigsTable.target, CYBERTRON_TARGET)).limit(1);
    if (row.length === 0) {
      res.json(defaultCybertronConfig());
    } else {
      const config = row[0].config as Record<string, unknown>;
      // 掩码 api_key
      if (config.api_key && typeof config.api_key === "string" && !config.api_key.includes("****")) {
        config.api_key = maskKey(config.api_key);
      }
      if (!config.fallback) {
        const defaults = defaultCybertronConfig();
        config.fallback = defaults.fallback;
      }
      res.json(config);
    }
  } catch (err) {
    req.log.error({ err }, "GET cybertron config failed");
    res.status(500).json({ error: "读取配置失败" });
  }
});

// PUT /api/model-router/cybertron
router.put("/model-router/cybertron", async (req, res) => {
  try {
    const config = req.body;
    if (!config) return res.status(400).json({ error: "config 必填" });

    // 如果 api_key 是掩码值，从 DB 中读取原始值
    if (config.api_key && typeof config.api_key === "string" && config.api_key.includes("****")) {
      const existing = await db.select().from(modelRoutingConfigsTable).where(eq(modelRoutingConfigsTable.target, CYBERTRON_TARGET)).limit(1);
      if (existing.length > 0) {
        const oldConfig = existing[0].config as Record<string, unknown>;
        if (oldConfig.api_key && typeof oldConfig.api_key === "string") {
          config.api_key = oldConfig.api_key;
        }
      } else {
        config.api_key = process.env.DEEPSEEK_API_KEY || "";
      }
    }

    const row = await db
      .insert(modelRoutingConfigsTable)
      .values({ target: CYBERTRON_TARGET, config })
      .onConflictDoUpdate({
        target: modelRoutingConfigsTable.target,
        set: { config, updatedAt: new Date() },
      })
      .returning();

    res.json({ updated: true, config: row[0].config });
  } catch (err) {
    req.log.error({ err }, "PUT cybertron config failed");
    res.status(500).json({ error: "更新配置失败" });
  }
});

// ──────────────── 模型价格对比 ────────────────

let priceCache: { data: unknown[]; ts: number } | null = null;
const PRICE_CACHE_TTL = 600_000; // 10 分钟
// ── 国产模型官方价（人民币元/百万 token，采集 2026-08-13，DeepSeek 为 8/17 生效峰谷价）──
const CNY_TO_USD = 1 / 7.2; // 统一对比用汇率
const LOCAL_PRICES: Array<Record<string, unknown>> = [
  { id: "cn/deepseek-v4-pro", name: "DeepSeek-V4-Pro 空闲", prompt: 4.5, completion: 13.5, ctx: 1000000, reasoning: true, source: "DeepSeek官网 8/17生效" },
  { id: "cn/deepseek-v4-pro-peak", name: "DeepSeek-V4-Pro 高峰", prompt: 9.0, completion: 27.0, ctx: 1000000, reasoning: true, source: "DeepSeek官网 8/17生效" },
  { id: "cn/deepseek-v4-flash", name: "DeepSeek-V4-Flash 空闲", prompt: 1.5, completion: 4.5, ctx: 1000000, reasoning: true, source: "DeepSeek官网 8/17生效" },
  { id: "cn/deepseek-v4-flash-peak", name: "DeepSeek-V4-Flash 高峰", prompt: 3.0, completion: 9.0, ctx: 1000000, reasoning: true, source: "DeepSeek官网 8/17生效" },
  { id: "cn/glm-5.2", name: "GLM-5.2", prompt: 8, completion: 28, ctx: 1000000, reasoning: true, source: "智谱开放平台" },
  { id: "cn/glm-5.1", name: "GLM-5.1", prompt: 6, completion: 24, ctx: 128000, reasoning: true, source: "智谱开放平台" },
  { id: "cn/glm-5-turbo", name: "GLM-5-Turbo", prompt: 5, completion: 22, ctx: 128000, reasoning: true, source: "智谱开放平台" },
  { id: "cn/glm-5", name: "GLM-5", prompt: 4, completion: 18, ctx: 128000, reasoning: true, source: "智谱开放平台" },
  { id: "cn/glm-4.5-air", name: "GLM-4.5-Air", prompt: 0.8, completion: 2, ctx: 128000, reasoning: false, source: "智谱开放平台" },
  { id: "cn/glm-4.7-flash", name: "GLM-4.7-Flash 免费", prompt: 0, completion: 0, ctx: 200000, reasoning: false, source: "智谱开放平台" },
  { id: "cn/kimi-k3", name: "Kimi K3", prompt: 20, completion: 100, ctx: 1000000, reasoning: true, source: "Kimi官方 2026-08-07" },
  { id: "cn/kimi-k2.6", name: "Kimi K2.6", prompt: 6.9, completion: 29, ctx: 256000, reasoning: true, source: "Moonshot官方" },
  { id: "cn/kimi-k2.7-code", name: "Kimi K2.7 Code", prompt: 6.9, completion: 29, ctx: 256000, reasoning: true, source: "Moonshot官方" },
  { id: "cn/doubao-seed-2.0-pro", name: "豆包 Seed-2.0-Pro", prompt: 3.2, completion: 16, ctx: 256000, reasoning: true, source: "火山方舟 2026-08-06" },
  { id: "cn/doubao-seed-2.0-lite", name: "豆包 Seed-2.0-Lite", prompt: 0.6, completion: 3.6, ctx: 256000, reasoning: false, source: "火山方舟 2026-08-06" },
  { id: "cn/doubao-seed-2.0-mini", name: "豆包 Seed-2.0-Mini", prompt: 0.2, completion: 2, ctx: 256000, reasoning: false, source: "火山方舟 2026-08-06" },
  { id: "cn/qwen3.7-plus", name: "Qwen3.7-Plus", prompt: 2, completion: 8, ctx: 1000000, reasoning: true, source: "阿里云百炼" },
];

// 本地价格 → ModelPrice 结构（统一转 USD 供跨币种对比）
function localToModelPrice(m: Record<string, unknown>) {
  return {
    id: m.id as string,
    name: m.name as string,
    prompt_price: (m.prompt as number) * CNY_TO_USD / 1_000_000,
    completion_price: (m.completion as number) * CNY_TO_USD / 1_000_000,
    context_length: m.ctx as number,
    input_modalities: ["text"],
    reasoning: m.reasoning as boolean,
    currency: "CNY",
    source: m.source as string,
    prompt_cny: m.prompt as number,
    completion_cny: m.completion as number,
  };
}

async function getPriceModels(): Promise<Array<Record<string, unknown>>> {
  if (priceCache && Date.now() - priceCache.ts < PRICE_CACHE_TTL) return priceCache.data;
  const resp = await fetch("https://openrouter.ai/api/v1/models");
  if (!resp.ok) throw new Error("OpenRouter API 不可达");
  const raw = (await resp.json()) as { data: Array<Record<string, unknown>> };
  const orModels = raw.data.map((m) => {
    const pricing = (m.pricing as Record<string, string>) || {};
    const arch = (m.architecture as Record<string, unknown>) || {};
    const reasoning = m.reasoning as Record<string, unknown> | undefined;
    return {
      id: m.id as string,
      name: m.name as string,
      prompt_price: parseFloat(pricing.prompt || "0"),
      completion_price: parseFloat(pricing.completion || "0"),
      context_length: m.context_length as number,
      input_modalities: arch.input_modalities || ["text"],
      reasoning: reasoning ? reasoning.mandatory !== null : false,
      currency: "USD",
      source: "OpenRouter",
    };
  });
  const merged = [...orModels, ...LOCAL_PRICES.map(localToModelPrice)];
  priceCache = { data: merged, ts: Date.now() };
  return merged;
}


// GET /api/model-router/prices
router.get("/model-router/prices", async (req, res) => {
  try {
    const refresh = req.query.refresh === "true";
    if (!refresh && priceCache && Date.now() - priceCache.ts < PRICE_CACHE_TTL) {
      return res.json({ models: priceCache.data, cached: true });
    }
    try {
      const models = await getPriceModels();
      res.json({ models, cached: false });
    } catch (err) {
      req.log.error({ err }, "GET prices failed");
      res.status(502).json({ error: "获取价格失败（OpenRouter 或本地价格表异常）" });
    }
  } catch (err) {
    req.log.error({ err }, "GET prices failed");
    res.status(500).json({ error: "获取价格失败" });
  }
});

// POST /api/model-router/prices/compare
router.post("/model-router/prices/compare", async (req, res) => {
  try {
    const { models: selectedIds } = req.body as { models: string[] };
    if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
      return res.status(400).json({ error: "models 必填" });
    }

    // 确保有缓存数据（OpenRouter + 国产官方价合并）
    const allModels = await getPriceModels();
    const selected = allModels.filter((m) => selectedIds.includes(m.id));

    if (selected.length === 0) return res.json({ comparison: [], recommendations: null });

    // 计算对比数据
    const comparison = selected.map((m) => {
      const promptP = (m.prompt_price as number) * 1_000_000;
      const completionP = (m.completion_price as number) * 1_000_000;
      const totalP = promptP + completionP;
      const ctx = (m.context_length as number) || 0;
      const isCny = m.currency === "CNY";
      return {
        ...m,
        prompt_per_m: promptP,
        completion_per_m: completionP,
        total_per_m: totalP,
        cost_performance: totalP > 0 ? ctx / totalP : 0,
        prompt_cny_per_m: isCny ? (m.prompt_cny as number) : undefined,
        completion_cny_per_m: isCny ? (m.completion_cny as number) : undefined,
        total_cny_per_m: isCny ? (m.prompt_cny as number) + (m.completion_cny as number) : undefined,
      };
    });

    // 推荐
    const recommendations = {
      cheapest: comparison.reduce((a, b) => (a.total_per_m < b.total_per_m ? a : b)),
      best_performance: comparison.reduce((a, b) => {
        const aScore = (a.context_length as number) + (a.reasoning ? 100000 : 0);
        const bScore = (b.context_length as number) + (b.reasoning ? 100000 : 0);
        return aScore > bScore ? a : b;
      }),
      best_value: comparison.reduce((a, b) => (a.cost_performance > b.cost_performance ? a : b)),
    };

    res.json({ comparison, recommendations });
  } catch (err) {
    req.log.error({ err }, "POST prices compare failed");
    res.status(500).json({ error: "对比失败" });
  }
});

export default router;
