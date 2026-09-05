// StatPilot NFL 分析页 — 球员赛季统计 + 单场复盘（ESPN 数据源）
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield, FileText, Search } from "lucide-react";
import StatpilotLayout from "./statpilot-layout";
import { API, type NflPlayer, type NflSeasonStats, type NflGame } from "./shared";

const EXAMPLES = ["Patrick Mahomes", "Travis Kelce", "Justin Jefferson", "Josh Allen"];

function StatRow({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value ?? "—"}</span>
    </div>
  );
}

export default function NflPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<NflPlayer | null>(null);
  const [gameId, setGameId] = useState("");
  const [gameReport, setGameReport] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  // 输入防抖：停止输入 400ms 后才触发搜索（含在线兜底，避免逐键外呼）
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  // 球员搜索
  const searchQuery = useQuery({
    queryKey: ["nfl-search", debounced],
    queryFn: async () => {
      if (!debounced) return [] as NflPlayer[];
      const res = await fetch(API + "/nfl/players/search?q=" + encodeURIComponent(debounced));
      if (!res.ok) throw new Error("搜索失败");
      return res.json() as Promise<NflPlayer[]>;
    },
    enabled: debounced.length > 0,
  });

  // 赛季统计（2025 完整赛季；2026 赛季季前赛阶段数据不全）
  const seasonStats = useQuery({
    queryKey: ["nfl-season", selected?.id],
    queryFn: async () => {
      const res = await fetch(API + "/nfl/players/" + selected!.id + "/season-stats?season=2025");
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error((err && err.detail) || "赛季统计加载失败");
      }
      return res.json() as Promise<NflSeasonStats>;
    },
    enabled: !!selected,
  });

  // 当日赛程
  const scoreboard = useQuery({
    queryKey: ["nfl-scoreboard"],
    queryFn: async () => {
      const res = await fetch(API + "/nfl/games/scoreboard");
      if (!res.ok) throw new Error("赛程加载失败");
      return (await res.json()) as { games: NflGame[] };
    },
  });

  // 单场复盘
  const generateReport = async (gid?: string) => {
    const id = (gid ?? gameId).trim();
    if (!id || reporting) return;
    setReporting(true);
    setGameReport(null);
    try {
      const res = await fetch(API + "/ai/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league: "nfl", game_id: id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error((err && err.detail) || "报告生成失败");
      }
      const data = await res.json();
      setGameReport(data.report);
    } catch (e) {
      setGameReport("生成失败：" + (e as Error).message);
    } finally {
      setReporting(false);
    }
  };

  return (
    <StatpilotLayout>
      <div className="p-6 space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="w-6 h-6 text-green-600" />
            NFL 数据分析
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            球员赛季统计 · 单场复盘（ESPN 2026 赛季数据源）
          </p>
        </div>

        {/* 球员查询 */}
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">球员查询（支持中文/英文名）</div>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例：马霍姆斯 / Mahomes / Kelce"
            />
          </div>
          {searchQuery.data && searchQuery.data.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {searchQuery.data.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                    selected?.id === p.id
                      ? "bg-primary/15 border-primary text-primary"
                      : "border-border hover:border-primary/50 text-foreground"
                  }`}
                >
                  {p.name}
                  {p.cnName && <span className="ml-1 text-primary/80">{p.cnName}</span>}
                  <span className="text-xs text-muted-foreground ml-1">({p.team} · {p.position})</span>
                </button>
              ))}
            </div>
          )}
          {searchQuery.data && searchQuery.data.length === 0 && query.trim() && !searchQuery.isFetching && (
            <div className="text-xs text-muted-foreground mt-2">未找到匹配球员，试试英文名或换个写法</div>
          )}
        </Card>

        {/* 赛季统计 */}
        {selected && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="secondary">{seasonStats.data?.name || selected.name}</Badge>
              <Badge variant="outline">{seasonStats.data?.team || selected.team} · {seasonStats.data?.position || selected.position}</Badge>
              <span className="text-xs text-muted-foreground ml-auto">2025 赛季</span>
            </div>
            {seasonStats.isLoading ? (
              <div className="h-32 bg-muted animate-pulse rounded-lg" />
            ) : seasonStats.error ? (
              <div className="text-sm text-red-600 dark:text-red-400">{String(seasonStats.error.message)}</div>
            ) : seasonStats.data ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">传球</div>
                  <StatRow label="传球码数" value={seasonStats.data.passing.yards} />
                  <StatRow label="达阵" value={seasonStats.data.passing.td} />
                  <StatRow label="抄截" value={seasonStats.data.passing.int} />
                  <StatRow label="命中率" value={seasonStats.data.passing.pct} />
                  <StatRow label="尝试/完成" value={seasonStats.data.passing.attempts + "/" + seasonStats.data.passing.completions} />
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">冲球</div>
                  <StatRow label="冲球码数" value={seasonStats.data.rushing.yards} />
                  <StatRow label="冲球达阵" value={seasonStats.data.rushing.td} />
                  <StatRow label="尝试" value={seasonStats.data.rushing.attempts} />
                  <StatRow label="均码" value={seasonStats.data.rushing.avg} />
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">接球</div>
                  <StatRow label="接球码数" value={seasonStats.data.receiving.yards} />
                  <StatRow label="接球达阵" value={seasonStats.data.receiving.td} />
                  <StatRow label="接球数" value={seasonStats.data.receiving.receptions} />
                  <StatRow label="目标" value={seasonStats.data.receiving.targets} />
                </div>
              </div>
            ) : null}
          </Card>
        )}

        {/* 单场复盘 */}
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">单场复盘（点击今日比赛，或输入 game_id）</div>
          <div className="flex gap-2 mb-3">
            <Input
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              placeholder="NFL game_id，如 401872656"
              className="flex-1"
            />
            <Button onClick={() => generateReport()} disabled={reporting}>
              {reporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {reporting ? "生成中" : "生成报告"}
            </Button>
          </div>
          {scoreboard.isLoading ? (
            <div className="h-16 bg-muted animate-pulse rounded-lg" />
          ) : scoreboard.data && scoreboard.data.games.length > 0 ? (
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {scoreboard.data.games.map((g) => (
                <button
                  key={g.gameId}
                  onClick={() => generateReport(g.gameId)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm border border-border hover:border-primary/50 transition-colors text-left"
                >
                  <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">{g.away.abbr}</span>
                  <span className="text-muted-foreground text-xs">@</span>
                  <span className="font-medium">{g.home.abbr}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{g.name}</span>
                  <Badge variant="outline" className="text-xs">{g.status}</Badge>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">当前无比赛</div>
          )}
          {reporting && (
            <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> 正在生成报告…
            </div>
          )}
          {gameReport && (
            <div className="mt-3 text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-4 leading-relaxed">{gameReport}</div>
          )}
        </Card>
      </div>
    </StatpilotLayout>
  );
}
