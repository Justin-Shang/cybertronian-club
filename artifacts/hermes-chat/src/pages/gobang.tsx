import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, RotateCcw, Bot, User, Trophy } from "lucide-react";
import Layout from "@/components/layout";
import { useListAgents } from "@workspace/api-client-react";

const SIZE = 15;
const CELL = 40;
const STONE_R = 17;
const BOARD_PX = (SIZE - 1) * CELL;
const PAD = CELL;

type Cell = 0 | 1 | 2; // 0=empty 1=black(user) 2=white(AI)
type Board = Cell[][];

function emptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0) as Cell[]);
}

function checkWin(board: Board, row: number, col: number, player: Cell): boolean {
  const dirs: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (let i = 1; i < 5; i++) {
      const r = row + dr * i, c = col + dc * i;
      if (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === player) count++;
      else break;
    }
    for (let i = 1; i < 5; i++) {
      const r = row - dr * i, c = col - dc * i;
      if (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === player) count++;
      else break;
    }
    if (count >= 5) return true;
  }
  return false;
}

function WinLine({ board, row, col, player }: { board: Board; row: number; col: number; player: Cell }) {
  const dirs: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    const cells: [number, number][] = [[row, col]];
    for (let i = 1; i < 5; i++) {
      const r = row + dr * i, c = col + dc * i;
      if (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === player) cells.push([r, c]);
      else break;
    }
    for (let i = 1; i < 5; i++) {
      const r = row - dr * i, c = col - dc * i;
      if (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === player) cells.push([r, c]);
      else break;
    }
    if (cells.length >= 5) {
      const xs = cells.map(([, c]) => PAD + c * CELL);
      const ys = cells.map(([r]) => PAD + r * CELL);
      return <line x1={Math.min(...xs)} y1={Math.min(...ys)} x2={Math.max(...xs)} y2={Math.max(...ys)} stroke="#f59e0b" strokeWidth={4} strokeLinecap="round" />;
    }
  }
  return null;
}

