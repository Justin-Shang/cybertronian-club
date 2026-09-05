// StatPilot 体育数据分析模块 — 共享类型与 API 助手
// 后端由 Express 代理 /api/statpilot/* → Python 微服务(127.0.0.1:5080)

export const API = "/api/statpilot";

// ---------- NBA ----------

export interface NbaPlayer {
  id: string;
  name: string;
  shortName: string;
  team: string;
  teamName: string;
  position: string;
  /** 中文名（有映射时返回，用于展示） */
  cnName?: string | null;
  cnNames?: string[];
}

export interface NbaPerGame {
  points: string | null;
  rebounds: string | null;
  assists: string | null;
  steals: string | null;
  blocks: string | null;
  fgPct: string | null;
  threePct: string | null;
  ftPct: string | null;
  minutes: string | null;
}

export interface NbaSeasonStats {
  playerId: string;
  name: string;
  team: string;
  position: string;
  season: number;
  perGame: NbaPerGame;
  totals: {
    games: string | null;
    fgm: string | null;
    fga: string | null;
    tpm: string | null;
    tpa: string | null;
    ftm: string | null;
    fta: string | null;
    plusMinus: string | null;
  };
  advanced: { per: string | null; effFgPct: string | null; tsPct: string | null; usage: string | null };
}

export interface ShootingSplit {
  made: number;
  attempted: number;
  pct: number | null;
}

export interface NbaShooting {
  name: string;
  team: string;
  season: number;
  three: ShootingSplit;
  two: ShootingSplit;
  freeThrow: ShootingSplit;
  eFgPct: number | null;
  tsPct: number | null;
  chartBase64?: string | null;
}

export interface NbaGame {
  gameId: string;
  name: string;
  date: string;
  status: string;
  home: { abbr: string; score: string | null };
  away: { abbr: string; score: string | null };
}

export interface NbaBoxscorePlayer {
  id: string;
  name: string;
  team: string;
  starter: boolean;
  position: string;
  min: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  plusMinus: number;
  fg: string;
  tp: string;
  ft: string;
}

export interface NbaBoxscore {
  gameId: string;
  name: string;
  date: string;
  status: string;
  home: { abbr: string; name: string; score: string | null };
  away: { abbr: string; name: string; score: string | null };
  linescore: { team: string; period: number; pts: number }[];
  players: NbaBoxscorePlayer[];
  leader: string | null;
}

// ---------- NFL ----------

export interface NflPlayer {
  id: string;
  name: string;
  shortName: string;
  team: string;
  teamName: string;
  position: string;
  /** 中文名（有映射时返回，用于展示） */
  cnName?: string | null;
  cnNames?: string[];
}

export interface NflSeasonStats {
  playerId: string;
  name: string;
  team: string;
  position: string;
  season: number;
  passing: { attempts: string | null; completions: string | null; yards: string | null; td: string | null; int: string | null; pct: string | null };
  rushing: { attempts: string | null; yards: string | null; td: string | null; avg: string | null };
  receiving: { receptions: string | null; yards: string | null; td: string | null; targets: string | null };
  games: string | null;
}

export interface NflGame {
  gameId: string;
  name: string;
  date: string;
  status: string;
  home: { abbr: string; score: string | null };
  away: { abbr: string; score: string | null };
}

export interface NflReceiving {
  player: string;
  season: number;
  targets: number;
  receptions: number;
  yards: number;
  touchdowns: number;
  totalEpa: number;
  touchEpa: number;
  distribution: { location: string; targets: number; completions: number; yards: number; avgAirYards: number; avgYac: number; totalEpa: number }[];
  chartBase64?: string | null;
}

export interface NflEpa {
  player: string;
  season: number;
  games: number;
  plays: number;
  totalEpa: number;
  avgPerGame: number | null;
  avgPerPlay: number | null;
  passEpa: number;
  rushEpa: number;
  chartBase64?: string | null;
}

export interface NflGameSummary {
  gameId: string;
  week: number;
  home: string;
  away: string;
  finalHome: number | null;
  finalAway: number | null;
  keyPlays: { role: string; name: string; plays: number; epa: number; yards: number }[];
  touchdowns: { desc: string; posteam: string; qtr: string; yards_gained: number }[];
}

// ---------- AI ----------

export interface AskResult {
  answer: string;
  chartBase64: string | null;
  data: Record<string, unknown> | null;
}

export interface ReportResult {
  league: string;
  gameId: string;
  report: string;
  chartBase64: string | null;
}
