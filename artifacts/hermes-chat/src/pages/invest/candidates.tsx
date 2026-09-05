import InvestLayout from "./invest-layout";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Target, ArrowUpRight, X } from "lucide-react";
import { API, fmt, pct, cap, type Candidate, type StockMetrics } from "./shared";

interface CandidateRow {
  candidate: Candidate;
  metrics: StockMetrics | null;
  valuation?: { pePercentile: number | null; pbPercentile: number | null } | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待审核", approved: "已通过", rejected: "已否决",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  approved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  rejected: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export default function CandidatesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: rows = [], isLoading } = useQuery<CandidateRow[]>({
    queryKey: ["invest-candidates"],
    queryFn: async () => {
      const res = await fetch(API + "/candidates");
      if (!res.ok) throw new Error("Failed to fetch candidates");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const promoteMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch(API + "/candidates/" + code + "/promote", { method: "POST" });
      if (!res.ok) throw new Error("promote failed");
      return res.json();
    },
    onSuccess: (_d, code) => {
      queryClient.invalidateQueries({ queryKey: ["invest-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["invest-watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["invest-overview"] });
      toast({ title: code + " 已转入资源池" });
    },
    onError: () => toast({ title: "转入失败", variant: "destructive" }),
  });

  const setStatusMutation = useMutation({
    mutationFn: async ({ code, status }: { code: string; status: string }) => {
      const res = await fetch(API + "/candidates/" + code, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("update failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invest-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["invest-overview"] });
    },
  });

  return (
    <InvestLayout>
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target className="w-6 h-6 text-amber-500" />
            候选池
          </h1>
          <p className="text-sm text-muted-foreground mt-1">agent 筛选出的候选股票，审核后可转入资源池</p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(2)].map((_, i) => <div key={i} className="h-40 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : rows.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground text-sm">
            候选池为空。让擎天柱通过投资框架筛选 A 股，结果会出现在这里。
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rows.map((r) => (
              <Card key={r.candidate.code} className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <Link href={"/invest/stocks/" + r.candidate.code} className="hover:underline">
                    <div className="font-semibold text-foreground">{r.candidate.name}</div>
                    <div className="text-xs text-muted-foreground">{r.candidate.code}</div>
                  </Link>
                  <Badge className={STATUS_COLOR[r.candidate.status] + " border-0"}>
                    {STATUS_LABEL[r.candidate.status] || r.candidate.status}
                  </Badge>
                </div>

                <div className="grid grid-cols-5 gap-2 text-xs">
                  <Metric label="PE" value={fmt(r.candidate.peTtm ?? r.metrics?.peTtm)} />
                  <Metric label="PE分位" value={
                    r.valuation?.pePercentile !== null && r.valuation?.pePercentile !== undefined
                      ? r.valuation.pePercentile.toFixed(1) + "%"
                      : "—"
                  } />
                  <Metric label="PB" value={fmt(r.candidate.pb ?? r.metrics?.pb)} />
                  <Metric label="ROE" value={pct(r.candidate.roe ?? r.metrics?.roe)} />
                  <Metric label="市值" value={cap(r.candidate.marketCap ?? r.metrics?.marketCap)} />
                </div>

                {r.candidate.score !== null && (
                  <div className="text-xs text-muted-foreground">
                    评分：<span className="font-medium text-foreground">{r.candidate.score}</span>
                    {r.candidate.frameworkId && <span> · 框架：{r.candidate.frameworkId}</span>}
                  </div>
                )}

                {r.candidate.reason && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{r.candidate.reason}</p>
                )}

                {r.candidate.status === "pending" && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="default" onClick={() => promoteMutation.mutate(r.candidate.code)} disabled={promoteMutation.isPending}>
                      <ArrowUpRight className="w-3.5 h-3.5" /> 通过并加入资源池
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setStatusMutation.mutate({ code: r.candidate.code, status: "rejected" })}>
                      <X className="w-3.5 h-3.5" /> 否决
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </InvestLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 rounded p-2 text-center">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
