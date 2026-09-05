import { useRef, useCallback } from "react";

const SIZE = 15;
const CELL = 40;
const STONE_R = 17;
const BOARD_PX = (SIZE - 1) * CELL;
const PAD = CELL;

export type Cell = 0 | 1 | 2; // 0=empty 1=black 2=white
export type Board = Cell[][];
export type GameStatus = "playing" | "user_win" | "ai_win" | "draw" | "finished" | "waiting";

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

export interface GobangBoardProps {
  board: Board;
  lastMove: [number, number] | null;
  winMove: [number, number] | null;
  status: GameStatus;
  currentTurn: 1 | 2;
  interactive: boolean;
  aiThinking: boolean;
  onCellClick: (row: number, col: number) => void;
}

export default function GobangBoard({ board, lastMove, winMove, status, currentTurn, interactive, aiThinking, onCellClick }: GobangBoardProps) {
  const boardRef = useRef<SVGSVGElement>(null);
  const totalPx = BOARD_PX + PAD * 2;

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left - PAD;
    const y = e.clientY - rect.top - PAD;
    const col = Math.round(x / CELL);
    const row = Math.round(y / CELL);
    if (row >= 0 && row < SIZE && col >= 0 && col < SIZE) onCellClick(row, col);
  }, [interactive, onCellClick]);

  const gameOver = status === "user_win" || status === "ai_win" || status === "draw" || status === "finished";
  const isPlaying = status === "playing";
  const canClick = isPlaying && interactive && !aiThinking;

  return (
    <svg
      ref={boardRef}
      width={totalPx}
      height={totalPx}
      onClick={handleSvgClick}
      className={`rounded-xl ${canClick ? "cursor-crosshair" : "cursor-default"}`}
      style={{ background: "linear-gradient(135deg, #d4a574 0%, #c8956a 100%)" }}
    >
      {/* Grid lines */}
      {Array.from({ length: SIZE }, (_, i) => (
        <g key={i}>
          <line x1={PAD} y1={PAD + i * CELL} x2={PAD + (SIZE - 1) * CELL} y2={PAD + i * CELL} stroke="#8b6340" strokeWidth={1} />
          <line x1={PAD + i * CELL} y1={PAD} x2={PAD + i * CELL} y2={PAD + (SIZE - 1) * CELL} stroke="#8b6340" strokeWidth={1} />
        </g>
      ))}

      {/* Star points */}
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
      {winMove && gameOver && (
        <WinLine board={board} row={winMove[0]} col={winMove[1]} player={status === "user_win" ? 1 : 2} />
      )}
    </svg>
  );
}
