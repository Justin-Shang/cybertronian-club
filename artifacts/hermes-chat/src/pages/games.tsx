import { useLocation } from "wouter";
import { Gamepad2, CircleDot, Hash, Clock } from "lucide-react";
import Layout from "@/components/layout";

const GAMES = [
  {
    id: "gobang",
    title: "五子棋",
    subtitle: "Gobang",
    description: "与 AI 对弈。先连成五子者胜。",
    icon: CircleDot,
    color: "#6366f1",
    status: "ready" as const,
    path: "/games/gobang",
  },
  {
    id: "twentyfour",
    title: "24 点",
    subtitle: "24 Points",
    description: "用4张牌，通过加减乘除凑出 24。",
    icon: Hash,
    color: "#f59e0b",
    status: "ready" as const,
    path: "/games/twentyfour",
  },
  {
    id: "chess",
    title: "中国象棋",
    subtitle: "Chinese Chess",
    description: "经典棋局，与 AI 博弈。",
    icon: Gamepad2,
    color: "#ef4444",
    status: "soon" as const,
    path: "/games/chess",
  },
  {
    id: "landlord",
    title: "斗地主",
    subtitle: "Landlord",
    description: "三人斗地主，两个 AI 陪你玩。",
    icon: Clock,
    color: "#10b981",
    status: "soon" as const,
    path: "/games/landlord",
  },
];

export default function GamesPage() {
  const [, setLocation] = useLocation();

  return (
    <Layout>
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Gamepad2 className="w-5 h-5 text-primary" />游戏大厅
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">与 Hermes Agent 对战，展示你的策略</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 max-w-4xl">
            {GAMES.map(game => {
              const Icon = game.icon;
              const ready = game.status === "ready";
              return (
                <button
                  key={game.id}
                  data-testid={`game-card-${game.id}`}
                  onClick={() => ready && setLocation(game.path)}
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
                      开始游戏 →
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Layout>
  );
}
