// StatPilot 总览页 — AI 问答 + 功能入口
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Trophy, Shield, Dribbble, Search } from "lucide-react";
import StatpilotLayout from "./statpilot-layout";
import { API, type AskResult } from "./shared";

const QUICK_ENTRIES = [
  { href: "/statpilot/nba", icon: Trophy, title: "NBA 球员分析", desc: "投篮构成、赛季统计、单场赛后报告", color: "text-orange-500" },
  { href: "/statpilot/nfl", icon: Shield, title: "NFL 数据分析", desc: "EPA 贡献、接球方向分布、单场复盘", color: "text-green-600" },
];

const EXAMPLES = [
  "文班亚马这赛季投篮怎么样？",
  "东契奇场均数据如何？",
  "库里三分命中率多少？",
];

export default function StatpilotHome() {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (q?: string) => {
    const text = (q ?? question).trim();
    if (!text || asking) return;
    setAsking(true);
    setError(null);
    try {
      const res = await fetch(API + "/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error((err && err.detail) || "分析失败");
      }
      setResult((await res.json()) as AskResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
    }
  };

  return (
    <StatpilotLayout>
      <div className="p-6 space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Dribbble className="w-6 h-6 text-primary" />
            StatPilot · 体育数据分析
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI 原生体育数据分析 — 中文提问，自动拉数据、算高阶指标、出图出报告
          </p>
        </div>

        {/* AI 问答 */}
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">自然语言提问</div>
          <div className="flex gap-2">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask()}
              placeholder="例：文班亚马这赛季投篮怎么样？"
              className="flex-1"
            />
            <Button onClick={() => ask()} disabled={asking}>
              {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {asking ? "分析中" : "提问"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => { setQuestion(ex); ask(ex); }}
                className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground hover:bg-primary/15 hover:text-primary transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        </Card>

        {error && (
          <Card className="p-4 border-red-500/50">
            <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
          </Card>
        )}

        {result && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className="text-xs">分析结果</Badge>
              {result.chartBase64 && <Badge className="text-xs bg-primary/15 text-primary">含图表</Badge>}
            </div>
            {result.chartBase64 && (
              <img
                src={"data:image/png;base64," + result.chartBase64}
                alt="分析图表"
                className="rounded-lg border border-border mb-3 w-full"
              />
            )}
            <div className="text-sm whitespace-pre-wrap leading-relaxed">{result.answer}</div>
          </Card>
        )}

        {/* 功能入口 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {QUICK_ENTRIES.map((e) => (
            <Link key={e.href} href={e.href}>
              <Card className="p-4 hover:border-primary/50 transition-colors cursor-pointer">
                <div className="flex items-start gap-3">
                  <e.icon className={"w-8 h-8 " + e.color} />
                  <div>
                    <div className="font-medium">{e.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{e.desc}</div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>

        <Card className="p-4 bg-muted/50">
          <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
            <div className="font-medium text-foreground">数据说明</div>
            <div>· NBA：ESPN 公开 API（2025-26 赛季数据）；NFL：nflverse 社区数据（2025 赛季）</div>
            <div>· 投篮热图坐标源（stats.nba.com）受反爬限制，MVP 提供投篮构成分析（三分/两分/罚球 + eFG/TS）</div>
            <div>· 输出基于真实数据，由 DeepSeek 生成中文解读</div>
          </div>
        </Card>
      </div>
    </StatpilotLayout>
  );
}
