import { useState } from "react";
import { useLocation } from "wouter";
import { Gamepad2, CircleDot, Hash, Clock, Plus, Play, Trash2 } from "lucide-react";
import Layout from "@/components/layout";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import PlayerSelector from "@/components/games/player-selector";
import { useListAgents } from "@workspace/api-client-react";

const GAMES = [
  {
    id: "gobang",
    title: "五子棋",
    subtitle: "Gobang",
    description: "与 Agent 对弈。先连成五子者胜。",
    icon: CircleDot,
    color: "#6366f1",
    status: "ready" as const,
  },
  {
    id: "twentyfour",
    title: "24 点",
    subtitle: "24 Points",
    description: "用4张牌，通过加减乘除凑出 24。",
    icon: Hash,
    color: "#f59e0b",
    status: "ready" as const,
  },
  {
    id: "chess",
    title: "中国象棋",
    subtitle: "Chinese Chess",
    description: "经典棋局，与 Agent 博弈。",
    icon: Gamepad2,
    color: "#ef4444",
    status: "soon" as const,
  },
  {
    id: "landlord",
    title: "斗地主",
    subtitle: "Landlord",
    description: "三人斗地主，两个 Agent 陪你玩。",
    icon: Clock,
    color: "#10b981",
    status: "soon" as const,
  },
];

interface GameSession {
  id: number;
  gameType: string;
  player1Type: string;
  player1Id: number | null;
  player2Type: string;
  player2Id: number | null;
  status: string;
  winner: number | null;
  currentTurn: number;
  updatedAt: string;
}

export default function GamesPage() {
  const [, setLocation] = useLocation();
  const { data: agents } = useListAgents();
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [showSessions, setShowSessions] = useState(false);

  // Load sessions
  const loadSessions = async () => {
    try {
      const res = await fetch("/api/games/sessions");
      const data = await res.json();
      setSessions(data);
    } catch { /* ignore */ }
  };

  useState(() => { loadSessions(); });

  const handleStart = async (player1Type: string, player1Id: number | null, player2Type: string, player2Id: number | null) => {
    if (!selectedGame) return;
    setCreating(true);
    try {
      const res = await fetch("/api/games/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameType: selectedGame, player1Type, player1Id, player2Type, player2Id }),
      });
      if (!res.ok) throw new Error("Failed");
      const session = await res.json();

      // If both players are agents, start auto-play
      if (player1Type === "agent" && player2Type === "agent") {
        await fetch(`/api/games/sessions/${session.id}/auto-play`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        });
      }

      setSelectedGame(null);
      setLocation(`/games/room/${session.id}`);
    } catch {
      alert("创建游戏失败");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteSession = async (id: number) => {
    await fetch(`/api/games/sessions/${id}`, { method: "DELETE" });
    loadSessions();
  };

  const game = GAMES.find(g => g.id === selectedGame);

  return (
    <Layout>
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-border shrink-0 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Gamepad2 className="w-5 h-5 text-primary" />游戏大厅
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">选择玩家，与 Hermes Agent 对战</p>
          </div>
          <button
            onClick={() => { setShowSessions(!showSessions); loadSessions(); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showSessions ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            <Play className="w-3.5 h-3.5" />
            我的对局
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Active sessions */}
          {showSessions && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-foreground mb-3">我的对局</h2>
              {sessions.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无对局</p>
              ) : (
                <div className="space-y-2">
                  {sessions.map(s => (
                    <div key={s.id} className="flex items-center justify-between p-3 bg-card border border-border rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full" style={{
                          backgroundColor: s.status === "playing" ? "#10b981" : s.status === "finished" ? "#6b7280" : "#f59e0b"
                        }} />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {s.gameType === "gobang" ? "五子棋" : s.gameType}
                            <span className="text-xs text-muted-foreground ml-2">
                              {s.status === "playing" ? "进行中" : s.status === "finished" ? "已结束" : "等待中"}
                            </span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {s.player1Type === "user" ? "你" : `Agent`} vs {s.player2Type === "user" ? "你" : "Agent"}
                            {s.winner ? ` · 胜者: P${s.winner}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setLocation(`/games/room/${s.id}`)}
                          className="px-2 py-1 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors"
                        >
                          进入
                        </button>
                        <button
                          onClick={() => handleDeleteSession(s.id)}
                          className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Game cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 max-w-4xl">
            {GAMES.map(game => {
              const Icon = game.icon;
              const ready = game.status === "ready";
              return (
                <button
                  key={game.id}
                  data-testid={`game-card-${game.id}`}
                  onClick={() => ready && setSelectedGame(game.id)}
                  disabled={!ready}
                  className={`relative p-5 bg-card border border-border rounded-xl text-left transition-all group ${ready ? "hover:border-primary/40 hover:bg-card/80 cursor-pointer" : "opacity-50 cursor-not-allowed"}`}
                >
                  {!ready && (
                    <span className="absolute top-3 right-3 text-[10px] px-2 py-0.5 bg-muted text-muted-foreground rounded-full font-medium">即将推出</span>
                  )}
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110" style={{ backgroundColor: game.color + "20" }}>
                    <Icon className="w-6 h-6" style={{ color: game.color }} />
                  </div>
                  <p className="text-base font-semibold text-foreground">{game.title}</p>
                  <p className="text-xs text-muted-foreground mb-2">{game.subtitle}</p>
                  <p className="text-xs text-muted-foreground/70 leading-relaxed">{game.description}</p>
                  {ready && (
                    <div className="mt-4 flex items-center gap-1 text-xs text-primary font-medium">
                      <Plus className="w-3 h-3" />新建对局 →
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Player selection dialog */}
      <Dialog open={!!selectedGame} onOpenChange={(open) => !open && setSelectedGame(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {game && (
                <>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: game.color + "20" }}>
                    <game.icon className="w-4 h-4" style={{ color: game.color }} />
                  </div>
                  新建对局 · {game?.title}
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {agents && (
            <PlayerSelector
              agents={agents}
              gameName={game?.title ?? ""}
              onStart={handleStart}
              loading={creating}
            />
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
