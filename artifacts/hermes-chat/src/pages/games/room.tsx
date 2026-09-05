import { useState, useEffect, useCallback } from "react";
import { useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, RotateCcw, Bot, User, Trophy, Play, Square } from "lucide-react";
import Layout from "@/components/layout";
import GobangBoard from "@/components/games/gobang-board";
import type { Board, GameStatus } from "@/components/games/gobang-board";

interface GameSessionData {
  id: number;
  gameType: string;
  player1Type: string;
  player1Id: number | null;
  player2Type: string;
  player2Id: number | null;
  player1Name: string;
  player2Name: string;
  state: { board: number[][]; lastMove: [number, number] | null };
  currentTurn: number;
  status: string;
  winner: number | null;
}

function emptyBoard(): Board {
  return Array.from({ length: 15 }, () => Array(15).fill(0) as (0 | 1 | 2)[]);
}

export default function GameRoomPage() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/games/room/:sessionId");
  const sessionId = params?.sessionId;

  const [session, setSession] = useState<GameSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiThinking, setAiThinking] = useState(false);
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [scores, setScores] = useState({ p1: 0, p2: 0 });

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/games/sessions/${sessionId}`);
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      setSession(data);
      setLoading(false);
      return data;
    } catch {
      setLoading(false);
      toast.error("对局不存在");
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Poll for auto-play updates
  useEffect(() => {
    if (!session || session.status !== "playing") return;
    const isAgentTurn = session.currentTurn === 1
      ? session.player1Type === "agent"
      : session.player2Type === "agent";

    if (!isAgentTurn) return;

    const interval = setInterval(() => {
      fetchSession();
    }, 2000);

    return () => clearInterval(interval);
  }, [session?.id, session?.currentTurn, session?.status, fetchSession]);

  const handleCellClick = useCallback(async (row: number, col: number) => {
    if (!session || session.status !== "playing" || aiThinking) return;

    // Check if it's user's turn
    const myTurn = session.currentTurn === 1
      ? session.player1Type === "user"
      : session.player2Type === "user";
    if (!myTurn) return;

    setAiThinking(true);
    try {
      const res = await fetch(`/api/games/sessions/${session.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ move: { row, col } }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "无效走棋");
        setAiThinking(false);
        return;
      }
      const updated = await res.json();
      setSession(updated);

      if (updated.status === "finished") {
        if (updated.winner === 1) {
          setScores(s => ({ ...s, p1: s.p1 + 1 }));
          toast.success(`${updated.player1Name} 获胜！`);
        } else if (updated.winner === 2) {
          setScores(s => ({ ...s, p2: s.p2 + 1 }));
          toast.success(`${updated.player2Name} 获胜！`);
        } else {
          toast.info("平局！");
        }
      }
    } catch {
      toast.error("走棋失败");
    } finally {
      setAiThinking(false);
    }
  }, [session, aiThinking]);

  // Auto-play toggle
  const toggleAutoPlay = async () => {
    if (!session) return;
    const action = autoPlaying ? "stop" : "start";
    try {
      await fetch(`/api/games/sessions/${session.id}/auto-play`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setAutoPlaying(!autoPlaying);
      if (!autoPlaying) {
        toast.info("自动对战已开始");
        // Update session status
        setSession(s => s ? { ...s, status: "playing" } : null);
      } else {
        toast.info("自动对战已停止");
      }
    } catch {
      toast.error("操作失败");
    }
  };

  const reset = async () => {
    if (!session) return;
    try {
      const res = await fetch("/api/games/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameType: session.gameType,
          player1Type: session.player1Type,
          player1Id: session.player1Id,
          player2Type: session.player2Type,
          player2Id: session.player2Id,
        }),
      });
      const newSession = await res.json();

      if (session.player1Type === "agent" && session.player2Type === "agent") {
        await fetch(`/api/games/sessions/${newSession.id}/auto-play`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        });
        setAutoPlaying(true);
      }

      setLocation(`/games/room/${newSession.id}`);
    } catch {
      toast.error("创建新对局失败");
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      </Layout>
    );
  }

  if (!session) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <p className="text-muted-foreground">对局不存在</p>
          <button onClick={() => setLocation("/games")} className="text-primary text-sm hover:underline">返回大厅</button>
        </div>
      </Layout>
    );
  }

  const board = (session.state?.board as number[][]) ?? emptyBoard();
  const lastMove = session.state?.lastMove as [number, number] | null ?? null;
  const isAgentVsAgent = session.player1Type === "agent" && session.player2Type === "agent";
  const myTurn = session.currentTurn === 1
    ? session.player1Type === "user"
    : session.player2Type === "user";
  const isPlaying = session.status === "playing";
  const isFinished = session.status === "finished";
  const gameStatus: GameStatus = isFinished
    ? (session.winner === 1 ? "user_win" : session.winner === 2 ? "ai_win" : "draw")
    : (isPlaying ? "playing" : "waiting");

  const p1Label = session.player1Type === "user" ? "你" : session.player1Name;
  const p2Label = session.player2Type === "user" ? "你" : session.player2Name;

  return (
    <Layout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-6 py-3.5 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setLocation("/games")} className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-base font-semibold text-foreground">五子棋</h1>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{p1Label} ●</span>
                <span>vs</span>
                <span>{p2Label} ○</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAgentVsAgent && (
              <button
                onClick={toggleAutoPlay}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${autoPlaying ? "bg-destructive/10 text-destructive hover:bg-destructive/20" : "bg-primary/10 text-primary hover:bg-primary/20"}`}
              >
                {autoPlaying ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {autoPlaying ? "停止" : "自动对战"}
              </button>
            )}
            <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-accent text-xs text-muted-foreground hover:text-foreground rounded-lg transition-colors">
              <RotateCcw className="w-3.5 h-3.5" />再来一局
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto flex items-start justify-center gap-8 p-6">
          {/* Scoreboard */}
          <div className="flex flex-col gap-4 min-w-[140px] shrink-0 pt-2">
            {/* Player 1 */}
            <div className={`p-3 rounded-xl border transition-all ${session.currentTurn === 1 && isPlaying ? "border-foreground/30 bg-card" : "border-border bg-card/50"}`}>
              <div className="flex items-center gap-2 mb-2">
                {session.player1Type === "user" ? <User className="w-3.5 h-3.5 text-muted-foreground" /> : <Bot className="w-3.5 h-3.5 text-muted-foreground" />}
                <span className="text-xs font-medium text-foreground">{p1Label}（●）</span>
              </div>
              <div className="text-2xl font-bold text-foreground">{scores.p1}</div>
              {session.currentTurn === 1 && isPlaying && (aiThinking ? <p className="text-[10px] text-amber-400 mt-1 animate-pulse">思考中…</p> : session.player1Type === "user" ? <p className="text-[10px] text-primary mt-1">你的回合</p> : <p className="text-[10px] text-primary mt-1">Agent 回合</p>)}
            </div>

            {/* Player 2 */}
            <div className={`p-3 rounded-xl border transition-all ${session.currentTurn === 2 && isPlaying ? "border-foreground/30 bg-card" : "border-border bg-card/50"}`}>
              <div className="flex items-center gap-2 mb-2">
                {session.player2Type === "user" ? <User className="w-3.5 h-3.5 text-muted-foreground" /> : <Bot className="w-3.5 h-3.5 text-muted-foreground" />}
                <span className="text-xs font-medium text-foreground">{p2Label}（○）</span>
              </div>
              <div className="text-2xl font-bold text-foreground">{scores.p2}</div>
              {session.currentTurn === 2 && isPlaying && (aiThinking ? <p className="text-[10px] text-amber-400 mt-1 animate-pulse">思考中…</p> : session.player2Type === "user" ? <p className="text-[10px] text-primary mt-1">你的回合</p> : <p className="text-[10px] text-primary mt-1">Agent 回合</p>)}
            </div>

            {/* Status banner */}
            {isFinished && (
              <div className={`p-3 rounded-xl border text-center ${session.winner === 1 ? "border-emerald-500/40 bg-emerald-500/10" : session.winner === 2 ? "border-red-500/40 bg-red-500/10" : "border-border bg-card"}`}>
                <Trophy className={`w-6 h-6 mx-auto mb-1 ${session.winner === 1 ? "text-emerald-400" : session.winner === 2 ? "text-red-400" : "text-muted-foreground"}`} />
                <p className="text-sm font-semibold text-foreground">
                  {session.winner === 1 ? `${p1Label} 获胜！` : session.winner === 2 ? `${p2Label} 获胜！` : "平局"}
                </p>
                <button onClick={reset} className="mt-2 w-full px-2 py-1 bg-primary text-primary-foreground rounded text-xs hover:opacity-90">再来一局</button>
              </div>
            )}

            {!isPlaying && !isFinished && (
              <div className="p-3 rounded-xl border border-border bg-card/50 text-center">
                <p className="text-xs text-muted-foreground">等待开始...</p>
              </div>
            )}
          </div>

          {/* Board */}
          <div className="shrink-0 relative">
            <GobangBoard
              board={board as Board}
              lastMove={lastMove}
              winMove={lastMove}
              status={gameStatus}
              currentTurn={session.currentTurn as 1 | 2}
              interactive={!isAgentVsAgent && isPlaying && myTurn}
              aiThinking={aiThinking}
              onCellClick={handleCellClick}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}
