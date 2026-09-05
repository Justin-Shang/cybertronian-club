// Cybertron 模型路由配置页
import { useState, useEffect } from "react";
import Layout from "@/components/layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Route, Save, RefreshCw } from "lucide-react";
import { apiFetch, type RoutingConfig, type ModelPrice } from "./shared";
import { MatrixEditor } from "./matrix-editor";

const DEFAULT_CONFIG: RoutingConfig = {
  enabled: false,
  time_routing_enabled: false,
  time_periods: [
    { name: "busy", start: "09:00", end: "18:00", weekdays: [1, 2, 3, 4, 5] },
    { name: "idle", start: "18:00", end: "09:00" },
  ],
  matrix: {
    light: { _default: { model: "deepseek-chat", reasoning: "low" } },
    default: { _default: { model: "deepseek-chat", reasoning: "medium" } },
    research: { _default: { model: "deepseek-chat", reasoning: "high" } },
  },
  keywords: { light: [], research: [] },
  base_url: "https://api.deepseek.com/v1",
  api_key: "",
};

export default function CybertronRouter() {
  const [config, setConfig] = useState<RoutingConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<string[]>(["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash", "deepseek-v4-pro"]);

  useEffect(() => {
    apiFetch<RoutingConfig>("/cybertron")
      .then(setConfig)
      .catch(() => toast.error("加载配置失败"))
      .finally(() => setLoading(false));
  }, []);

  // 从价格 API 拉取可用模型列表
  useEffect(() => {
    apiFetch<{ models: ModelPrice[] }>("/prices")
      .then((d) => {
        const deepseekModels = d.models
          .filter((m) => m.id.toLowerCase().includes("deepseek"))
          .map((m) => m.id);
        if (deepseekModels.length > 0) setModels(deepseekModels);
      })
      .catch(() => {});
  }, []);

  const save = () => {
    setSaving(true);
    apiFetch("/cybertron", { method: "PUT", body: JSON.stringify(config) })
      .then(() => toast.success("配置已保存，服务已重启"))
      .catch(() => toast.error("保存失败"))
      .finally(() => setSaving(false));
  };

  if (loading) return <Layout><div className="p-6 text-muted-foreground">加载中...</div></Layout>;

  return (
    <Layout>
      <div className="h-full overflow-y-auto p-6 space-y-4 max-w-5xl">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Route className="w-5 h-5 text-primary" />
            Cybertron 模型路由
          </h1>
          <Button onClick={save} disabled={saving}>
            <Save className="w-4 h-4 mr-1" />
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          配置 Cybertron 应用的 LLM 模型路由策略。支持按任务难度（light/default/research）和时间段（忙时/闲时）两个维度混合路由。
        </p>

        {/* 基础配置 */}
        <Card className="p-3 space-y-3">
          <div className="text-sm font-medium">基础配置</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Base URL</label>
              <Input
                value={config.base_url || ""}
                onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
                className="mt-1"
                placeholder="https://api.deepseek.com/v1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">API Key</label>
              <Input
                type="password"
                value={config.api_key || ""}
                onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
                className="mt-1"
                placeholder="sk-****（掩码值不更新）"
              />
            </div>
          </div>
        </Card>

        {/* 二维路由矩阵 */}
        <MatrixEditor config={config} onChange={setConfig} availableModels={models} />
      </div>
    </Layout>
  );
}
