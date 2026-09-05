export interface GameState {
  [key: string]: unknown;
}

export interface MoveResult {
  state: GameState;
  over: boolean;
  winner: number | null; // 1 | 2 | null (draw)
}

export interface GameEngine {
  /** Initialize a fresh game state */
  initState(): GameState;
  /** Validate a move before applying */
  validateMove(state: GameState, move: Record<string, unknown>): boolean;
  /** Apply a move and return the new state + game-over check */
  applyMove(state: GameState, move: Record<string, unknown>, player: 1 | 2): MoveResult;
  /** Build the LLM prompt for the given player */
  buildPrompt(state: GameState, player: 1 | 2, agentName: string): string;
  /** Parse the LLM response into a move object, or null if invalid */
  parseResponse(text: string): Record<string, unknown> | null;
}
