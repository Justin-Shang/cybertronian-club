// Hermes Agent 模型路由配置页
import { useState, useEffect } from "react";
import Layout from "@/components/layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Bot, Save } from "lucide-react";
import { apiFetch, type HermesAgent, type RoutingConfig, type ModelPrice } from "./shared";
import { MatrixEditor } from "./matrix-editor";

const AGENT_TABS = [
  { id: "optimus", label: "擎天柱" },
  { id: "tongtianxiao", label: "通天晓" },
  { id: "hotrod", label: "补天士" },
  { id: "arcee", label: "阿尔茜" },
  { id: "bumblebee", label: "大黄蜂" },
];

export default function HermesRouter() {
  const [agents, setAgents] = useState<HermesAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<string[]>(["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"]);

  useEffect(() => {
    apiFetch<HermesAgent[]>("/hermes/agents")
      .then(setAgents)
      .catch(() => toast.error("加载 Hermes 配置失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    apiFetch<{ models: ModelPrice[] }>("/prices")
      .then((d) => {
        const ds = d.models.filter((m) => m.id.toLowerCase().includes("deepseek")).map((m) => m.id);
        if (ds.length > 0) setModels(ds);
      })
      .catch(() => {});
  }, []);

  const updateAgent = (agentId: string, config: RoutingConfig) => {
    setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, config } : a)));
  };

  const saveAgent = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;
    setSaving(true);
    apiFetch("/hermes/agents/" + agentId, { method: "PUT", body: JSON.stringify({ config: agent.config }) })
      .then(() => toast.success(agent.name + " 配置已保存，服务已重启"))
      .catch(() => toast.error("保存失败"))
      .finally(() => setSaving(false));
  };

  if (loading) return <Layout><div className="p-6 text-muted-foreground">加载中...</div></Layout>;
  if (agents.length === 0) return <Layout><div className="p-6 text-muted-foreground">无法连接到 Hermes 服务器</div></Layout>;

  return (
    <Layout>
      <div className="h-full overflow-y-auto p-6 space-y-4 max-w-5xl">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          Hermes Agent 模型路由
        </h1>
        <p className="text-sm text-muted-foreground">
          配置 5 个 Hermes Agent 的 LLM 路由策略（含视觉模型）。支持按任务难度和时间段两个维度混合路由。
        </p>
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          注意：本策略仅对云上 5 个 Hermes Agent（擎天柱 / 通天晓 / 补天士 / 阿尔茜 / 大黄蜂）生效，本地 Hermes 不受影响。
        </div>

        <Tabs defaultValue="optimus">
          <TabsList>
            {AGENT_TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>
            ))}
          </TabsList>

          {agents.map((agent) => (
            <TabsContent key={agent.id} value={agent.id}>
              <Card className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{agent.name}</span>
                    <span className="text-muted-foreground ml-2 text-sm">{agent.role}</span>
                  </div>
                  <Button size="sm" onClick={() => saveAgent(agent.id)} disabled={saving}>
                    <Save className="w-3 h-3 mr-1" />
                    {saving ? "保存中..." : "保存"}
                  </Button>
                </div>

                {/* 默认模型配置 */}
                {agent.config.model && (
                  <Card className="p-3 space-y-2">
                    <div className="text-sm font-medium">默认模型</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground">Model</label>
                        <Input
                          value={agent.config.model.default || ""}
                          onChange={(e) => updateAgent(agent.id, { ...agent.config, model: { ...agent.config.model!, default: e.target.value } })}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Provider</label>
                        <Input
                          value={agent.config.model.provider || ""}
                          onChange={(e) => updateAgent(agent.id, { ...agent.config, model: { ...agent.config.model!, provider: e.target.value } })}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Base URL</label>
                        <Input
                          value={agent.config.model.base_url || ""}
                          onChange={(e) => updateAgent(agent.id, { ...agent.config, model: { ...agent.config.model!, base_url: e.target.value } })}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </Card>
                )}

                {/* 二维路由矩阵 + 视觉模型 */}
                <MatrixEditor
                  config={agent.config}
                  onChange={(cfg) => updateAgent(agent.id, cfg)}
                  availableModels={models}
                  showVision
                />
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </Layout>
  );
}
