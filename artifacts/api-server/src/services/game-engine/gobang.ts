import type { GameEngine, GameState, MoveResult } from "./types";

const SIZE = 15;

interface GobangState extends GameState {
  board: number[][]; // 0=empty, 1=black(P1), 2=white(P2)
  lastMove: [number, number] | null;
}

function emptyBoard(): number[][] {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function checkWin(board: number[][], row: number, col: number, player: number): boolean {
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

function renderBoard(board: number[][]): string {
  const symbols = [" · ", " ● ", " ○ "];
  return board.map((row, r) =>
    row.map((cell) => symbols[cell]).join("") + `  ${r}`
  ).join("\n");
}

export const gobangEngine: GameEngine = {
  initState(): GameState {
    return {
      board: emptyBoard(),
      lastMove: null,
    };
  },

  validateMove(state: GameState, move: Record<string, unknown>): boolean {
    const s = state as GobangState;
    const row = move.row as number;
    const col = move.col as number;
    if (typeof row !== "number" || typeof col !== "number") return false;
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return false;
    return s.board[row][col] === 0;
  },

  applyMove(state: GameState, move: Record<string, unknown>, player: 1 | 2): MoveResult {
    const s = state as GobangState;
    const row = move.row as number;
    const col = move.col as number;
    const newBoard = s.board.map(r => [...r]);
    newBoard[row][col] = player;

    const newState: GobangState = {
      board: newBoard,
      lastMove: [row, col],
    };

    if (checkWin(newBoard, row, col, player)) {
      return { state: newState, over: true, winner: player };
    }

    if (newBoard.flat().every(c => c !== 0)) {
      return { state: newState, over: true, winner: null };
    }

    return { state: newState, over: false, winner: null };
  },

  buildPrompt(state: GameState, player: 1 | 2, agentName: string): string {
    const s = state as GobangState;
    const boardStr = renderBoard(s.board);
    const colLabels = Array.from({ length: SIZE }, (_, i) => String(i).padStart(2)).join(" ");
    const stone = player === 1 ? "● (Black)" : "○ (White)";

    return `You are ${agentName}, playing Gobang (五子棋) as ${stone}. Your goal is to get 5 in a row.

Rules:
- ● = Black (plays first)
- ○ = White
- · = empty

Board (row 0 is top, col 0 is left):
     col: ${colLabels}
${boardStr}

Strategy:
1. If you have 4 in a row, complete it to win
2. If opponent has 4 in a row, block immediately
3. If you have 3 open on both sides, extend it
4. If opponent has 3 open on both sides, block it
5. Otherwise play near center and build position

Respond with ONLY "row,col" (0-indexed). Nothing else. Example: "7,7"`;
  },

  parseResponse(text: string): Record<string, unknown> | null {
    const match = text.trim().match(/(\d+)\s*[,，]\s*(\d+)/);
    if (!match) return null;
    const row = parseInt(match[1]);
    const col = parseInt(match[2]);
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
    return { row, col };
  },
};
