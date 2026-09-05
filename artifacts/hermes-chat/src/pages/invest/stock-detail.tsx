// PIRS 股票详情：指标卡片 + 估值分位 + 投研笔记(含审计) + 牛熊辩论 + 5 数据源扩展
import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, RefreshCw, BookOpen, TrendingUp, Plus, Bell, Trash2,
  Scale, FileSearch, AlertCircle, CheckCircle2, AlertTriangle, Loader2,
  ClipboardList, Newspaper, Megaphone, Wallet, Lock, Users,
  ClipboardCheck, TrendingDown, Plus as PlusIcon,
} from "lucide-react";
import InvestLayout from "./invest-layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table as UITable, TableBody as UITableBody, TableCell as UITableCell,
  TableHead as UITableHead, TableHeader as UITableHeader, TableRow as UIRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  API, fmt, pct, pctile, cap,
  type StockMetrics, type InvestNote, type Framework,
  type Valuation, type AuditResult, type Debate, type ExtraData,
  type Trade, type TradeSummary, type Review,
  TRADE_SOURCES,
  ALERT_METRICS, ALERT_OPERATORS, ALERT_LEVELS,
} from "./shared";

interface StockDetail {
  code: string;
  name: string;
  market: string;
  industry: string;
  sector: string;
  isSt: boolean;
  updatedAt: string;
  metrics: StockMetrics | null;
  notes: InvestNote[];
}

const AUTHOR_COLOR: Record<string, string> = {
  agent: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  workflow: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  user: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
};

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-3 py-2 rounded-lg border border-border bg-card">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-foreground leading-tight">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

