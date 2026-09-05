// 模型价格对比页
import { useState, useEffect, useCallback } from "react";
import Layout from "@/components/layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DollarSign, RefreshCw, Plus, X, Trophy, Rocket, Scale } from "lucide-react";
import { apiFetch, type ModelPrice, type ComparisonResult } from "./shared";

export default function PriceCompare() {
  const [allModels, setAllModels] = useState<ModelPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [comparing, setComparing] = useState(false);

  const loadModels = useCallback((refresh = false) => {
    setLoading(true);
    apiFetch<{ models: ModelPrice[] }>("/prices" + (refresh ? "?refresh=true" : ""))
      .then((d) => {
        setAllModels(d.models);
        if (refresh) toast.success("已刷新 " + d.models.length + " 个模型");
      })
      .catch(() => toast.error("加载价格失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadModels(); }, [loadModels]);

  const filtered = searchQuery
    ? allModels.filter((m) => m.id.toLowerCase().includes(searchQuery.toLowerCase()) || m.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 20)
    : [];

  const addModel = (id: string) => {
    if (!selected.includes(id)) setSelected([...selected, id]);
    setSearchQuery("");
  };

  const removeModel = (id: string) => setSelected(selected.filter((s) => s !== id));

  const compare = () => {
    if (selected.length < 2) {
      toast.error("至少选择 2 个模型进行对比");
      return;
    }
    setComparing(true);
    apiFetch<ComparisonResult>("/prices/compare", { method: "POST", body: JSON.stringify({ models: selected }) })
      .then(setComparison)
      .catch(() => toast.error("对比失败"))
      .finally(() => setComparing(false));
  };

  return (
    <Layout>
      <div className="h-full overflow-y-auto p-6 space-y-4 max-w-5xl">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-primary" />
            模型价格对比
          </h1>
          <Button variant="outline" size="sm" onClick={() => loadModels(true)} disabled={loading}>
            <RefreshCw className={"w-4 h-4 mr-1 " + (loading ? "animate-spin" : "")} />
            刷新
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          数据来源：OpenRouter API + 国产模型官方定价页（cn/ 前缀，2026-08-13 采集，DeepSeek 为 8/17 生效峰谷价）。共 {allModels.length} 个模型。单位：$ 或 ¥ / 百万 token。
        </p>

        {/* 搜索 + 添加 */}
        <Card className="p-3 space-y-2">
          <div className="flex gap-2">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索模型名（如 deepseek, gpt-4, claude）"
              onKeyDown={(e) => { if (e.key === "Enter" && filtered.length > 0) addModel(filtered[0].id); }}
            />
            <Button onClick={() => filtered.length > 0 && addModel(filtered[0].id)} disabled={!filtered.length}>
              <Plus className="w-4 h-4 mr-1" /> 添加
            </Button>
          </div>
          {filtered.length > 0 && (
            <div className="border rounded-md max-h-48 overflow-y-auto">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => addModel(m.id)}
                  className="w-full text-left px-3 py-1.5 hover:bg-muted/50 transition-colors flex items-center justify-between text-sm"
                >
                  <span className="font-mono">{m.id}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.currency === "CNY" ? "¥" + ((m.prompt_cny ?? 0) + (m.completion_cny ?? 0)).toFixed(1) + "/M" : "$" + ((m.prompt_price + m.completion_price) * 1_000_000).toFixed(2) + "/M"} · {m.context_length.toLocaleString()} ctx{m.source ? ` · ${m.source}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* 已选模型 */}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-muted-foreground">已选 {selected.length} 个：</span>
            {selected.map((id) => (
              <Badge key={id} variant="secondary" className="gap-1">
                {id}
                <button onClick={() => removeModel(id)}><X className="w-3 h-3" /></button>
              </Badge>
            ))}
            <Button size="sm" onClick={compare} disabled={comparing || selected.length < 2}>
              {comparing ? "对比中..." : "开始对比"}
            </Button>
          </div>
        )}

        {/* 对比结果 */}
        {comparison && comparison.comparison.length > 0 && (
          <>
            {/* 推荐卡片 */}
            {comparison.recommendations && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <RecommendationCard
                  icon={<Trophy className="w-5 h-5" />}
                  title="最便宜"
                  color="text-emerald-600"
                  model={comparison.recommendations.cheapest}
                  metric={comparison.recommendations.cheapest.currency === "CNY" ? "¥" + (comparison.recommendations.cheapest.total_cny_per_m ?? 0).toFixed(1) + "/M" : "$" + comparison.recommendations.cheapest.total_per_m.toFixed(2) + "/M"}
                />
                <RecommendationCard
                  icon={<Rocket className="w-5 h-5" />}
                  title="性能最优"
                  color="text-blue-600"
                  model={comparison.recommendations.best_performance}
                  metric={comparison.recommendations.best_performance.context_length.toLocaleString() + " ctx"}
                />
                <RecommendationCard
                  icon={<Scale className="w-5 h-5" />}
                  title="性价比最优"
                  color="text-amber-600"
                  model={comparison.recommendations.best_value}
                  metric={comparison.recommendations.best_value.cost_performance.toFixed(0) + " ctx/$"}
                />
              </div>
            )}

            {/* 对比表格 */}
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2">模型</th>
                      <th className="text-right p-2">输入 (/M tok)</th>
                      <th className="text-right p-2">输出 (/M tok)</th>
                      <th className="text-right p-2">合计 (/M tok)</th>
                      <th className="text-right p-2">上下文长度</th>
                      <th className="text-center p-2">模态</th>
                      <th className="text-center p-2">推理</th>
                      <th className="text-right p-2">性价比 (ctx/$)</th>
                      <th className="text-left p-2">来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.comparison.map((m) => {
                      const isCheapest = comparison.recommendations?.cheapest.id === m.id;
                      const isBestPerf = comparison.recommendations?.best_performance.id === m.id;
                      const isBestValue = comparison.recommendations?.best_value.id === m.id;
                      return (
                        <tr key={m.id} className="border-t border-border/50">
                          <td className="p-2 font-mono text-xs">
                            {m.id}
                            {isCheapest && <Badge className="ml-1 bg-emerald-500 text-xs">最便宜</Badge>}
                            {isBestPerf && <Badge className="ml-1 bg-blue-500 text-xs">性能最优</Badge>}
                            {isBestValue && <Badge className="ml-1 bg-amber-500 text-xs">性价比</Badge>}
                          </td>
                          <td className="p-2 text-right">{m.currency === "CNY" ? "¥" + (m.prompt_cny_per_m ?? 0).toFixed(2) : "$" + m.prompt_per_m.toFixed(2)}</td>
                          <td className="p-2 text-right">{m.currency === "CNY" ? "¥" + (m.completion_cny_per_m ?? 0).toFixed(2) : "$" + m.completion_per_m.toFixed(2)}</td>
                          <td className={"p-2 text-right font-medium " + (isCheapest ? "text-emerald-600" : "")}>{m.currency === "CNY" ? "¥" + (m.total_cny_per_m ?? 0).toFixed(2) : "$" + m.total_per_m.toFixed(2)}</td>
                          <td className={"p-2 text-right " + (isBestPerf ? "text-blue-600 font-medium" : "")}>{m.context_length.toLocaleString()}</td>
                          <td className="p-2 text-center text-xs">{(m.input_modalities || []).join(",")}</td>
                          <td className="p-2 text-center">{m.reasoning ? "✓" : "—"}</td>
                          <td className={"p-2 text-right " + (isBestValue ? "text-amber-600 font-medium" : "")}>{m.cost_performance.toFixed(0)}</td>
                          <td className="p-2 text-xs text-muted-foreground">{m.source || "OpenRouter"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}

function RecommendationCard({ icon, title, color, model, metric }: {
  icon: React.ReactNode;
  title: string;
  color: string;
  model: { id: string; name: string };
  metric: string;
}) {
  return (
    <Card className="p-4 space-y-1">
      <div className={"flex items-center gap-2 " + color}>
        {icon}
        <span className="font-medium">{title}</span>
      </div>
      <div className="text-sm font-mono">{model.id}</div>
      <div className={"text-lg font-bold " + color}>{metric}</div>
    </Card>
  );
}
