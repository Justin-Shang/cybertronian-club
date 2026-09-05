// Finance 智能查询：NL 问题 → SQL 生成执行 → LLM 转述 + raw_data
import { useState } from "react";
import FinanceLayout from "./finance-layout";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Search, Download, AlertTriangle, Database, Bot } from "lucide-react";
import { API, apiFetch } from "./shared";

interface QueryResult {
  answer: string;
  rows: Array<Record<string, unknown>>;
  raw_data?: Array<Record<string, unknown>>;
  is_safe: boolean;
  sql?: string;
  narration_hint?: string;
  caller?: string;
}

const SAMPLE_QUESTIONS = [
  "今年总共收入多少？",
  "今年各类支出占比多少？",
  "最近 6 个月平均月支出是多少？",
  "净资产最新快照是多少？",
  "教育基金累计存入多少？",
  "今年大额支出有哪些？",
  "近 3 年每年结余多少？",
];

export default function FinanceNLQuery() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [history, setHistory] = useState<Array<{ q: string; r: QueryResult }> | null>(null);
  const [agentMode, setAgentMode] = useState(false);

  const queryMut = useMutation({
    mutationFn: (q: string) => apiFetch<QueryResult>("/query", { method: "POST", body: JSON.stringify({ question: q, caller: agentMode ? "agent" : "user" }) }),
    onSuccess: (r) => { setResult(r); setHistory((h) => [{ q: question, r }, ...(h || [])].slice(0, 10)); },
  });

  const exportMut = useMutation({
    mutationFn: async (rows: Array<Record<string, unknown>>) => {
      const res = await fetch(API + "/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: "income", query: result?.sql }),
      });
      if (!res.ok) throw new Error("导出失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "query_result.csv";
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  return (
    <FinanceLayout>
      <div className="p-6 space-y-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Search className="w-5 h-5 text-primary" />
          智能查询
        </h1>
        <p className="text-sm text-muted-foreground">用自然语言提问，系统生成 SQL 查询真实数据并转述结果。数字 100% 来自数据库，不编造。</p>

        {/* Agent 模式开关 */}
        <Card className="p-3 flex items-center gap-3">
          <Bot className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm">Agent 模式</span>
          <button
            onClick={() => setAgentMode(!agentMode)}
            className={"relative w-10 h-5 rounded-full transition-colors " + (agentMode ? "bg-primary" : "bg-muted")}
          >
            <span className={"absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform " + (agentMode ? "translate-x-5" : "translate-x-0.5")} />
          </button>
          <span className="text-xs text-muted-foreground">
            {agentMode ? "启用：返回 raw_data 数组供 agent 二次推理" : "关闭：仅返回自然语言转述"}
          </span>
        </Card>

        {/* 问题输入 */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">你的问题</span>
          </div>
          <div className="flex gap-2">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="如：今年各类收入多少？"
              onKeyDown={(e) => { if (e.key === "Enter" && question) queryMut.mutate(question); }}
            />
            <Button onClick={() => question && queryMut.mutate(question)} disabled={queryMut.isPending}>查询</Button>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {SAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => { setQuestion(q); queryMut.mutate(q); }}
                className="text-xs px-2 py-1 rounded-md bg-muted hover:bg-accent text-muted-foreground transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </Card>

        {/* 查询结果 */}
        {result && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              {result.is_safe ? <Database className="w-4 h-4 text-emerald-500" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
              <span className="text-sm font-medium">查询结果</span>
              {result.caller === "agent" && <Badge className="bg-blue-500/15 text-blue-600"><Bot className="w-3 h-3 mr-1" />Agent</Badge>}
            </div>

            {!result.is_safe ? (
              <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 text-sm">
                {result.answer}
              </div>
            ) : (
              <>
                <div className="p-3 rounded-md bg-muted/50 text-sm leading-relaxed whitespace-pre-wrap">{result.answer}</div>

                {result.sql && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">查看 SQL</summary>
                    <pre className="mt-2 p-2 rounded bg-muted/50 overflow-x-auto text-xs">{result.sql}</pre>
                  </details>
                )}

                {result.rows && result.rows.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground">数据行（{result.rows.length}）</span>
                      <Button size="sm" variant="outline" onClick={() => exportMut.mutate(result.rows)} disabled={exportMut.isPending}>
                        <Download className="w-3.5 h-3.5 mr-1" />导出 CSV
                      </Button>
                    </div>
                    <div className="overflow-x-auto max-h-80">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>{Object.keys(result.rows[0]).map((k) => <th key={k} className="text-left p-2">{k}</th>)}</tr>
                        </thead>
                        <tbody>
                          {result.rows.slice(0, 100).map((r, i) => (
                            <tr key={i} className="border-t border-border/50">
                              {Object.values(r).map((v, j) => <td key={j} className="p-2">{String(v ?? "")}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {result.raw_data && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">raw_data（agent 二次推理用，{result.raw_data.length} 行）</summary>
                    <pre className="mt-2 p-2 rounded bg-muted/50 overflow-x-auto text-xs max-h-60">{JSON.stringify(result.raw_data, null, 2)}</pre>
                  </details>
                )}
              </>
            )}
          </Card>
        )}

        {/* 历史记录 */}
        {history && history.length > 0 && (
          <Card className="p-4">
            <h3 className="font-semibold mb-2 text-sm">最近查询</h3>
            <div className="space-y-1">
              {history.map((h, i) => (
                <div key={i} className="text-xs flex items-start gap-2 py-1 border-b border-border/30 last:border-0">
                  <span className="text-muted-foreground shrink-0">Q:</span>
                  <span className="flex-1">{h.q}</span>
                  <span className="text-muted-foreground shrink-0 max-w-md truncate">{h.r.answer.slice(0, 60)}...</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </FinanceLayout>
  );
}
