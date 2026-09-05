// 二维路由矩阵编辑器（任务等级 × 时间段）
// 用于 Cybertron 和 Hermes 配置页面共享
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Clock } from "lucide-react";
import { TIERS, TIER_LABELS, REASONING_LEVELS, WEEKDAY_LABELS, type RoutingConfig, type TimePeriod } from "./shared";

interface Props {
  config: RoutingConfig;
  onChange: (config: RoutingConfig) => void;
  availableModels: string[];
  showVision?: boolean;
}

export function MatrixEditor({ config, onChange, availableModels, showVision }: Props) {
  const [newPeriodName, setNewPeriodName] = useState("");

  const periods = config.time_periods || [];
  const periodNames = periods.map((p) => p.name);
  const allColumns = [...periodNames, "_default"];

  const updateCell = (tier: string, period: string, field: "model" | "reasoning" | "provider" | "base_url" | "api_key", value: string) => {
    const matrix = { ...config.matrix };
    matrix[tier] = { ...matrix[tier] };
    matrix[tier][period] = { ...matrix[tier][period], [field]: value };
    onChange({ ...config, matrix });
  };

  const addPeriod = () => {
    if (!newPeriodName.trim()) return;
    const period: TimePeriod = { name: newPeriodName.trim(), start: "09:00", end: "18:00", weekdays: [1, 2, 3, 4, 5] };
    const newPeriods = [...periods, period];
    // 为每个 tier 在新 period 下创建 cell
    const matrix = { ...config.matrix };
    for (const tier of TIERS) {
      matrix[tier] = { ...matrix[tier] };
      if (!matrix[tier][period.name]) {
        const defaultCell = matrix[tier]._default || { model: "", reasoning: "medium" };
        matrix[tier][period.name] = { ...defaultCell };
      }
    }
    onChange({ ...config, time_periods: newPeriods, matrix });
    setNewPeriodName("");
  };

  const removePeriod = (idx: number) => {
    const period = periods[idx];
    const newPeriods = periods.filter((_, i) => i !== idx);
    const matrix = { ...config.matrix };
    for (const tier of TIERS) {
      matrix[tier] = { ...matrix[tier] };
      delete matrix[tier][period.name];
    }
    onChange({ ...config, time_periods: newPeriods, matrix });
  };

  const updatePeriod = (idx: number, patch: Partial<TimePeriod>) => {
    const newPeriods = periods.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    onChange({ ...config, time_periods: newPeriods });
  };

  const toggleWeekday = (idx: number, day: number) => {
    const period = periods[idx];
    const days = period.weekdays || [];
    const newDays = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
    updatePeriod(idx, { weekdays: newDays });
  };

  const updateKeyword = (tier: "light" | "research", value: string) => {
    const keywords = value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    onChange({ ...config, keywords: { ...config.keywords, [tier]: keywords } });
  };

  return (
    <div className="space-y-4">
      {/* 路由开关 */}
      <div className="flex items-center gap-6 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer">
          <Switch checked={config.enabled} onCheckedChange={(v) => onChange({ ...config, enabled: v })} />
          <span className="text-sm font-medium">启用任务难度路由</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <Switch
            checked={config.time_routing_enabled}
            onCheckedChange={(v) => onChange({ ...config, time_routing_enabled: v })}
          />
          <span className="text-sm font-medium">启用时间维度路由</span>
        </label>
      </div>

{config.enabled ? (<>
      {/* 时段管理 */}
      {config.time_routing_enabled && (
        <Card className="p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Clock className="w-4 h-4" />
            时间段配置
          </div>
          <div className="space-y-2">
            {periods.map((p, idx) => (
              <div key={idx} className="flex items-center gap-2 flex-wrap text-sm">
                <Input
                  value={p.name}
                  onChange={(e) => updatePeriod(idx, { name: e.target.value })}
                  className="h-7 w-24"
                  placeholder="时段名"
                />
                <Input type="time" value={p.start} onChange={(e) => updatePeriod(idx, { start: e.target.value })} className="h-7 w-28" />
                <span className="text-muted-foreground">→</span>
                <Input type="time" value={p.end} onChange={(e) => updatePeriod(idx, { end: e.target.value })} className="h-7 w-28" />
                <div className="flex gap-0.5">
                  {WEEKDAY_LABELS.map((label, day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleWeekday(idx, day + 1)}
                      className={"w-6 h-6 rounded text-xs transition-colors " + ((p.weekdays || []).includes(day + 1) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="ghost" onClick={() => removePeriod(idx)} className="h-7 px-2">
                  <Trash2 className="w-3 h-3 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={newPeriodName}
              onChange={(e) => setNewPeriodName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addPeriod(); }}
              className="h-7 w-32"
              placeholder="新时段名"
            />
            <Button size="sm" variant="outline" onClick={addPeriod} className="h-7">
              <Plus className="w-3 h-3 mr-1" /> 添加时段
            </Button>
          </div>
        </Card>
      )}

      {/* 二维矩阵表 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left p-2 border border-border bg-muted/50 sticky left-0">任务等级 \ 时段</th>
              {config.time_routing_enabled &&
                periodNames.map((p) => (
                  <th key={p} className="p-2 border border-border bg-muted/50 text-center min-w-[180px]">
                    {p}
                  </th>
                ))}
              <th className="p-2 border border-border bg-muted/50 text-center min-w-[180px]">
                兜底 (_default)
              </th>
            </tr>
          </thead>
          <tbody>
            {TIERS.map((tier) => (
              <tr key={tier}>
                <td className="p-2 border border-border font-medium bg-muted/30 sticky left-0">
                  {TIER_LABELS[tier]}
                </td>
                {config.time_routing_enabled &&
                  periodNames.map((p) => (
                    <td key={p} className="p-1 border border-border">
                      <MatrixCellEditor
                        cell={config.matrix?.[tier]?.[p] || { model: "", reasoning: "medium" }}
                        models={availableModels}
                        onModelChange={(v) => updateCell(tier, p, "model", v)}
                        onReasoningChange={(v) => updateCell(tier, p, "reasoning", v)}
                        onProviderChange={(v) => updateCell(tier, p, "provider", v)}
                        onBaseUrlChange={(v) => updateCell(tier, p, "base_url", v)}
                        onApiKeyChange={(v) => updateCell(tier, p, "api_key", v)}
                      />
                    </td>
                  ))}
                <td className="p-1 border border-border">
                  <MatrixCellEditor
                    cell={config.matrix?.[tier]?._default || { model: "", reasoning: "medium" }}
                    models={availableModels}
                    onModelChange={(v) => updateCell(tier, "_default", "model", v)}
                    onReasoningChange={(v) => updateCell(tier, "_default", "reasoning", v)}
                    onProviderChange={(v) => updateCell(tier, "_default", "provider", v)}
                    onBaseUrlChange={(v) => updateCell(tier, "_default", "base_url", v)}
                    onApiKeyChange={(v) => updateCell(tier, "_default", "api_key", v)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 关键词编辑 */}
      <Card className="p-3 space-y-2">
        <div className="text-sm font-medium">任务分级关键词</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground">Light 关键词（逗号分隔）</label>
            <Input
              value={(config.keywords?.light || []).join(", ")}
              onChange={(e) => updateKeyword("light", e.target.value)}
              className="mt-1"
              placeholder="天气, 股价, 汇率, 是什么"
            />
            <div className="flex flex-wrap gap-1 mt-1">
              {(config.keywords?.light || []).map((kw, i) => (
                <Badge key={i} variant="secondary" className="text-xs">{kw}</Badge>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Research 关键词（逗号分隔）</label>
            <Input
              value={(config.keywords?.research || []).join(", ")}
              onChange={(e) => updateKeyword("research", e.target.value)}
              className="mt-1"
              placeholder="深度分析, 商业模式, 基本面"
            />
            <div className="flex flex-wrap gap-1 mt-1">
              {(config.keywords?.research || []).map((kw, i) => (
                <Badge key={i} variant="secondary" className="text-xs">{kw}</Badge>
              ))}
            </div>
          </div>
        </div>
      </Card>


      </>) : (
        <div className="rounded-md border border-muted-foreground/20 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          路由策略未启用，下方配置暂不生效。打开上方"启用任务难度路由"开关即可配置模型路由矩阵。
        </div>
      )}
      {/* 视觉模型配置（仅 Hermes） */}
      {showVision && config.vision && (
        <Card className="p-3 space-y-2">
          <div className="text-sm font-medium">视觉模型配置</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Provider</label>
              <Input
                value={config.vision.provider || ""}
                onChange={(e) => onChange({ ...config, vision: { ...config.vision!, provider: e.target.value } })}
                className="mt-1"
                placeholder="auto / openai / deepseek"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Model</label>
              <Input
                value={config.vision.model || ""}
                onChange={(e) => onChange({ ...config, vision: { ...config.vision!, model: e.target.value } })}
                className="mt-1"
                placeholder="视觉模型名"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Base URL</label>
              <Input
                value={config.vision.base_url || ""}
                onChange={(e) => onChange({ ...config, vision: { ...config.vision!, base_url: e.target.value } })}
                className="mt-1"
                placeholder="https://..."
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">API Key</label>
              <Input
                type="password"
                value={config.vision.api_key || ""}
                onChange={(e) => onChange({ ...config, vision: { ...config.vision!, api_key: e.target.value } })}
                className="mt-1"
                placeholder="sk-..."
              />
            </div>
          </div>
        </Card>
      )}

      {/* 兜底模型配置 */}
      <Card className="p-3 space-y-2">
        <div className="text-sm font-medium">兜底模型</div>
        <p className="text-xs text-muted-foreground">当主模型不可用（未续费、无法访问）时，自动回退到此模型。留空则不启用兜底。</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Model</label>
            <Input
              value={config.fallback?.model || ""}
              onChange={(e) => onChange({ ...config, fallback: { ...config.fallback!, model: e.target.value } })}
              className="mt-1"
              placeholder="deepseek-chat"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Provider</label>
            <Input
              value={config.fallback?.provider || ""}
              onChange={(e) => onChange({ ...config, fallback: { ...config.fallback!, provider: e.target.value } })}
              className="mt-1"
              placeholder="deepseek（留空=默认）"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Base URL</label>
            <Input
              value={config.fallback?.base_url || ""}
              onChange={(e) => onChange({ ...config, fallback: { ...config.fallback!, base_url: e.target.value } })}
              className="mt-1"
              placeholder="https://api.deepseek.com/v1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">API Key</label>
            <Input
              type="password"
              value={config.fallback?.api_key || ""}
              onChange={(e) => onChange({ ...config, fallback: { ...config.fallback!, api_key: e.target.value } })}
              className="mt-1"
              placeholder="留空=用默认 key"
            />
          </div>
        </div>
      </Card>
    </div>
  );
}

function MatrixCellEditor({
  cell,
  models,
  onModelChange,
  onReasoningChange,
  onProviderChange,
  onBaseUrlChange,
  onApiKeyChange,
}: {
  cell: { model: string; reasoning: string; provider?: string; base_url?: string; api_key?: string };
  models: string[];
  onModelChange: (v: string) => void;
  onReasoningChange: (v: string) => void;
  onProviderChange: (v: string) => void;
  onBaseUrlChange: (v: string) => void;
  onApiKeyChange: (v: string) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <div className="space-y-1">
      <Select value={cell.model} onValueChange={onModelChange}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder="选择模型" />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={cell.reasoning} onValueChange={onReasoningChange}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REASONING_LEVELS.map((r) => (
            <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={cell.provider || ""}
        onChange={(e) => onProviderChange(e.target.value)}
        className="h-7 text-xs"
        placeholder="厂商（留空=默认）"
      />
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        {showAdvanced ? "收起" : "跨厂商高级配置"}
      </button>
      {showAdvanced && (
        <div className="space-y-1">
          <Input
            value={cell.base_url || ""}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            className="h-7 text-xs"
            placeholder="Base URL（留空=自动）"
          />
          <Input
            type="password"
            value={cell.api_key || ""}
            onChange={(e) => onApiKeyChange(e.target.value)}
            className="h-7 text-xs"
            placeholder="API Key（留空=自动）"
          />
        </div>
      )}
    </div>
  );
}
