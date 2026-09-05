// PIRS 每周自动初筛配置页：开关 + 框架多选 + 试跑 + 历史
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Radar, Play, Save, Loader2 } from "lucide-react";
import InvestLayout from "./invest-layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  API, fmt, pct, cap, type Framework, type ScreenConfig, type ScreenRun,
  type ScreenRunResult, type Candidate, type StockMetrics,
} from "./shared";

const DOW_LABEL = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

interface CandidateRow {
  candidate: Candidate;
  metrics: StockMetrics | null;
}

export default function ScreeningPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  // 配置
  const { data: config, isLoading: cfgLoading } = useQuery<ScreenConfig>({
    queryKey: ["invest-screen-config"],
    queryFn: async () => {
      const res = await fetch(API + "/screen/config");
      if (!res.ok) throw new Error("Failed to fetch screen config");
      return res.json();
    },
  });

  // 框架列表（仅 isEnabled）
  const { data: frameworks = [] } = useQuery<Framework[]>({
    queryKey: ["invest-frameworks"],
    queryFn: async () => {
      const res = await fetch(API + "/frameworks");
      if (!res.ok) throw new Error("Failed to fetch frameworks");
      return res.json();
    },
  });
  const enabledFrameworks = frameworks.filter((f) => f.isEnabled);

  // 执行历史
  const { data: runs = [], isLoading: runsLoading } = useQuery<ScreenRun[]>({
    queryKey: ["invest-screen-runs"],
    queryFn: async () => {
      const res = await fetch(API + "/screen/runs?limit=20");
      if (!res.ok) throw new Error("Failed to fetch screen runs");
      return res.json();
    },
  });

  // 本地表单状态
  const [enabled, setEnabled] = useState(false);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [topN, setTopN] = useState(5);
  const [dayOfWeek, setDayOfWeek] = useState(0);

  useEffect(() => {
    if (config) {
      setEnabled(config.enabled);
      setPickedIds(config.frameworkIds || []);
      setTopN(config.topN);
      setDayOfWeek(config.dayOfWeek);
    }
  }, [config]);

  const toggleFw = (id: string) => {
    setPickedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // 保存配置
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(API + "/screen/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, frameworkIds: pickedIds, topN, dayOfWeek }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-screen-config"] });
      toast({ title: "初筛配置已保存" });
    },
    onError: (err: Error) => toast({ title: "保存失败", description: err.message, variant: "destructive" }),
  });

  // 立即试跑
  const [lastRun, setLastRun] = useState<ScreenRunResult | null>(null);
  const [pickedCandidates, setPickedCandidates] = useState<CandidateRow[]>([]);
  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(API + "/screen/run", { method: "POST" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "run failed");
      }
      return res.json() as Promise<ScreenRunResult>;
    },
    onSuccess: async (data) => {
      setLastRun(data);
      // 取候选池，匹配 picked codes 展示详情
      try {
        const res = await fetch(API + "/candidates");
        if (res.ok) {
          const rows = await res.json() as CandidateRow[];
          const set = new Set(data.picked);
          setPickedCandidates(rows.filter((r) => set.has(r.candidate.code)));
        }
      } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ["invest-screen-runs"] });
      qc.invalidateQueries({ queryKey: ["invest-candidates"] });
      qc.invalidateQueries({ queryKey: ["invest-overview"] });
      toast({ title: "初筛完成", description: "筛出 " + data.picked.length + " 支，已写入候选池" });
    },
    onError: (err: Error) => toast({ title: "试跑失败", description: err.message, variant: "destructive" }),
  });

  const dirty = config && (
    config.enabled !== enabled ||
    JSON.stringify(config.frameworkIds || []) !== JSON.stringify(pickedIds) ||
    config.topN !== topN ||
    config.dayOfWeek !== dayOfWeek
  );

  return (
    <InvestLayout>
      <div className="p-6 space-y-4 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Radar className="w-6 h-6 text-blue-500" />
            每周初筛
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            每周自动从全市场筛出 N 支写入候选池；排除过去 6 个月被否决过、已在资源池/候选池的股票
          </p>
        </div>

        {cfgLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Card className="p-5 space-y-5">
            {/* 启用开关 */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">启用每周自动初筛</div>
                <div className="text-xs text-muted-foreground">关闭后调度器不再自动执行</div>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {/* 框架多选 */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">初筛标准（勾选框架）</Label>
              <p className="text-xs text-muted-foreground">用所选框架的 systemPrompt 让 DeepSeek 按视角选股</p>
              {enabledFrameworks.length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">暂无启用的框架，请先到「框架」页创建并启用</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {enabledFrameworks.map((f) => {
                    const checked = pickedIds.includes(f.id);
                    return (
                      <label key={f.id} className="flex items-start gap-2 p-2 rounded-md border border-border hover:bg-accent/50 cursor-pointer">
                        <Checkbox checked={checked} onCheckedChange={() => toggleFw(f.id)} className="mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{f.name}</div>
                          <div className="text-xs text-muted-foreground line-clamp-1">{f.description || f.systemPrompt.slice(0, 60)}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* topN + dayOfWeek */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">每次筛几支</Label>
                <Input
                  type="number" min={1} max={20} value={topN}
                  onChange={(e) => setTopN(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">每周几执行</Label>
                <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOW_LABEL.map((label, i) => (
                      <SelectItem key={i} value={String(i)}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">下次执行</Label>
                <Input value={config?.nextRunDate || "—"} readOnly className="bg-muted/50" />
              </div>
            </div>

            {/* 操作 */}
            <div className="flex items-center gap-2 pt-1">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !dirty}>
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                保存配置
              </Button>
              <Button variant="outline" onClick={() => runMutation.mutate()} disabled={runMutation.isPending || pickedIds.length === 0}>
                {runMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                立即试跑
              </Button>
              {dirty && <span className="text-xs text-amber-600">有未保存改动</span>}
            </div>
          </Card>
        )}

        {/* 试跑结果 */}
        {lastRun && (
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">试跑结果</div>
              <Badge className="bg-blue-500/15 text-blue-600 border-0">
                粗筛池 {lastRun.poolSize} 支 → 命中 {lastRun.picked.length} 支
              </Badge>
            </div>
            {lastRun.summary && <p className="text-xs text-muted-foreground">{lastRun.summary}</p>}
            {pickedCandidates.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">已写入候选池，到「候选池」页查看</div>
            ) : (
              <div className="space-y-2">
                {pickedCandidates.map((r) => (
                  <div key={r.candidate.code} className="flex items-start justify-between p-2 rounded-md bg-muted/40">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{r.candidate.name} <span className="text-xs text-muted-foreground">{r.candidate.code}</span></div>
                      {r.candidate.reason && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{r.candidate.reason}</p>}
                    </div>
                    <div className="flex gap-2 text-xs text-muted-foreground shrink-0 ml-2">
                      <span>PE {fmt(r.candidate.peTtm ?? r.metrics?.peTtm)}</span>
                      <span>市值 {cap(r.candidate.marketCap ?? r.metrics?.marketCap)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* 执行历史 */}
        <Card className="p-5 space-y-3">
          <div className="font-medium">执行历史</div>
          {runsLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : runs.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">暂无执行记录</div>
          ) : (
            <div className="space-y-2">
              {runs.map((r) => (
                <div key={r.id} className="flex items-start justify-between p-2 rounded-md border border-border">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge className={(r.status === "ok" ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600") + " border-0"}>
                        {r.status === "ok" ? "成功" : "失败"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("zh-CN")}</span>
                      {r.poolSize !== null && <span className="text-xs text-muted-foreground">粗筛池 {r.poolSize}</span>}
                      {r.pickedCodes.length > 0 && <span className="text-xs text-muted-foreground">命中 {r.pickedCodes.length}</span>}
                    </div>
                    {r.summary && <p className="text-xs text-muted-foreground line-clamp-1 mt-1">{r.summary}</p>}
                    {r.error && <p className="text-xs text-red-500 line-clamp-2 mt-1">{r.error}</p>}
                    {r.pickedCodes.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {r.pickedCodes.map((c) => (
                          <span key={c} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{c}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </InvestLayout>
  );
}