// 估值分位区块（P0-1）
function ValuationBlock({ code }: { code: string }) {
  const { data, isLoading, refetch, isFetching } = useQuery<Valuation>({
    queryKey: ["invest-valuation", code],
    queryFn: async () => {
      const res = await fetch(`${API}/stocks/${code}/valuation`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "估值数据获取失败");
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 分钟内不重复请求
  });

  if (isLoading) return <Skeleton className="h-32" />;
  if (!data) return null;

  const peLevel = data.pePercentile === null ? null
    : data.pePercentile >= 80 ? "偏高"
    : data.pePercentile <= 20 ? "偏低" : "中性";
  const peColor = peLevel === "偏高" ? "text-red-600 dark:text-red-400"
    : peLevel === "偏低" ? "text-emerald-600 dark:text-emerald-400"
    : "text-amber-600 dark:text-amber-400";

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" /> 估值历史分位（近5年）
        </h3>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "w-3 h-3 animate-spin" : "w-3 h-3"} />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-0.5">
          <div className="text-xs text-muted-foreground">PE (TTM)</div>
          <div className="text-xl font-bold leading-tight">{fmt(data.peTtm)}x</div>
          {data.pePercentile !== null ? (
            <>
              <div className={`text-sm font-medium ${peColor}`}>
                {pctile(data.pePercentile)} 分位 · {peLevel}
              </div>
              {data.peBand && (
                <div className="text-xs text-muted-foreground">
                  区间 {data.peBand.min} ~ {data.peBand.max}
                  <span className="ml-1">P50 {data.peBand.p50}</span>
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-muted-foreground">数据不足</div>
          )}
        </div>
        <div className="space-y-0.5">
          <div className="text-xs text-muted-foreground">PB</div>
          <div className="text-xl font-bold leading-tight">{fmt(data.pb)}x</div>
          {data.pbPercentile !== null ? (
            <>
              <div className="text-sm font-medium">
                {pctile(data.pbPercentile)} 分位
              </div>
              {data.pbBand && (
                <div className="text-xs text-muted-foreground">
                  区间 {data.pbBand.min} ~ {data.pbBand.max}
                  <span className="ml-1">P50 {data.pbBand.p50}</span>
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-muted-foreground">数据不足</div>
          )}
        </div>
      </div>
    </Card>
  );
}

// 反思审计卡片（P0-2）
function AuditCard({ noteId, audit }: { noteId: number; audit: AuditResult | null | undefined }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const reflectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/notes/${noteId}/reflect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "审计失败");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-stock"] });
      qc.invalidateQueries({ queryKey: ["invest-notes"] });
      toast({ title: "反思审计完成" });
    },
    onError: (err: Error) => toast({ title: "审计失败", description: err.message, variant: "destructive" }),
  });

  if (!audit) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => reflectMutation.mutate()}
        disabled={reflectMutation.isPending}
        className="mt-2"
      >
        <ClipboardList className="w-3 h-3 mr-1" />
        {reflectMutation.isPending ? "审计中…" : "跑反思审计"}
      </Button>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <ClipboardList className="w-3 h-3" />
          {expanded ? "收起审计" : "查看反思审计"}
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => reflectMutation.mutate()}
          disabled={reflectMutation.isPending}
          className="h-6 text-xs"
        >
          {reflectMutation.isPending ? "重审中…" : "重新审计"}
        </Button>
      </div>
      {expanded && (
        <div className="space-y-2 pt-2">
          {audit.supported.length > 0 && (
            <div className="p-2 rounded-md bg-emerald-500/10 border border-emerald-500/20">
              <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mb-1 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> 有数据支撑（{audit.supported.length}）
              </div>
              {audit.supported.map((s, i) => (
                <div key={i} className="text-xs text-foreground mt-1">
                  <span className="text-muted-foreground">·</span> {s.claim}
                  <span className="text-muted-foreground"> → {s.evidence}</span>
                </div>
              ))}
            </div>
          )}
          {audit.unsupported.length > 0 && (
            <div className="p-2 rounded-md bg-amber-500/10 border border-amber-500/20">
              <div className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> 缺乏数据支撑（{audit.unsupported.length}）
              </div>
              {audit.unsupported.map((s, i) => (
                <div key={i} className="text-xs text-foreground mt-1">
                  <span className="text-muted-foreground">·</span> {s.claim}
                  <span className="text-muted-foreground"> → 缺 {s.reason}</span>
                </div>
              ))}
            </div>
          )}
          {audit.dataIssues.length > 0 && (
            <div className="p-2 rounded-md bg-red-500/10 border border-red-500/20">
              <div className="text-xs font-medium text-red-700 dark:text-red-300 mb-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> 数据使用问题（{audit.dataIssues.length}）
              </div>
              {audit.dataIssues.map((s, i) => (
                <div key={i} className="text-xs text-foreground mt-1">
                  <span className="text-muted-foreground">·</span> {s.issue}
                </div>
              ))}
            </div>
          )}
          {audit.weakestLink && (
            <div className="p-2 rounded-md bg-orange-500/10 border border-orange-500/20">
              <div className="text-xs font-medium text-orange-700 dark:text-orange-300 mb-1">
                ⚠️ 最脆弱一环
              </div>
              <div className="text-xs text-foreground">{audit.weakestLink}</div>
            </div>
          )}
          {audit.verifyChecklist.length > 0 && (
            <div className="p-2 rounded-md bg-blue-500/10 border border-blue-500/20">
              <div className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1 flex items-center gap-1">
                <FileSearch className="w-3 h-3" /> 验证清单（{audit.verifyChecklist.length}）
              </div>
              <ul className="text-xs text-foreground mt-1 space-y-0.5 list-disc list-inside">
                {audit.verifyChecklist.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NoteCard({ note, onDelete }: { note: InvestNote; onDelete: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-border rounded-lg p-4 bg-card hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {note.title && <div className="font-medium text-foreground truncate">{note.title}</div>}
          <div className="text-sm text-foreground mt-0.5">{note.conclusion}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {note.frameworkId && <Badge variant="outline" className="text-xs">{note.frameworkId}</Badge>}
          <Badge variant="outline" className={"text-xs " + (AUTHOR_COLOR[note.author] || "")}>{note.author}</Badge>
          {note.audit && <Badge className="text-xs bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 border">已审计</Badge>}
          {note.author === "user" && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDelete(note.id)}>
              <Trash2 className="w-3 h-3 text-destructive" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
        <span>{note.agentName || note.author} · {new Date(note.createdAt).toLocaleString("zh-CN")}</span>
        <button onClick={() => setExpanded(v => !v)} className="text-primary hover:underline">
          {expanded ? "收起" : "展开"}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {note.content}
          </div>
          <AuditCard noteId={note.id} audit={note.audit} />
        </div>
      )}
    </div>
  );
}

// 牛熊辩论 Tab（P1-1）
function DebateTab({ code }: { code: string }) {
  const { toast } = useToast();
  const [debate, setDebate] = useState<Debate | null>(null);

  const { data: debates = [], refetch } = useQuery<Debate[]>({
    queryKey: ["invest-debates", code],
    queryFn: async () => {
      const res = await fetch(`${API}/stocks/${code}/debates`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const debateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/stocks/${code}/debate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "辩论失败");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setDebate(data);
      refetch();
      toast({ title: "牛熊辩论完成" });
    },
    onError: (err: Error) => toast({ title: "辩论失败", description: err.message, variant: "destructive" }),
  });

  const current = debate || debates[0];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {debates.length > 0 ? `历史 ${debates.length} 场辩论` : "暂无辩论记录"}
        </div>
        <Button
          size="sm"
          onClick={() => debateMutation.mutate()}
          disabled={debateMutation.isPending}
        >
          <Scale className="w-4 h-4" />
          {debateMutation.isPending ? "辩论中…" : "发起牛熊辩论"}
        </Button>
      </div>

      {current ? (
        <>
          {/* 事实底稿 */}
          <Card className="p-3">
            <div className="text-sm font-semibold text-muted-foreground mb-2">事实底稿（13 项）</div>
            <div className="grid grid-cols-3 md:grid-cols-4 gap-2 text-xs">
              <div>PE: {fmt(current.dossier.valuation.peTtm)}x</div>
              <div>PE分位: {pctile(current.dossier.valuation.pePercentile)}</div>
              <div>PB: {fmt(current.dossier.valuation.pb)}x</div>
              <div>PB分位: {pctile(current.dossier.valuation.pbPercentile)}</div>
              {Object.entries(current.dossier.metrics).slice(0, 8).map(([k, v]) => (
                <div key={k}>{k}: {typeof v === "number" ? fmt(v, 4) : "—"}</div>
              ))}
            </div>
          </Card>

          {/* 多方 / 空方立论 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="p-3 bg-emerald-500/5 border-emerald-500/20">
              <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 mb-2 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" /> 多方立论
              </div>
              <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {current.bullCase}
              </div>
            </Card>
            <Card className="p-3 bg-red-500/5 border-red-500/20">
              <div className="text-sm font-semibold text-red-700 dark:text-red-300 mb-2 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> 空方立论
              </div>
              <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {current.bearCase}
              </div>
            </Card>
          </div>

          {/* 分歧清单 */}
          {current.disagreements.length > 0 && (
            <Card className="p-3">
              <div className="text-sm font-semibold text-muted-foreground mb-2">
                分歧清单（{current.disagreements.length}）
              </div>
              <div className="space-y-2.5">
                {current.disagreements.map((d, i) => (
                  <div key={i} className="text-sm">
                    <div className="font-medium text-foreground">{i + 1}. {d.issue}</div>
                    <div className="mt-0.5 text-emerald-700 dark:text-emerald-300">↗ 多: {d.bullView}</div>
                    <div className="text-red-700 dark:text-red-300">↘ 空: {d.bearView}</div>
                    <div className="text-muted-foreground">数据: {d.evidence}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 验证路径 */}
          {current.verifyPaths.length > 0 && (
            <Card className="p-3 bg-blue-500/5 border-blue-500/20">
              <div className="text-sm font-semibold text-blue-700 dark:text-blue-300 mb-2 flex items-center gap-1">
                <FileSearch className="w-3.5 h-3.5" /> 验证路径（{current.verifyPaths.length}）
              </div>
              <ul className="text-sm text-foreground space-y-1 list-disc list-inside">
                {current.verifyPaths.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </Card>
          )}

          <div className="text-xs text-muted-foreground">
            {new Date(current.createdAt).toLocaleString("zh-CN")}
          </div>
        </>
      ) : (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          点击「发起牛熊辩论」生成多空对抗分析
        </Card>
      )}
    </div>
  );
}

// 5 个扩展数据源（P1-2）
function ExtraDataTab({ code }: { code: string }) {
  const { data, isLoading, refetch, isFetching } = useQuery<ExtraData>({
    queryKey: ["invest-extra", code],
    queryFn: async () => {
      const res = await fetch(`${API}/stocks/${code}/extra-data`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "扩展数据获取失败");
      }
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) return <Skeleton className="h-40" />;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "w-3 h-3 animate-spin" : "w-3 h-3"} /> 刷新
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 研报 */}
        <Card className="p-3">
          <div className="text-sm font-semibold flex items-center gap-1 mb-2">
            <Newspaper className="w-3 h-3 text-primary" /> 近期研报（{data.research_reports.length}）
          </div>
          {data.research_reports.length === 0 ? (
            <EmptyOrDegraded source="research_reports" degraded={data._degraded} />
          ) : (
            <div className="space-y-1.5">
              {data.research_reports.map((r, i) => (
                <div key={i} className="text-sm">
                  <div className="text-foreground">{r.title}</div>
                  <div className="text-muted-foreground">
                    {r.org} · {r.rating || "—"} · EPS {fmt(r.epsForecast)} · PE {fmt(r.peForecast)} · {r.date || "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 公告 */}
        <Card className="p-3">
          <div className="text-sm font-semibold flex items-center gap-1 mb-2">
            <Megaphone className="w-3 h-3 text-amber-500" /> 重要公告（{data.announcements.length}）
          </div>
          {data.announcements.length === 0 ? (
            <EmptyOrDegraded source="announcements" degraded={data._degraded} />
          ) : (
            <div className="space-y-1.5">
              {data.announcements.map((a, i) => (
                <div key={i} className="text-sm">
                  <div className="text-foreground">{a.title}</div>
                  <div className="text-muted-foreground">{a.date}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 两融 */}
        <Card className="p-3">
          <div className="text-sm font-semibold flex items-center gap-1 mb-2">
            <Wallet className="w-3 h-3 text-blue-500" /> 融资融券
          </div>
          {Object.keys(data.margin).length === 0 ? (
            <EmptyOrDegraded source="margin" degraded={data._degraded} />
          ) : (
            <div className="text-sm space-y-1">
              <div>日期: {String(data.margin.date || "—")}</div>
              <div>融资余额: {fmt(data.margin.financeBalance as number, 0)} 元</div>
              <div>融资买入: {fmt(data.margin.financeBuy as number, 0)} 元</div>
              {data.margin.securitiesBalance !== undefined && (
                <div>融券余额: {fmt(data.margin.securitiesBalance as number, 0)} 元</div>
              )}
              <div className="text-muted-foreground">来源: {String(data.margin.source || "—")}</div>
            </div>
          )}
        </Card>

        {/* 解禁 */}
        <Card className="p-3">
          <div className="text-sm font-semibold flex items-center gap-1 mb-2">
            <Lock className="w-3 h-3 text-red-500" /> 解禁日程
          </div>
          {data.lockup.length === 0 ? (
            <EmptyOrDegraded source="lockup" degraded={data._degraded} />
          ) : (
            <div className="space-y-1.5">
              {data.lockup.map((l, i) => (
                <div key={i} className="text-sm">
                  <div className="text-foreground">{l.date}</div>
                  <div className="text-muted-foreground">
                    {l.note || `家数 ${fmt(l.marketCount, 0)} · 市值 ${fmt(l.marketValue, 0)} 元`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 股东户数 */}
        <Card className="p-3 md:col-span-2">
          <div className="text-sm font-semibold flex items-center gap-1 mb-2">
            <Users className="w-3 h-3 text-violet-500" /> 股东户数变化（{data.holders.length}）
          </div>
          {data.holders.length === 0 ? (
            <EmptyOrDegraded source="holders" degraded={data._degraded} />
          ) : (
            <div className="overflow-x-auto">
              <table className="text-sm w-full">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left py-1.5 px-2">截止日</th>
                    <th className="text-right py-1.5 px-2">户数</th>
                    <th className="text-right py-1.5 px-2">环比</th>
                    <th className="text-right py-1.5 px-2">户均持股</th>
                    <th className="text-right py-1.5 px-2">户均市值</th>
                  </tr>
                </thead>
                <tbody>
                  {data.holders.map((h, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1.5 px-2">{h.date || "—"}</td>
                      <td className="text-right py-1.5 px-2">{fmt(h.holders, 0)}</td>
                      <td className="text-right py-1.5 px-2">
                        {h.change === null ? "—" : (
                          <span className={h.change >= 0 ? "text-red-500" : "text-emerald-500"}>
                            {h.change >= 0 ? "+" : ""}{fmt(h.change)}%
                          </span>
                        )}
                      </td>
                      <td className="text-right py-1.5 px-2">{fmt(h.avgHold, 0)}</td>
                      <td className="text-right py-1.5 px-2">{fmt(h.avgValue, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function EmptyOrDegraded({ source, degraded }: { source: string; degraded: Array<{ source: string; reason: string }> }) {
  const d = degraded.find((x) => x.source === source);
  if (d) {
    return <div className="text-xs text-amber-600 dark:text-amber-400">数据源降级：{d.reason}</div>;
  }
  return <div className="text-xs text-muted-foreground">暂无数据</div>;
}

// ──────────────── 交易记录 Tab ────────────────
function TradesTab({ code }: { code: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ type: "buy", quantity: "", price: "", tradedAt: "", note: "", decision: "", source: "manual" });

  const { data: trades = [], isLoading } = useQuery<Trade[]>({
    queryKey: ["invest-trades", code],
    queryFn: async () => {
      const res = await fetch(API + "/stocks/" + code + "/trades");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: summary } = useQuery<TradeSummary>({
    queryKey: ["invest-trades-summary", code],
    queryFn: async () => {
      const res = await fetch(API + "/stocks/" + code + "/trades/summary");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(API + "/stocks/" + code + "/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: form.type,
          quantity: Number(form.quantity),
          price: Number(form.price),
          tradedAt: form.tradedAt || undefined,
          note: form.note || undefined,
          decision: form.decision || undefined,
          source: form.source || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-trades", code] });
      qc.invalidateQueries({ queryKey: ["invest-trades-summary", code] });
      setAddOpen(false);
      setForm({ type: "buy", quantity: "", price: "", tradedAt: "", note: "", decision: "", source: "manual" });
      toast({ title: "交易已记录" });
    },
    onError: () => toast({ title: "添加失败", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(API + "/stocks/" + code + "/trades/" + id, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-trades", code] });
      qc.invalidateQueries({ queryKey: ["invest-trades-summary", code] });
      toast({ title: "已删除" });
    },
  });

  const pnlColor = (v: number | null) => {
    if (v === null) return "text-muted-foreground";
    return v >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  };

  return (
    <div className="space-y-4">
      {/* 盈亏汇总 */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="px-3 py-2 rounded-lg border border-border bg-card">
            <div className="text-[11px] text-muted-foreground">持仓数量</div>
            <div className="mt-0.5 text-lg font-semibold">{summary.netQty}</div>
          </div>
          <div className="px-3 py-2 rounded-lg border border-border bg-card">
            <div className="text-[11px] text-muted-foreground">平均成本</div>
            <div className="mt-0.5 text-lg font-semibold">{summary.avgCost.toFixed(2)}</div>
          </div>
          <div className="px-3 py-2 rounded-lg border border-border bg-card">
            <div className="text-[11px] text-muted-foreground">现价</div>
            <div className="mt-0.5 text-lg font-semibold">{fmt(summary.currentPrice)}</div>
          </div>
          <div className="px-3 py-2 rounded-lg border border-border bg-card">
            <div className="text-[11px] text-muted-foreground">已实现盈亏</div>
            <div className={"mt-0.5 text-lg font-semibold " + pnlColor(summary.realizedPnl)}>
              {summary.realizedPnl >= 0 ? "+" : ""}{summary.realizedPnl.toFixed(2)}
            </div>
          </div>
          <div className="px-3 py-2 rounded-lg border border-border bg-card">
            <div className="text-[11px] text-muted-foreground">浮动盈亏</div>
            <div className={"mt-0.5 text-lg font-semibold " + pnlColor(summary.unrealizedPnl)}>
              {summary.unrealizedPnl !== null
                ? (summary.unrealizedPnl >= 0 ? "+" : "") + summary.unrealizedPnl.toFixed(2) + " (" + (summary.unrealizedPnlPct ?? 0).toFixed(1) + "%)"
                : "—"}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Wallet className="w-5 h-5 text-blue-500" /> 交易记录
        </h2>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4" /> 记录交易
        </Button>
      </div>

      <Card>
        <UITable>
          <UITableHeader>
            <UIRow>
              <UITableHead>时间</UITableHead>
              <UITableHead>类型</UITableHead>
              <UITableHead className="text-right">数量</UITableHead>
              <UITableHead className="text-right">价格</UITableHead>
              <UITableHead className="text-right">金额</UITableHead>
              <UITableHead>买入逻辑</UITableHead>
              <UITableHead>来源</UITableHead>
              <UITableHead>备注</UITableHead>
              <UITableHead className="text-right">操作</UITableHead>
            </UIRow>
          </UITableHeader>
          <UITableBody>
            {isLoading ? (
              <UIRow><UITableCell colSpan={9} className="text-center text-muted-foreground py-8">加载中…</UITableCell></UIRow>
            ) : trades.length === 0 ? (
              <UIRow><UITableCell colSpan={9} className="text-center text-muted-foreground py-8">暂无交易记录</UITableCell></UIRow>
            ) : trades.map((t) => (
              <UIRow key={t.id}>
                <UITableCell className="text-xs">{new Date(t.tradedAt).toLocaleDateString("zh-CN")}</UITableCell>
                <UITableCell>
                  <Badge variant="outline" className={"text-xs " + (t.type === "buy" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                    {t.type === "buy" ? "买入" : "卖出"}
                  </Badge>
                </UITableCell>
                <UITableCell className="text-right tabular-nums">{t.quantity}</UITableCell>
                <UITableCell className="text-right tabular-nums">{t.price.toFixed(2)}</UITableCell>
                <UITableCell className="text-right tabular-nums">{(t.quantity * t.price).toFixed(2)}</UITableCell>
                <UITableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={t.decision || ""}>{t.decision || "—"}</UITableCell>
                <UITableCell>
                  <Badge variant="outline" className="text-xs">{TRADE_SOURCES.find(s => s.key === t.source)?.label || t.source}</Badge>
                </UITableCell>
                <UITableCell className="text-xs text-muted-foreground">{t.note || "—"}</UITableCell>
                <UITableCell className="text-right">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteMutation.mutate(t.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </UITableCell>
              </UIRow>
            ))}
          </UITableBody>
        </UITable>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>记录交易 · {code}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">交易类型</Label>
                <Select value={form.type} onValueChange={(v) => setForm(s => ({ ...s, type: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">买入</SelectItem>
                    <SelectItem value="sell">卖出</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">交易时间</Label>
                <Input type="date" value={form.tradedAt} onChange={(e) => setForm(s => ({ ...s, tradedAt: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">数量</Label>
                <Input type="number" value={form.quantity} onChange={(e) => setForm(s => ({ ...s, quantity: e.target.value }))} placeholder="如 100" />
              </div>
              <div>
                <Label className="text-xs">价格</Label>
                <Input type="number" step="0.01" value={form.price} onChange={(e) => setForm(s => ({ ...s, price: e.target.value }))} placeholder="如 10.50" />
              </div>
            </div>
            <div>
              <Label className="text-xs">备注（可选）</Label>
              <Input value={form.note} onChange={(e) => setForm(s => ({ ...s, note: e.target.value }))} placeholder="如 建仓" />
            </div>
            <div>
              <Label className="text-xs">买入逻辑 / 决策摘要（可选）</Label>
              <Textarea className="min-h-[60px]" value={form.decision} onChange={(e) => setForm(s => ({ ...s, decision: e.target.value }))} placeholder="当时为什么买？复盘时对照" />
            </div>
            <div>
              <Label className="text-xs">来源</Label>
              <Select value={form.source} onValueChange={(v) => setForm(s => ({ ...s, source: v }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRADE_SOURCES.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
            <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !form.quantity || !form.price}>
              {addMutation.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ──────────────── 复盘 Tab ────────────────
function ReviewTab({ code, stockName }: { code: string; stockName: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: reviews = [], isLoading } = useQuery<Review[]>({
    queryKey: ["invest-reviews", code],
    queryFn: async () => {
      const res = await fetch(API + "/stocks/" + code + "/reviews");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(API + "/stocks/" + code + "/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "生成失败");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-reviews", code] });
      toast({ title: "复盘已生成" });
    },
    onError: (err: Error) => toast({ title: "复盘失败", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-violet-500" /> 复盘
        </h2>
        <Button size="sm" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
          {generateMutation.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> 生成中…</>
          ) : (
            <><ClipboardCheck className="w-4 h-4" /> 立即复盘</>
          )}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        结合交易记录、基本面指标变化、估值分位，由 DeepSeek 生成结构化复盘报告
      </p>

      {isLoading ? (
        <Card className="p-8 text-center text-muted-foreground text-sm">加载中…</Card>
      ) : reviews.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          暂无复盘记录。点击「立即复盘」生成。
        </Card>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <Card key={r.id} className="p-4">
              {r.summary && (
                <div className="text-sm font-medium text-primary mb-2 pb-2 border-b border-border">
                  {r.summary}
                </div>
              )}
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed whitespace-pre-wrap">
                {r.content}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleString("zh-CN")}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StockDetailPage() {
  const params = useParams<{ code: string }>();
  const code = params.code ?? "";
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery<StockDetail>({
    queryKey: ["invest-stock", code],
    queryFn: async () => {
      const res = await fetch(`${API}/stocks/${code}`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Failed to fetch stock");
      }
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

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/stocks/${code}/sync`, { method: "POST" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "sync failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-stock", code] });
      qc.invalidateQueries({ queryKey: ["invest-valuation", code] });
      qc.invalidateQueries({ queryKey: ["invest-watchlist"] });
      qc.invalidateQueries({ queryKey: ["invest-overview"] });
      qc.invalidateQueries({ queryKey: ["invest-alerts"] });
      toast({ title: "指标已同步" });
    },
    onError: (err: Error) => toast({ title: "同步失败", description: err.message, variant: "destructive" }),
  });

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteForm, setNoteForm] = useState({ title: "", conclusion: "", content: "", frameworkId: "" });
  const noteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code, title: noteForm.title || null, conclusion: noteForm.conclusion,
          content: noteForm.content || noteForm.conclusion, frameworkId: noteForm.frameworkId || null,
          author: "user",
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "保存失败");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-stock", code] });
      qc.invalidateQueries({ queryKey: ["invest-notes"] });
      qc.invalidateQueries({ queryKey: ["invest-overview"] });
      setNoteOpen(false);
      setNoteForm({ title: "", conclusion: "", content: "", frameworkId: "" });
      toast({ title: "笔记已保存" });
    },
    onError: (err: Error) => toast({ title: "保存失败", description: err.message, variant: "destructive" }),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API}/notes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-stock", code] });
      qc.invalidateQueries({ queryKey: ["invest-notes"] });
      qc.invalidateQueries({ queryKey: ["invest-overview"] });
      toast({ title: "笔记已删除" });
    },
  });

  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState({ metric: "peTtm", operator: "gt", threshold: "", level: "yellow", note: "" });
  const ruleMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/alert-rules`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code, metric: ruleForm.metric, operator: ruleForm.operator,
          threshold: Number(ruleForm.threshold), level: ruleForm.level, note: ruleForm.note || null,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "创建失败");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-alert-rules"] });
      setRuleOpen(false);
      setRuleForm({ metric: "peTtm", operator: "gt", threshold: "", level: "yellow", note: "" });
      toast({ title: "预警规则已创建", description: "下次同步指标时自动评估" });
    },
    onError: (err: Error) => toast({ title: "创建失败", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <InvestLayout>
        <div className="p-6 space-y-4">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
        </div>
      </InvestLayout>
    );
  }

  if (error || !data) {
    return (
      <InvestLayout>
        <div className="p-6">
          <Link href="/invest/watchlist" className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-4">
            <ArrowLeft className="w-4 h-4" /> 返回资源池
          </Link>
          <Card className="p-8 text-center text-muted-foreground">
            {error?.message || "未找到该股票"}
          </Card>
        </div>
      </InvestLayout>
    );
  }

  const m = data.metrics;
  const change = m?.priceChangePct ?? null;
  const notesByFramework = (data.notes || []).reduce<Record<string, InvestNote[]>>((acc, n) => {
    const key = n.frameworkId || "未分类";
    (acc[key] ||= []).push(n);
    return acc;
  }, {});
  const frameworkKeys = Object.keys(notesByFramework).sort();

  return (
    <InvestLayout>
      <div className="p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <Link href="/invest/watchlist" className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-2">
              <ArrowLeft className="w-4 h-4" /> 资源池
            </Link>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              {data.name}
              <span className="text-base font-normal text-muted-foreground">{data.code}</span>
              {data.isSt && <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30 border">ST</Badge>}
            </h1>
            <div className="text-sm text-muted-foreground mt-1">
              {data.market} · {data.industry || "—"} · {data.sector || "—"}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setRuleOpen(true)}>
              <Bell className="w-4 h-4" /> 添加预警
            </Button>
            <Button variant="outline" size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
              <RefreshCw className={syncMutation.isPending ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
              同步指标
            </Button>
          </div>
        </div>

        {/* 估值历史分位（P0-1）*/}
        <ValuationBlock code={code} />

        {/* 指标卡片 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" /> 实时指标
            </h2>
            {m && <span className="text-xs text-muted-foreground">更新于 {new Date(m.updatedAt).toLocaleString("zh-CN")}</span>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Metric label="现价" value={fmt(m?.price)} hint={change === null ? undefined : (change >= 0 ? "↑" : "↓") + pct(Math.abs(change))} />
            <Metric label="PE (TTM)" value={fmt(m?.peTtm)} />
            <Metric label="PB" value={fmt(m?.pb)} />
            <Metric label="PS" value={fmt(m?.ps)} />
            <Metric label="ROE" value={pct(m?.roe)} />
            <Metric label="毛利率" value={pct(m?.grossMargin)} />
            <Metric label="净利率" value={pct(m?.netMargin)} />
            <Metric label="市值" value={cap(m?.marketCap)} />
            <Metric label="营收同比" value={pct(m?.revenueYoy)} hint={m && m.revenueYoy !== null ? (m.revenueYoy >= 0 ? "↑" : "↓") : undefined} />
            <Metric label="利润同比" value={pct(m?.profitYoy)} hint={m && m.profitYoy !== null ? (m.profitYoy >= 0 ? "↑" : "↓") : undefined} />
            <Metric label="股息率" value={pct(m?.dividendYield)} />
            <Metric label="行业" value={data.industry || "—"} />
          </div>
        </div>

        {/* Tabs：笔记 / 牛熊辩论 / 数据扩展 */}
        <Tabs defaultValue="notes">
          <TabsList>
            <TabsTrigger value="notes">
              <BookOpen className="w-4 h-4 mr-1" /> 投研笔记
              <Badge variant="secondary" className="ml-1 text-xs">{data.notes?.length || 0}</Badge>
            </TabsTrigger>
            <TabsTrigger value="debate">
              <Scale className="w-4 h-4 mr-1" /> 牛熊辩论
            </TabsTrigger>
            <TabsTrigger value="extra">
              <FileSearch className="w-4 h-4 mr-1" /> 数据扩展
            </TabsTrigger>
            <TabsTrigger value="trades">
              <Wallet className="w-4 h-4 mr-1" /> 交易记录
            </TabsTrigger>
            <TabsTrigger value="review">
              <ClipboardCheck className="w-4 h-4 mr-1" /> 复盘
            </TabsTrigger>
          </TabsList>

          {/* 笔记 Tab */}
          <TabsContent value="notes" className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-emerald-500" /> 投研笔记
              </h2>
              <Button size="sm" onClick={() => setNoteOpen(true)}>
                <Plus className="w-4 h-4" /> 写笔记
              </Button>
            </div>
            {(data.notes?.length || 0) === 0 ? (
              <Card className="p-8 text-center text-muted-foreground text-sm">
                暂无笔记。点「写笔记」手动记录，或和擎天柱讨论后自动记录。
              </Card>
            ) : frameworkKeys.length === 1 && frameworkKeys[0] === "未分类" ? (
              <div className="space-y-3">
                {notesByFramework["未分类"].map(n => <NoteCard key={n.id} note={n} onDelete={deleteNoteMutation.mutate} />)}
              </div>
            ) : (
              <Tabs defaultValue={frameworkKeys[0]}>
                <TabsList className="flex-wrap h-auto">
                  {frameworkKeys.map(k => (
                    <TabsTrigger key={k} value={k} className="text-xs">
                      {k} <span className="ml-1 text-muted-foreground">{notesByFramework[k].length}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
                {frameworkKeys.map(k => (
                  <TabsContent key={k} value={k} className="space-y-3 mt-3">
                    {notesByFramework[k].map(n => <NoteCard key={n.id} note={n} onDelete={deleteNoteMutation.mutate} />)}
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </TabsContent>

          <TabsContent value="debate" className="mt-3">
            <DebateTab code={code} />
          </TabsContent>

          <TabsContent value="extra" className="mt-3">
            <ExtraDataTab code={code} />
          </TabsContent>
          <TabsContent value="trades" className="mt-3">
            <TradesTab code={code} />
          </TabsContent>
          <TabsContent value="review" className="mt-3">
            <ReviewTab code={code} stockName={data.name} />
          </TabsContent>
        </Tabs>
      </div>

      {/* 写笔记 Dialog */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>写笔记 · {data.name}({code})</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">标题（可选）</Label>
              <Input value={noteForm.title} onChange={(e) => setNoteForm(s => ({ ...s, title: e.target.value }))} placeholder="一句话主题" />
            </div>
            <div>
              <Label className="text-xs">结论 *</Label>
              <Input value={noteForm.conclusion} onChange={(e) => setNoteForm(s => ({ ...s, conclusion: e.target.value }))} placeholder="核心结论，如「当前估值偏低，护城河稳固」" />
            </div>
            <div>
              <Label className="text-xs">分析框架</Label>
              <Select value={noteForm.frameworkId} onValueChange={(v) => setNoteForm(s => ({ ...s, frameworkId: v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="不关联框架" /></SelectTrigger>
                <SelectContent>
                  {frameworks.filter(f => f.isEnabled).map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">正文（可选，留空则用结论填充）</Label>
              <Textarea className="min-h-[140px]" value={noteForm.content} onChange={(e) => setNoteForm(s => ({ ...s, content: e.target.value }))} placeholder="详细分析、数据依据、风险点……" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteOpen(false)}>取消</Button>
            <Button onClick={() => noteMutation.mutate()} disabled={noteMutation.isPending || !noteForm.conclusion.trim()}>
              {noteMutation.isPending ? "保存中…" : "保存笔记"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 添加预警规则 Dialog */}
      <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>添加预警规则 · {code}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">监控指标</Label>
                <Select value={ruleForm.metric} onValueChange={(v) => setRuleForm(s => ({ ...s, metric: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALERT_METRICS.map((mtr) => (
                      <SelectItem key={mtr.key} value={mtr.key}>{mtr.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">比较方式</Label>
                <Select value={ruleForm.operator} onValueChange={(v) => setRuleForm(s => ({ ...s, operator: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALERT_OPERATORS.map((op) => (
                      <SelectItem key={op.key} value={op.key}>{op.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">阈值</Label>
                <Input type="number" value={ruleForm.threshold} onChange={(e) => setRuleForm(s => ({ ...s, threshold: e.target.value }))} placeholder="如 30" />
              </div>
              <div>
                <Label className="text-xs">级别</Label>
                <Select value={ruleForm.level} onValueChange={(v) => setRuleForm(s => ({ ...s, level: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALERT_LEVELS.map((lv) => (
                      <SelectItem key={lv.key} value={lv.key}>{lv.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">备注（可选）</Label>
              <Input value={ruleForm.note} onChange={(e) => setRuleForm(s => ({ ...s, note: e.target.value }))} placeholder="如「破 30 倍减仓」" />
            </div>
            <p className="text-xs text-muted-foreground">规则在每次「同步指标」时自动评估，命中则生成未读预警（同规则未读不重复）。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleOpen(false)}>取消</Button>
            <Button onClick={() => ruleMutation.mutate()} disabled={ruleMutation.isPending || ruleForm.threshold === ""}>
              {ruleMutation.isPending ? "创建中…" : "创建规则"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </InvestLayout>
  );
}
