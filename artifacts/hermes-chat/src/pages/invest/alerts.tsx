// PIRS 预警：预警列表 + 预警规则管理
import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, BellOff, Plus, Trash2, Shield, Pencil } from "lucide-react";
import InvestLayout from "./invest-layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  API, LEVEL_COLOR, type Alert, type AlertRule, type WatchlistItem,
  ALERT_METRICS, ALERT_OPERATORS, ALERT_LEVELS,
} from "./shared";

const LEVEL_LABEL: Record<string, string> = { red: "高危", yellow: "关注", blue: "提示" };
const METRIC_LABEL: Record<string, string> = Object.fromEntries(ALERT_METRICS.map((m) => [m.key, m.label]));
const OP_LABEL: Record<string, string> = Object.fromEntries(ALERT_OPERATORS.map((o) => [o.key, o.label]));

export default function AlertsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"alerts" | "rules">("alerts");
  const [unreadFilter, setUnreadFilter] = useState<"unread" | "all">("unread");

  const { data: rows = [], isLoading } = useQuery<Alert[]>({
    queryKey: ["invest-alerts", unreadFilter],
    queryFn: async () => {
      const url = unreadFilter === "unread" ? `${API}/alerts?unread=1` : `${API}/alerts`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch alerts");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const readMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API}/alerts/${id}/read`, { method: "POST" });
      if (!res.ok) throw new Error("mark read failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-alerts"] });
      qc.invalidateQueries({ queryKey: ["invest-overview"] });
    },
  });

  const readAllMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(rows.filter(r => !r.isRead).map(r => fetch(`${API}/alerts/${r.id}/read`, { method: "POST" })));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-alerts"] });
      qc.invalidateQueries({ queryKey: ["invest-overview"] });
      toast({ title: "全部标记已读" });
    },
  });

  return (
    <InvestLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Bell className="w-6 h-6 text-red-500" /> 预警
            </h1>
            <p className="text-sm text-muted-foreground mt-1">候选池与资源池的持续监控信号，规则在同步指标时自动评估</p>
          </div>
          {tab === "alerts" && (
            <Button variant="outline" size="sm" onClick={() => readAllMutation.mutate()} disabled={readAllMutation.isPending || rows.every(r => r.isRead)}>
              <CheckCheck className="w-4 h-4" /> 全部已读
            </Button>
          )}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "alerts" | "rules")}>
          <TabsList>
            <TabsTrigger value="alerts">预警</TabsTrigger>
            <TabsTrigger value="rules">规则</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "alerts" ? (
          <>
            <Tabs value={unreadFilter} onValueChange={(v) => setUnreadFilter(v as "unread" | "all")}>
              <TabsList>
                <TabsTrigger value="unread">未读</TabsTrigger>
                <TabsTrigger value="all">全部</TabsTrigger>
              </TabsList>
            </Tabs>

            {isLoading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : rows.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
                <BellOff className="w-8 h-8 text-muted-foreground/50" />
                {unreadFilter === "unread" ? "没有未读预警" : "暂无预警"}
              </Card>
            ) : (
              <div className="space-y-2">
                {rows.map((a) => (
                  <Card key={a.id} className={"p-4 flex items-start gap-3 " + (a.isRead ? "opacity-60" : "")}>
                    <Badge variant="outline" className={"shrink-0 " + (LEVEL_COLOR[a.level] || LEVEL_COLOR.blue)}>
                      {LEVEL_LABEL[a.level] || a.level}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/invest/stocks/${a.code}`} className="font-mono text-sm text-primary hover:underline">{a.code}</Link>
                        {a.stockName && a.stockName !== a.code && <span className="text-sm font-medium text-foreground">{a.stockName}</span>}
                        <Badge variant="secondary" className="text-xs">{a.signalType}</Badge>
                        <span className="text-xs text-muted-foreground">{a.source}</span>
                      </div>
                      <div className="text-sm text-foreground mt-1">{a.description}</div>
                      <div className="text-xs text-muted-foreground mt-1">{new Date(a.createdAt).toLocaleString("zh-CN")}</div>
                    </div>
                    {!a.isRead && (
                      <Button variant="ghost" size="sm" onClick={() => readMutation.mutate(a.id)} className="shrink-0">
                        <CheckCheck className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </>
        ) : (
          <RulesManager />
        )}
      </div>
    </InvestLayout>
  );
}

// ── 规则管理 ──
interface RuleForm {
  code: string; metric: string; operator: string; threshold: string; level: string; note: string;
}
const EMPTY_RULE: RuleForm = { code: "", metric: "peTtm", operator: "gt", threshold: "", level: "yellow", note: "" };

function RulesManager() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_RULE);

  const { data: rules = [], isLoading } = useQuery<AlertRule[]>({
    queryKey: ["invest-alert-rules"],
    queryFn: async () => {
      const res = await fetch(`${API}/alert-rules`);
      if (!res.ok) throw new Error("Failed to fetch rules");
      return res.json();
    },
  });

  const { data: watchlist = [] } = useQuery<WatchlistItem[]>({
    queryKey: ["invest-watchlist"],
    queryFn: async () => {
      const res = await fetch(`${API}/watchlist`);
      if (!res.ok) return [];
      const rows = await res.json();
      return rows.map((r: { watchlist: WatchlistItem }) => r.watchlist);
    },
  });

  const openNew = () => { setEditing(null); setForm(EMPTY_RULE); setOpen(true); };
  const openEdit = (r: AlertRule) => {
    setEditing(r);
    setForm({ code: r.code, metric: r.metric, operator: r.operator, threshold: String(r.threshold), level: r.level, note: r.note || "" });
    setOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        code: form.code, metric: form.metric, operator: form.operator,
        threshold: Number(form.threshold), level: form.level, note: form.note || null,
      };
      if (editing) {
        const res = await fetch(`${API}/alert-rules/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error("update failed");
      } else {
        const res = await fetch(`${API}/alert-rules`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "create failed"); }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-alert-rules"] });
      setOpen(false);
      toast({ title: editing ? "规则已更新" : "规则已创建" });
    },
    onError: (err: Error) => toast({ title: "保存失败", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isEnabled }: { id: number; isEnabled: boolean }) => {
      const res = await fetch(`${API}/alert-rules/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isEnabled }) });
      if (!res.ok) throw new Error("toggle failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invest-alert-rules"] }),
  });

  const delMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API}/alert-rules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-alert-rules"] });
      toast({ title: "规则已删除" });
    },
  });

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">共 {rules.length} 条规则 · 同步指标时自动评估</p>
        <Button size="sm" onClick={openNew}><Plus className="w-4 h-4" /> 新建规则</Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : rules.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
          <Shield className="w-8 h-8 text-muted-foreground/50" />
            {"暂无预警规则。新建一条，比如「PE(TTM) > 60 触发关注」。"}
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>股票</TableHead>
                <TableHead>条件</TableHead>
                <TableHead>级别</TableHead>
                <TableHead>启用</TableHead>
                <TableHead>最近触发</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/invest/stocks/${r.code}`} className="font-mono text-sm text-primary hover:underline">{r.code}</Link>
                    {r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="text-muted-foreground">{METRIC_LABEL[r.metric] || r.metric}</span>{" "}
                    <span className="font-medium">{OP_LABEL[r.operator] || r.operator}</span>{" "}
                    <span className="font-medium text-foreground">{r.threshold}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={(LEVEL_COLOR[r.level] || LEVEL_COLOR.blue)}>{LEVEL_LABEL[r.level] || r.level}</Badge>
                  </TableCell>
                  <TableCell>
                    <Switch checked={r.isEnabled} onCheckedChange={(v) => toggleMutation.mutate({ id: r.id, isEnabled: v })} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.lastTriggeredAt ? new Date(r.lastTriggeredAt).toLocaleString("zh-CN") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { if (confirm("删除这条规则？")) delMutation.mutate(r.id); }}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "编辑规则" : "新建预警规则"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">股票代码 *</Label>
              {editing ? (
                <Input value={form.code} disabled />
              ) : (
                <Select value={form.code} onValueChange={(v) => setForm(s => ({ ...s, code: v }))}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="从资源池选择，或直接输入" /></SelectTrigger>
                  <SelectContent>
                    {watchlist.map((w) => (
                      <SelectItem key={w.code} value={w.code}>{w.code} · {w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {!editing && watchlist.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">资源池为空，请先添加股票或在个股详情页创建规则。</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">监控指标</Label>
                <Select value={form.metric} onValueChange={(v) => setForm(s => ({ ...s, metric: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALERT_METRICS.map((mtr) => (<SelectItem key={mtr.key} value={mtr.key}>{mtr.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">比较方式</Label>
                <Select value={form.operator} onValueChange={(v) => setForm(s => ({ ...s, operator: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALERT_OPERATORS.map((op) => (<SelectItem key={op.key} value={op.key}>{op.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">阈值 *</Label>
                <Input type="number" value={form.threshold} onChange={(e) => setForm(s => ({ ...s, threshold: e.target.value }))} placeholder="如 60" />
              </div>
              <div>
                <Label className="text-xs">级别</Label>
                <Select value={form.level} onValueChange={(v) => setForm(s => ({ ...s, level: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALERT_LEVELS.map((lv) => (<SelectItem key={lv.key} value={lv.key}>{lv.label}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">备注（可选）</Label>
              <Input value={form.note} onChange={(e) => setForm(s => ({ ...s, note: e.target.value }))} placeholder="如「破 60 倍减仓」" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.code || form.threshold === ""}>
              {saveMutation.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