export default function GobangPage() {
  const [, setLocation] = useLocation();
  const { data: agents } = useListAgents();
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [turn, setTurn] = useState<1 | 2>(1); // 1=user, 2=AI
  const [status, setStatus] = useState<"playing" | "user_win" | "ai_win" | "draw">("playing");
  const [lastMove, setLastMove] = useState<[number, number] | null>(null);
  const [winMove, setWinMove] = useState<[number, number] | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<number | "">("");
  const [scores, setScores] = useState({ user: 0, ai: 0 });
  const boardRef = useRef<SVGSVGElement>(null);

  const requestAiMove = useCallback(async (currentBoard: Board) => {
    setAiThinking(true);
    try {
      const res = await fetch("/api/games/gobang/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: currentBoard, agentId: selectedAgentId || undefined }),
      });
      if (!res.ok) throw new Error("AI failed");
      const { row, col } = await res.json() as { row: number; col: number };

      const newBoard = currentBoard.map(r => [...r]) as Board;
      newBoard[row][col] = 2;
      setBoard(newBoard);
      setLastMove([row, col]);

      if (checkWin(newBoard, row, col, 2)) {
        setStatus("ai_win");
        setWinMove([row, col]);
        setScores(s => ({ ...s, ai: s.ai + 1 }));
        toast.error("AI 获胜！再来一局？");
      } else if (newBoard.flat().every(c => c !== 0)) {
        setStatus("draw");
        toast.info("平局！");
      } else {
        setTurn(1);
      }
    } catch {
      toast.error("AI 落子失败，请重试");
      setTurn(1);
    } finally {
      setAiThinking(false);
    }
  }, [selectedAgentId]);

  const handleClick = useCallback((row: number, col: number) => {
    if (status !== "playing" || turn !== 1 || aiThinking || board[row][col] !== 0) return;

    const newBoard = board.map(r => [...r]) as Board;
    newBoard[row][col] = 1;
    setBoard(newBoard);
    setLastMove([row, col]);

    if (checkWin(newBoard, row, col, 1)) {
      setStatus("user_win");
      setWinMove([row, col]);
      setScores(s => ({ ...s, user: s.user + 1 }));
      toast.success("你赢了！🎉");
      return;
    }
    if (newBoard.flat().every(c => c !== 0)) {
      setStatus("draw");
      toast.info("平局！");
      return;
    }

    setTurn(2);
    requestAiMove(newBoard);
  }, [board, status, turn, aiThinking, requestAiMove]);

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left - PAD;
    const y = e.clientY - rect.top - PAD;
    const col = Math.round(x / CELL);
    const row = Math.round(y / CELL);
    if (row >= 0 && row < SIZE && col >= 0 && col < SIZE) handleClick(row, col);
  }, [handleClick]);

  const reset = () => {
    setBoard(emptyBoard());
    setTurn(1);
    setStatus("playing");
    setLastMove(null);
    setWinMove(null);
    setAiThinking(false);
  };

  const totalPx = BOARD_PX + PAD * 2;
  const selectedAgent = agents?.find(a => a.id === selectedAgentId);

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
              <p className="text-xs text-muted-foreground">先连成五子者胜</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Agent selector */}
            <select
              value={selectedAgentId}
              onChange={e => setSelectedAgentId(e.target.value ? Number(e.target.value) : "")}
              className="text-xs bg-muted border border-border rounded-lg px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">内置 AI</option>
              {agents?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-accent text-xs text-muted-foreground hover:text-foreground rounded-lg transition-colors">
              <RotateCcw className="w-3.5 h-3.5" />重新开始
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto flex items-start justify-center gap-8 p-6">
          {/* Scoreboard */}
          <div className="flex flex-col gap-4 min-w-[140px] shrink-0 pt-2">
            {/* User */}
            <div className={`p-3 rounded-xl border transition-all ${turn === 1 && status === "playing" ? "border-foreground/30 bg-card" : "border-border bg-card/50"}`}>
              <div className="flex items-center gap-2 mb-2">
                <User className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-foreground">你（黑棋●）</span>
              </div>
              <div className="text-2xl font-bold text-foreground">{scores.user}</div>
              {turn === 1 && status === "playing" && <p className="text-[10px] text-primary mt-1">你的回合</p>}
            </div>

            {/* AI */}
            <div className={`p-3 rounded-xl border transition-all ${(turn === 2 || aiThinking) && status === "playing" ? "border-foreground/30 bg-card" : "border-border bg-card/50"}`}>
              <div className="flex items-center gap-2 mb-2">
                <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-foreground">{selectedAgent?.name ?? "AI"}（白棋○）</span>
              </div>
              <div className="text-2xl font-bold text-foreground">{scores.ai}</div>
              {aiThinking && <p className="text-[10px] text-amber-400 mt-1 animate-pulse">思考中…</p>}
              {turn === 2 && !aiThinking && status === "playing" && <p className="text-[10px] text-primary mt-1">AI 回合</p>}
            </div>

            {/* Status banner */}
            {status !== "playing" && (
              <div className={`p-3 rounded-xl border text-center ${status === "user_win" ? "border-emerald-500/40 bg-emerald-500/10" : status === "ai_win" ? "border-red-500/40 bg-red-500/10" : "border-border bg-card"}`}>
                <Trophy className={`w-6 h-6 mx-auto mb-1 ${status === "user_win" ? "text-emerald-400" : status === "ai_win" ? "text-red-400" : "text-muted-foreground"}`} />
                <p className="text-sm font-semibold text-foreground">
                  {status === "user_win" ? "你赢了！" : status === "ai_win" ? "AI 获胜" : "平局"}
                </p>
                <button onClick={reset} className="mt-2 w-full px-2 py-1 bg-primary text-primary-foreground rounded text-xs hover:opacity-90">再来一局</button>
              </div>
            )}
          </div>

          {/* Board */}
          <div className="shrink-0 relative">
            <svg
              ref={boardRef}
              width={totalPx}
              height={totalPx}
              onClick={handleSvgClick}
              className={`rounded-xl ${status === "playing" && turn === 1 && !aiThinking ? "cursor-crosshair" : "cursor-default"}`}
              style={{ background: "linear-gradient(135deg, #d4a574 0%, #c8956a 100%)" }}
            >
              {/* Grid lines */}
              {Array.from({ length: SIZE }, (_, i) => (
                <g key={i}>
                  <line x1={PAD} y1={PAD + i * CELL} x2={PAD + (SIZE - 1) * CELL} y2={PAD + i * CELL} stroke="#8b6340" strokeWidth={1} />
                  <line x1={PAD + i * CELL} y1={PAD} x2={PAD + i * CELL} y2={PAD + (SIZE - 1) * CELL} stroke="#8b6340" strokeWidth={1} />
                </g>
              ))}

              {/* Star points (天元 + 星) */}
              {[[3,3],[3,11],[7,7],[11,3],[11,11]].map(([r, c]) => (
                <circle key={`${r}${c}`} cx={PAD + c * CELL} cy={PAD + r * CELL} r={4} fill="#8b6340" />
              ))}

              {/* Stones */}
              {board.map((row, ri) => row.map((cell, ci) => {
                if (cell === 0) return null;
                const cx = PAD + ci * CELL;
                const cy = PAD + ri * CELL;
                const isLast = lastMove && lastMove[0] === ri && lastMove[1] === ci;
                return (
                  <g key={`${ri}-${ci}`}>
                    {cell === 1 ? (
                      <>
                        <radialGradient id={`bg-${ri}-${ci}`} cx="35%" cy="35%">
                          <stop offset="0%" stopColor="#666" />
                          <stop offset="100%" stopColor="#111" />
                        </radialGradient>
                        <circle cx={cx} cy={cy} r={STONE_R} fill={`url(#bg-${ri}-${ci})`} />
                      </>
                    ) : (
                      <>
                        <radialGradient id={`wg-${ri}-${ci}`} cx="35%" cy="35%">
                          <stop offset="0%" stopColor="#fff" />
                          <stop offset="100%" stopColor="#ccc" />
                        </radialGradient>
                        <circle cx={cx} cy={cy} r={STONE_R} fill={`url(#wg-${ri}-${ci})`} stroke="#aaa" strokeWidth={1} />
                      </>
                    )}
                    {isLast && <circle cx={cx} cy={cy} r={6} fill={cell === 1 ? "#fff" : "#333"} opacity={0.7} />}
                  </g>
                );
              }))}

              {/* Win line */}
              {winMove && status !== "playing" && (
                <WinLine board={board} row={winMove[0]} col={winMove[1]} player={status === "user_win" ? 1 : 2} />
              )}

              {/* Hover cells (when user's turn) */}
              {status === "playing" && turn === 1 && !aiThinking && board.map((row, ri) => row.map((cell, ci) => {
                if (cell !== 0) return null;
                return (
                  <circle
                    key={`h-${ri}-${ci}`}
                    cx={PAD + ci * CELL}
                    cy={PAD + ri * CELL}
                    r={STONE_R}
                    fill="transparent"
                    className="hover:fill-black/20 transition-all"
                  />
                );
              }))}
            </svg>
          </div>
        </div>
      </div>
    </Layout>
  );
}
