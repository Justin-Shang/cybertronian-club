// StatPilot NBA 分析页 — 球员投篮/赛季统计 + 单场赛后报告
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Trophy, FileText } from "lucide-react";
import StatpilotLayout from "./statpilot-layout";
import { API, type NbaPlayer, type NbaShooting, type NbaSeasonStats, type NbaBoxscore, type NbaGame } from "./shared";

function StatRow({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value ?? "—"}</span>
    </div>
  );
}

export default function NbaPage() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<NbaPlayer | null>(null);
  const [gameDate, setGameDate] = useState("");
  const [selectedGame, setSelectedGame] = useState<NbaGame | null>(null);
  const [gameReport, setGameReport] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  // 输入防抖：停止输入 400ms 后才触发搜索（含在线兜底，避免逐键外呼）
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  // 球员搜索
  const searchQuery = useQuery({
    queryKey: ["nba-search", debounced],
    queryFn: async () => {
      if (!debounced) return [] as NbaPlayer[];
      const res = await fetch(API + "/nba/players/search?q=" + encodeURIComponent(debounced));
      if (!res.ok) throw new Error("搜索失败");
      return res.json() as Promise<NbaPlayer[]>;
    },
    enabled: debounced.length > 0,
  });

  // 投篮构成
  const shooting = useQuery({
    queryKey: ["nba-shooting", selected?.id],
    queryFn: async () => {
      const res = await fetch(API + "/nba/players/" + selected!.id + "/shooting");
      if (!res.ok) throw new Error("投篮数据加载失败");
      return res.json() as Promise<NbaShooting>;
    },
    enabled: !!selected,
  });

  // 赛季统计
  const seasonStats = useQuery({
    queryKey: ["nba-season", selected?.id],
    queryFn: async () => {
      const res = await fetch(API + "/nba/players/" + selected!.id + "/season-stats");
      if (!res.ok) throw new Error("赛季统计加载失败");
      return res.json() as Promise<NbaSeasonStats>;
    },
    enabled: !!selected,
  });

  // 赛程（按日期）
  const scoreboard = useQuery({
    queryKey: ["nba-scoreboard", gameDate],
    queryFn: async () => {
      const suffix = gameDate ? "?date=" + gameDate : "";
      const res = await fetch(API + "/nba/games/scoreboard" + suffix);
      if (!res.ok) throw new Error("赛程加载失败");
      return (await res.json()) as { games: NbaGame[] };
    },
  });

  // 赛后报告
  const generateReport = async (game: NbaGame) => {
    setSelectedGame(game);
    setGameReport(null);
    setReporting(true);
    try {
      const res = await fetch(API + "/ai/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league: "nba", game_id: game.gameId }),
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
            <Trophy className="w-6 h-6 text-orange-500" />
            NBA 数据分析
          </h1>
          <p className="text-sm text-muted-foreground mt-1">投篮构成 · 赛季统计 · 单场赛后报告（ESPN 2025-26 赛季）</p>
        </div>

        {/* 球员查询 */}
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">球员查询（支持中文名/英文名）</div>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例：文班 / Wembanyama / 库里"
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

        {/* 球员分析结果 */}
        {selected && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary">{selected.name}</Badge>
                <Badge variant="outline">{selected.team} · {selected.position}</Badge>
              </div>
              {shooting.isLoading ? (
                <div className="h-48 bg-muted animate-pulse rounded-lg" />
              ) : shooting.data ? (
                <>
                  <div className="text-xs text-muted-foreground mb-2">
                    三分 {shooting.data.three.made}/{shooting.data.three.attempted} ({shooting.data.three.pct}%) ·
                    两分 {shooting.data.two.made}/{shooting.data.two.attempted} ({shooting.data.two.pct}%) ·
                    罚球 {shooting.data.freeThrow.made}/{shooting.data.freeThrow.attempted}
                  </div>
                  <img src={"data:image/png;base64," + shooting.data.chartBase64} alt="投篮构成" className="rounded-lg border border-border w-full" />
                </>
              ) : (
                <div className="text-sm text-muted-foreground">投篮数据加载失败（可能无该赛季数据）</div>
              )}
            </Card>

            <Card className="p-4">
              <div className="text-sm font-medium mb-2">赛季统计（场均）</div>
              {seasonStats.isLoading ? (
                <div className="h-48 bg-muted animate-pulse rounded-lg" />
              ) : seasonStats.data ? (
                <div>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div className="bg-muted rounded-md p-2 text-center">
                      <div className="text-lg font-bold tabular-nums">{seasonStats.data.perGame.points ?? "—"}</div>
                      <div className="text-[10px] text-muted-foreground">得分</div>
                    </div>
                    <div className="bg-muted rounded-md p-2 text-center">
                      <div className="text-lg font-bold tabular-nums">{seasonStats.data.perGame.rebounds ?? "—"}</div>
                      <div className="text-[10px] text-muted-foreground">篮板</div>
                    </div>
                    <div className="bg-muted rounded-md p-2 text-center">
                      <div className="text-lg font-bold tabular-nums">{seasonStats.data.perGame.assists ?? "—"}</div>
                      <div className="text-[10px] text-muted-foreground">助攻</div>
                    </div>
                  </div>
                  <StatRow label="抢断" value={seasonStats.data.perGame.steals} />
                  <StatRow label="盖帽" value={seasonStats.data.perGame.blocks} />
                  <StatRow label="投篮命中率" value={seasonStats.data.perGame.fgPct} />
                  <StatRow label="三分命中率" value={seasonStats.data.perGame.threePct} />
                  <StatRow label="罚球命中率" value={seasonStats.data.perGame.ftPct} />
                  <StatRow label="PER 效率值" value={seasonStats.data.advanced.per} />
                  <StatRow label="eFG% / TS%" value={seasonStats.data.advanced.effFgPct + " / " + seasonStats.data.advanced.tsPct} />
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">无赛季统计</div>
              )}
            </Card>
          </div>
        )}

        {/* 赛后报告 */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">单场赛后报告</div>
            <div className="flex gap-2">
              <Input
                type="date"
                value={gameDate}
                onChange={(e) => setGameDate(e.target.value)}
                className="w-40 h-8 text-xs"
              />
            </div>
          </div>
          {scoreboard.isLoading ? (
            <div className="h-20 bg-muted animate-pulse rounded-lg" />
          ) : scoreboard.data && scoreboard.data.games.length > 0 ? (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {scoreboard.data.games.map((g) => (
                <button
                  key={g.gameId}
                  onClick={() => generateReport(g)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm border border-border hover:border-primary/50 transition-colors text-left"
                >
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">{g.away.abbr}</span>
                  <span className="text-muted-foreground text-xs">@</span>
                  <span className="font-medium">{g.home.abbr}</span>
                  <Badge variant="outline" className="text-xs ml-auto">{g.status}</Badge>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              当天无比赛。休赛期可切换到历史日期（如 20260115）查看常规赛。
            </div>
          )}

          {reporting && (
            <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> 正在生成报告…
            </div>
          )}

          {gameReport && (
            <div className="mt-3">
              <div className="text-xs text-muted-foreground mb-2">
                {selectedGame ? selectedGame.away.abbr + " @ " + selectedGame.home.abbr : ""}
              </div>
              <div className="text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-4 leading-relaxed">{gameReport}</div>
            </div>
          )}
        </Card>
      </div>
    </StatpilotLayout>
  );
}
