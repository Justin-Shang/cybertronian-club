import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, Lightbulb, Check, X, Shuffle } from "lucide-react";
import Layout from "@/components/layout";
import { useListAgents } from "@workspace/api-client-react";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function rankToNum(rank: string): number {
  if (rank === "A") return 1;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  return parseInt(rank);
}

function randomCard(): { rank: string; suit: string; value: number } {
  const rank = RANKS[Math.floor(Math.random() * 13)];
  const suit = SUITS[Math.floor(Math.random() * 4)];
  return { rank, suit, value: rankToNum(rank) };
}

function safeEval(expr: string, numbers: number[]): number | null {
  // Only allow digits, operators, spaces, parentheses
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return null;

  // Extract numbers used
  const used = (expr.match(/\d+/g) ?? []).map(Number);
  const sorted = [...used].sort((a, b) => a - b);
  const expected = [...numbers].sort((a, b) => a - b);
  if (JSON.stringify(sorted) !== JSON.stringify(expected)) return null;

  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expr})`)();
    return typeof result === "number" ? result : null;
  } catch {
    return null;
  }
}

function Card({ rank, suit, flipped }: { rank: string; suit: string; flipped?: boolean }) {
  const isRed = suit === "♥" || suit === "♦";
  return (
    <div className={`w-20 h-28 rounded-xl border-2 flex flex-col items-center justify-center font-bold select-none shadow-md transition-all ${flipped ? "bg-muted border-border" : "bg-white border-gray-200"}`}>
      {flipped ? (
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
          <span className="text-primary text-sm">?</span>
        </div>
      ) : (
        <>
          <span className={`text-2xl font-black ${isRed ? "text-red-500" : "text-gray-900"}`}>{rank}</span>
          <span className={`text-xl ${isRed ? "text-red-500" : "text-gray-900"}`}>{suit}</span>
        </>
      )}
    </div>
  );
}

export default function TwentyFourPage() {
  const [, setLocation] = useLocation();
  const { data: agents } = useListAgents();

  const [cards, setCards] = useState(() => Array.from({ length: 4 }, randomCard));
  const [expression, setExpression] = useState("");
  const [result, setResult] = useState<"correct" | "wrong" | "invalid" | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<number | "">("");
  const [score, setScore] = useState({ solved: 0, skipped: 0 });
  const [showHint, setShowHint] = useState(false);

  const deal = useCallback(() => {
    setCards(Array.from({ length: 4 }, randomCard));
    setExpression("");
    setResult(null);
    setHint(null);
    setShowHint(false);
  }, []);

  const check = () => {
    const nums = cards.map(c => c.value);
    const val = safeEval(expression, nums);
    if (val === null) {
      setResult("invalid");
      return;
    }
    if (Math.abs(val - 24) < 1e-9) {
      setResult("correct");
      setScore(s => ({ ...s, solved: s.solved + 1 }));
      toast.success("正确！🎉");
    } else {
      setResult("wrong");
    }
  };

  const getHint = async () => {
    setHintLoading(true);
    setShowHint(false);
    try {
      const res = await fetch("/api/games/twentyfour/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numbers: cards.map(c => c.value), agentId: selectedAgentId || undefined }),
      });
      const data = await res.json() as { hint?: string; error?: string };
      setHint(data.hint ?? "无解");
      setShowHint(true);
    } catch {
      toast.error("获取提示失败");
    } finally {
      setHintLoading(false);
    }
  };

  const skip = () => {
    setScore(s => ({ ...s, skipped: s.skipped + 1 }));
    deal();
  };

  const numbers = cards.map(c => c.value);

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
              <h1 className="text-base font-semibold text-foreground">24 点</h1>
              <p className="text-xs text-muted-foreground">用四张牌的数字凑出 24</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={selectedAgentId}
              onChange={e => setSelectedAgentId(e.target.value ? Number(e.target.value) : "")}
              className="text-xs bg-muted border border-border rounded-lg px-2 py-1.5 text-foreground focus:outline-none"
            >
              <option value="">内置 AI 提示</option>
              {agents?.map(a => <option key={a.id} value={a.id}>{a.name} 提示</option>)}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-auto flex flex-col items-center justify-center p-6 gap-8">
          {/* Score */}
          <div className="flex gap-6 text-center">
            <div>
              <p className="text-2xl font-bold text-emerald-400">{score.solved}</p>
              <p className="text-xs text-muted-foreground">已解决</p>
            </div>
            <div className="w-px bg-border" />
            <div>
              <p className="text-2xl font-bold text-muted-foreground">{score.skipped}</p>
              <p className="text-xs text-muted-foreground">已跳过</p>
            </div>
          </div>

          {/* Cards */}
          <div className="flex gap-4">
            {cards.map((card, i) => (
              <Card key={i} rank={card.rank} suit={card.suit} />
            ))}
          </div>

          <p className="text-sm text-muted-foreground">数字: <span className="font-mono font-bold text-foreground">{numbers.join("  ")}</span></p>

          {/* Input */}
          <div className="w-full max-w-sm space-y-3">
            <div className="relative">
              <input
                data-testid="input-expression"
                className="w-full px-4 py-3 bg-muted border border-border rounded-xl text-foreground font-mono text-lg text-center focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/40"
                placeholder="例: (13 - 1) * 2"
                value={expression}
                onChange={e => { setExpression(e.target.value); setResult(null); }}
                onKeyDown={e => e.key === "Enter" && check()}
              />
              {result && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {result === "correct" ? <Check className="w-5 h-5 text-emerald-400" /> : <X className="w-5 h-5 text-red-400" />}
                </div>
              )}
            </div>

            {result === "wrong" && (
              <p className="text-xs text-red-400 text-center">
                结果不是 24，再试试！
              </p>
            )}
            {result === "invalid" && (
              <p className="text-xs text-amber-400 text-center">
                表达式无效，请只使用这四个数字和 + - * / ()
              </p>
            )}
            {result === "correct" && (
              <div className="text-center">
                <p className="text-emerald-400 text-sm font-medium">✓ 正确！</p>
                <button onClick={deal} className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:opacity-90 transition-opacity">下一题</button>
              </div>
            )}

            {result !== "correct" && (
              <div className="flex gap-2">
                <button
                  data-testid="button-check"
                  onClick={check}
                  disabled={!expression.trim()}
                  className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  验证
                </button>
                <button
                  data-testid="button-hint"
                  onClick={getHint}
                  disabled={hintLoading}
                  title="让 AI 给个提示"
                  className="flex items-center gap-1.5 px-3 py-2.5 bg-muted hover:bg-accent text-muted-foreground hover:text-foreground rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  <Lightbulb className="w-4 h-4" />
                  {hintLoading ? "想中…" : "提示"}
                </button>
                <button
                  data-testid="button-skip"
                  onClick={skip}
                  title="跳过这题"
                  className="px-3 py-2.5 bg-muted hover:bg-accent text-muted-foreground hover:text-foreground rounded-lg text-sm transition-colors"
                >
                  <Shuffle className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Hint reveal */}
          {showHint && hint && (
            <div className="w-full max-w-sm p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-center">
              <p className="text-xs text-amber-400 font-medium mb-1 flex items-center justify-center gap-1">
                <Lightbulb className="w-3.5 h-3.5" />AI 提示
              </p>
              <p className="text-sm font-mono text-foreground">{hint}</p>
            </div>
          )}

          {/* Tip */}
          <p className="text-xs text-muted-foreground/50 text-center max-w-xs leading-relaxed">
            A=1, J=11, Q=12, K=13 · 输入数学表达式，按 Enter 或点「验证」
          </p>
        </div>
      </div>
    </Layout>
  );
}
