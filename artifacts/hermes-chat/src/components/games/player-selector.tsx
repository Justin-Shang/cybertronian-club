import { useState } from "react";
import { User, Bot, Loader2 } from "lucide-react";
import type { Agent } from "@workspace/api-client-react";

interface PlayerSelectorProps {
  agents: Agent[];
  gameName: string;
  onStart: (player1Type: string, player1Id: number | null, player2Type: string, player2Id: number | null) => void;
  loading?: boolean;
}

export default function PlayerSelector({ agents, gameName, onStart, loading }: PlayerSelectorProps) {
  const [player1Id, setPlayer1Id] = useState<number | null>(null);
  const [player2Id, setPlayer2Id] = useState<number | null>(agents[0]?.id ?? null);
  const [player1IsAgent, setPlayer1IsAgent] = useState(false);
  const [player2IsAgent, setPlayer2IsAgent] = useState(true);

  const canStart = (!player1IsAgent || player1Id !== null) && (!player2IsAgent || player2Id !== null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground text-center">选择 {gameName} 的双方玩家</p>

      {/* Player 1 */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-5 h-5 rounded-full bg-foreground/10 flex items-center justify-center text-[10px] font-bold text-foreground">1</div>
          <span className="text-xs font-medium text-foreground">先手 ●</span>
          <div className="flex-1" />
          <button
            onClick={() => { setPlayer1IsAgent(!player1IsAgent); setPlayer1Id(null); }}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${player1IsAgent ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
          >
            {player1IsAgent ? "Agent" : "你"}
          </button>
        </div>

        {player1IsAgent ? (
          <div className="grid grid-cols-1 gap-1 max-h-32 overflow-y-auto">
            {agents.map(agent => (
              <button
                key={agent.id}
                onClick={() => setPlayer1Id(agent.id)}
                disabled={agent.id === player2Id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-all text-xs ${player1Id === agent.id ? "bg-primary/10 border border-primary/30" : "bg-card border border-border hover:border-primary/20"} ${agent.id === player2Id ? "opacity-30 cursor-not-allowed" : ""}`}
              >
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0" style={{ backgroundColor: agent.color }}>
                  {agent.name[0]}
                </div>
                <span className="font-medium text-foreground text-xs">{agent.name}</span>
                <span className="text-muted-foreground/50 text-[10px] ml-auto">{agent.role.slice(0, 8)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border">
            <User className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs text-foreground">你自己</span>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] text-muted-foreground font-medium">VS</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Player 2 */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-5 h-5 rounded-full bg-foreground/10 flex items-center justify-center text-[10px] font-bold text-foreground">2</div>
          <span className="text-xs font-medium text-foreground">后手 ○</span>
          <div className="flex-1" />
          <button
            onClick={() => { setPlayer2IsAgent(!player2IsAgent); setPlayer2Id(null); }}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${player2IsAgent ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
          >
            {player2IsAgent ? "Agent" : "你"}
          </button>
        </div>

        {player2IsAgent ? (
          <div className="grid grid-cols-1 gap-1 max-h-32 overflow-y-auto">
            {agents.map(agent => (
              <button
                key={agent.id}
                onClick={() => setPlayer2Id(agent.id)}
                disabled={agent.id === player1Id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-all text-xs ${player2Id === agent.id ? "bg-primary/10 border border-primary/30" : "bg-card border border-border hover:border-primary/20"} ${agent.id === player1Id ? "opacity-30 cursor-not-allowed" : ""}`}
              >
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0" style={{ backgroundColor: agent.color }}>
                  {agent.name[0]}
                </div>
                <span className="font-medium text-foreground text-xs">{agent.name}</span>
                <span className="text-muted-foreground/50 text-[10px] ml-auto">{agent.role.slice(0, 8)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border">
            <User className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs text-foreground">你自己</span>
          </div>
        )}
      </div>

      <button
        onClick={() => {
          const p1Type = player1IsAgent ? "agent" : "user";
          const p2Type = player2IsAgent ? "agent" : "user";
          onStart(p1Type, player1Id, p2Type, player2Id);
        }}
        disabled={!canStart || loading}
        className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {loading ? "创建中..." : "开始游戏"}
      </button>
    </div>
  );
}
