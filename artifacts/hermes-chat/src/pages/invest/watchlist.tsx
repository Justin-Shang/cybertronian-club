import { useState, useMemo } from "react";
import InvestLayout from "./invest-layout";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Star, Plus, RefreshCw, Trash2, ArrowUpRight, Target, Search, ArrowUpDown } from "lucide-react";
import { API, fmt, pct, cap, type WatchlistItem, type StockMetrics, type Framework } from "./shared";

interface WatchlistRow {
  watchlist: WatchlistItem;
  metrics: StockMetrics | null;
  valuation?: { pePercentile: number | null; pbPercentile: number | null } | null;
}

const SORT_OPTIONS: { key: string; label: string }[] = [
  { key: "updated", label: "最近更新" },
  { key: "peTtm", label: "PE(TTM)" },
  { key: "priceChangePct", label: "涨跌幅" },
  { key: "marketCap", label: "市值" },
  { key: "roe", label: "ROE" },
  { key: "price", label: "现价" },
  { key: "pePercentile", label: "PE分位" },
];

export default function WatchlistPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [code, setCode] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("updated");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // 加入候选池
  const [candOpen, setCandOpen] = useState(false);
  const [candTarget, setCandTarget] = useState<{ code: string; name: string } | null>(null);
  const [candForm, setCandForm] = useState({ score: "", frameworkId: "", reason: "" });

  const { data: rows = [], isLoading } = useQuery<WatchlistRow[]>({
    queryKey: ["invest-watchlist"],
    queryFn: async () => {
      const res = await fetch(API + "/watchlist");
      if (!res.ok) throw new Error("Failed to fetch watchlist");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: frameworks = [] } = useQuery<Framework[]>({
    queryKey: ["invest-frameworks"],
    queryFn: async () => {
      const res = await fetch(`${API}/frameworks`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  // 客户端搜索 + 排序
  const displayRows = useMemo(() => {
    let r = rows;
    const q = search.trim().toLowerCase();
    if (q) {
      r = r.filter(
        (x) => x.watchlist.code.toLowerCase().includes(q) || x.watchlist.name.toLowerCase().includes(q),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...r].sort((a, b) => {
      if (sortKey === "updated") {
        return (new Date(a.watchlist.updatedAt).getTime() - new Date(b.watchlist.updatedAt).getTime()) * dir;
      }
      // pePercentile 来自 valuation 字段，非 metrics
      const av = sortKey === "pePercentile"
        ? (a.valuation?.pePercentile ?? null)
        : (a.metrics?.[sortKey as keyof StockMetrics] ?? null);
      const bv = sortKey === "pePercentile"
        ? (b.valuation?.pePercentile ?? null)
        : (b.metrics?.[sortKey as keyof StockMetrics] ?? null);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;   // null 排最后
      if (bv === null) return -1;
      return ((av as number) - (bv as number)) * dir;
    });
    return sorted;
  }, [rows, search, sortKey, sortDir]);

  const addMutation = useMutation({
    mutationFn: async (c: string) => {
      const res = await fetch(API + "/watchlist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      if (!res.ok) throw new Error("Failed to add");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-watchlist"] });
      qc.invalidateQueries({ queryKey: ["invest-overview"] });
      setAddOpen(false); setCode("");
      toast({ title: "已加入资源池" });
    },
    onError: () => toast({ title: "添加失败", variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (c: string) => {
      const res = await fetch(API + "/watchlist/" + c, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-watchlist"] });
      qc.invalidateQueries({ queryKey: ["invest-overview"] });
      toast({ title: "已移出资源池" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (c: string) => {
      const res = await fetch(API + "/stocks/" + c + "/sync", { method: "POST" });
      if (!res.ok) throw new Error("sync failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-watchlist"] });
      qc.invalidateQueries({ queryKey: ["invest-alerts"] });
      toast({ title: "指标已同步" });
    },
    onError: () => toast({ title: "同步失败", variant: "destructive" }),
  });

  const syncAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(API + "/sync/watchlist", { method: "POST" });
      if (!res.ok) throw new Error("batch sync failed");
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["invest-watchlist"] });
      qc.invalidateQueries({ queryKey: ["invest-alerts"] });
      const ok = data.results?.filter((r: { ok: boolean }) => r.ok).length ?? 0;
      toast({ title: "批量同步完成", description: ok + "/" + data.total + " 成功" });
    },
    onError: () => toast({ title: "批量同步失败", variant: "destructive" }),
  });

  // 加入候选池
  const candidateMutation = useMutation({
    mutationFn: async () => {
      if (!candTarget) return;
      const res = await fetch(API + "/candidates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: candTarget.code, name: candTarget.name,
          score: candForm.score === "" ? null : Number(candForm.score),
          frameworkId: candForm.frameworkId || null,
          reason: candForm.reason || null,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "加入失败");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-candidates"] });
      qc.invalidateQueries({ queryKey: ["invest-overview"] });
      setCandOpen(false);
      setCandForm({ score: "", frameworkId: "", reason: "" });
      toast({ title: "已加入候选池" });
    },
    onError: (err: Error) => toast({ title: "加入失败", description: err.message, variant: "destructive" }),
  });

  // 切换持仓标记
  const toggleHoldingMutation = useMutation({
    mutationFn: async ({ code, isHolding }: { code: string; isHolding: boolean }) => {
      const res = await fetch(API + "/watchlist/" + code, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isHolding }),
      });
      if (!res.ok) throw new Error("Failed to toggle holding");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-watchlist"] });
    },
  });

  const openCandidate = (code: string, name: string) => {
    setCandTarget({ code, name });
    setCandForm({ score: "", frameworkId: "", reason: "" });
    setCandOpen(true);
  };

  return (
    <InvestLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Star className="w-6 h-6 text-blue-500" />
              资源池
            </h1>
            <p className="text-sm text-muted-foreground mt-1">长期跟踪的股票池，含实时指标与投研笔记</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => syncAllMutation.mutate()} disabled={syncAllMutation.isPending}>
              <RefreshCw className={"w-4 h-4 " + (syncAllMutation.isPending ? "animate-spin" : "")} />
              全部同步
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4" /> 添加
            </Button>
          </div>
        </div>

        {/* 搜索 + 排序 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="按代码 / 名称搜索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
            <Select value={sortKey} onValueChange={(v) => setSortKey(v)}>
              <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}>
              {sortDir === "asc" ? "↑ 升序" : "↓ 降序"}
            </Button>
          </div>
          <span className="text-xs text-muted-foreground ml-auto">{displayRows.length}/{rows.length} 只</span>
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>代码 / 名称</TableHead>
                <TableHead className="text-right">现价</TableHead>
                <TableHead className="text-right">PE(TTM)</TableHead>
                <TableHead className="text-right">PE分位</TableHead>
                <TableHead className="text-right">PB</TableHead>
                <TableHead className="text-right">ROE</TableHead>
                <TableHead className="text-right">毛利率</TableHead>
                <TableHead className="text-right">市值</TableHead>
                <TableHead>持仓</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">加载中…</TableCell></TableRow>
              ) : displayRows.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">{rows.length === 0 ? "资源池为空，点击「添加」加入股票" : "无匹配结果"}</TableCell></TableRow>
              ) : displayRows.map((r) => (
                <TableRow key={r.watchlist.code}>
                  <TableCell>
                    <Link href={"/invest/stocks/" + r.watchlist.code} className="hover:underline">
                      <div className="font-medium">{r.watchlist.code}</div>
                      <div className="text-xs text-muted-foreground">{r.watchlist.name}</div>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.metrics?.price)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.metrics?.peTtm)}</TableCell>
                  <TableCell className="text-right tabular-nums">{
                    r.valuation?.pePercentile !== null && r.valuation?.pePercentile !== undefined
                      ? (r.valuation.pePercentile >= 80
                          ? <span className="text-red-600 dark:text-red-400">{r.valuation.pePercentile.toFixed(1)}%</span>
                          : r.valuation.pePercentile <= 20
                            ? <span className="text-emerald-600 dark:text-emerald-400">{r.valuation.pePercentile.toFixed(1)}%</span>
                            : <span>{r.valuation.pePercentile.toFixed(1)}%</span>)
                      : "—"
                  }</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.metrics?.pb)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.metrics?.roe)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.metrics?.grossMargin)}</TableCell>
                  <TableCell className="text-right tabular-nums">{cap(r.metrics?.marketCap)}</TableCell>
                  <TableCell>
                    <button
                      onClick={() => toggleHoldingMutation.mutate({ code: r.watchlist.code, isHolding: !r.watchlist.isHolding })}
                      className={"inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border transition-colors " + (
                        r.watchlist.isHolding
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                          : "bg-muted text-muted-foreground border-transparent"
                      )}
                    >
                      {r.watchlist.isHolding ? "是" : "否"}
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{r.watchlist.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => syncMutation.mutate(r.watchlist.code)} title="同步指标">
                        <RefreshCw className={"w-3.5 h-3.5 " + (syncMutation.isPending ? "animate-spin" : "")} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openCandidate(r.watchlist.code, r.watchlist.name)} title="加入候选池">
                        <Target className="w-3.5 h-3.5 text-amber-500" />
                      </Button>
                      <Link href={"/invest/stocks/" + r.watchlist.code}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="详情">
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="移除">
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>移出资源池？</AlertDialogTitle>
                            <AlertDialogDescription>将 {r.watchlist.name}({r.watchlist.code}) 从资源池移除，笔记保留。</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={() => removeMutation.mutate(r.watchlist.code)}>移除</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>加入资源池</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">股票代码（6位）</label>
              <Input placeholder="如 600519" value={code} onChange={(e) => setCode(e.target.value.trim())} />
              <p className="text-xs text-muted-foreground mt-1">添加后自动通过 akshare 同步指标</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
            <Button onClick={() => addMutation.mutate(code)} disabled={!code.trim() || addMutation.isPending}>
              {addMutation.isPending ? "同步中…" : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 加入候选池 Dialog */}
      <Dialog open={candOpen} onOpenChange={setCandOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>加入候选池 · {candTarget?.code}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">评分（0-100，可选）</Label>
              <Input type="number" min={0} max={100} value={candForm.score} onChange={(e) => setCandForm(s => ({ ...s, score: e.target.value }))} placeholder="如 75" />
            </div>
            <div>
              <Label className="text-xs">分析框架</Label>
              <Select value={candForm.frameworkId} onValueChange={(v) => setCandForm(s => ({ ...s, frameworkId: v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="不关联框架" /></SelectTrigger>
                <SelectContent>
                  {frameworks.filter(f => f.isEnabled).map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">入选理由</Label>
              <Textarea className="min-h-[80px]" value={candForm.reason} onChange={(e) => setCandForm(s => ({ ...s, reason: e.target.value }))} placeholder="为什么把它放进候选池？" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCandOpen(false)}>取消</Button>
            <Button onClick={() => candidateMutation.mutate()} disabled={candidateMutation.isPending}>
              {candidateMutation.isPending ? "加入中…" : "加入候选池"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </InvestLayout>
  );
}
