import InvestLayout from "./invest-layout";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";
import { API, type Overview } from "./shared";

export default function InvestOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ["invest-overview"],
    queryFn: async () => {
      const res = await fetch(API + "/overview");
      if (!res.ok) throw new Error("Failed to fetch overview");
      return res.json() as Promise<Overview>;
    },
    refetchInterval: 10_000,
  });

  return (
    <InvestLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary" />
            投研笔记
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            和 Hermes agent 讨论投研、布置任务后的结构化记录与分析系统
          </p>
        </div>

        {/* 紧凑统计行（导航已由顶部二级菜单提供） */}
        <div className="flex items-center gap-5 text-sm text-muted-foreground">
          <span>资源池 <b className="text-foreground ml-1">{data?.watchlist ?? 0}</b></span>
          <span>候选池 <b className="text-foreground ml-1">{data?.candidates ?? 0}</b></span>
          <span>投研笔记 <b className="text-foreground ml-1">{data?.notes ?? 0}</b></span>
          <span>未读预警 <b className={"ml-1 " + ((data?.unreadAlerts ?? 0) > 0 ? "text-red-500" : "text-foreground")}>{data?.unreadAlerts ?? 0}</b></span>
        </div>

        {/* 最近笔记 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">最近笔记</h2>
            <Link href="/invest/notes" className="text-sm text-primary hover:underline">
              查看全部
            </Link>
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : data && data.recentNotes.length > 0 ? (
            <div className="space-y-3">
              {data.recentNotes.map((note) => (
                <Link key={note.id} href={"/invest/stocks/" + note.code}>
                  <Card className="p-4 hover:border-primary/50 transition-colors cursor-pointer">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge variant="secondary">{note.code}</Badge>
                      {note.agentName && (
                        <Badge variant="outline" className="text-xs">{note.agentName}</Badge>
                      )}
                      {note.frameworkId && (
                        <Badge variant="outline" className="text-xs">{note.frameworkId}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(note.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">{note.conclusion}</p>
                    {note.title && <p className="text-xs text-muted-foreground">{note.title}</p>}
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card className="p-8 text-center text-muted-foreground text-sm">
              还没有投研笔记。在聊天中让擎天柱分析股票，笔记会自动保存到这里。
            </Card>
          )}
        </div>
      </div>
    </InvestLayout>
  );
}
