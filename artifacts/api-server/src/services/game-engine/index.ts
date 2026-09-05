import { gobangEngine } from "./gobang";
export type { GameEngine, GameState, MoveResult } from "./types";
export { gobangEngine };

const engines: Record<string, GameEngine> = {
  gobang: gobangEngine,
};

export function getEngine(gameType: string): GameEngine | undefined {
  return engines[gameType];
}
