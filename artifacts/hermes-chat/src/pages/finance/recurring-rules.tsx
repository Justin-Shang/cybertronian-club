// Finance 周期规则管理：NL 建规则（先 inactive 预览）+ CRUD + 手动触发 + 补录历史
import { useState } from "react";
import FinanceLayout from "./finance-layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Plus, Trash2, Play, History, Pause, CheckCircle2 } from "lucide-react";
import { API, type RecurringRule, FREQUENCIES, money, apiFetch } from "./shared";

export default function FinanceRecurring() {
  const qc = useQueryClient();
  const [nlText, setNlText] = useState("");
  const [pendingRule, setPendingRule] = useState<RecurringRule & { backfillSuggestion?: Array<{ date: string; amount: number }> } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [addForm, setAddForm] = useState({
    name: "", frequency: "monthly", day_of_month: "31", amount: "",
    category: "工资", target_table: "income", source: "", note: "",
  });

  const { data: rules } = useQuery<RecurringRule[]>({
    queryKey: ["finance-recurring-rules"],
    queryFn: async () => (await fetch(API + "/recurring-rules")).json(),
  });

  // NL 解析：创建一条 inactive 规则作为预览（用户可激活/删除）
  const parseMut = useMutation({
    mutationFn: (text: string) =>
      apiFetch<RecurringRule & { backfillSuggestion?: Array<{ date: string; amount: number }> }>("/recurring-rules", {
        method: "POST",
        body: JSON.stringify({ text, rule: { active: false, start_date: startDate || new Date().toISOString().slice(0, 10) } }),
      }),
    onSuccess: (data) => { setPendingRule(data); qc.invalidateQueries({ queryKey: ["finance-recurring-rules"] }); },
  });

  const activateMut = useMutation({
    mutationFn: (id: number) => apiFetch("/recurring-rules/" + id, { method: "PUT", body: JSON.stringify({ active: true }) }),
    onSuccess: () => { setPendingRule(null); setNlText(""); qc.invalidateQueries({ queryKey: ["finance-recurring-rules"] }); qc.invalidateQueries({ queryKey: ["finance-overview"] }); },
  });

  const createMut = useMutation({
    mutationFn: (f: typeof addForm) =>
      apiFetch("/recurring-rules", {
        method: "POST",
        body: JSON.stringify({
          rule: {
            name: f.name, frequency: f.frequency, day_of_month: Number(f.day_of_month) || null,
            amount: Number(f.amount), category: f.category, target_table: f.target_table,
            source: f.source, note: f.note, start_date: startDate || new Date().toISOString().slice(0, 10),
          },
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-recurring-rules"] });
      qc.invalidateQueries({ queryKey: ["finance-overview"] });
      setShowAdd(false);
      setAddForm({ name: "", frequency: "monthly", day_of_month: "31", amount: "", category: "工资", target_table: "income", source: "", note: "" });
    },
  });

  const toggleActive = useMutation({
    mutationFn: (r: RecurringRule) => apiFetch("/recurring-rules/" + r.id, { method: "PUT", body: JSON.stringify({ active: !r.active }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["finance-recurring-rules"] }); qc.invalidateQueries({ queryKey: ["finance-overview"] }); },
  });

  const runMut = useMutation({
    mutationFn: (id: number) => apiFetch("/recurring-rules/" + id + "/run", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["finance-recurring-rules"] }); qc.invalidateQueries({ queryKey: ["finance-income"] }); qc.invalidateQueries({ queryKey: ["finance-expense"] }); qc.invalidateQueries({ queryKey: ["finance-overview"] }); },
  });

  const backfillMut = useMutation({
    mutationFn: (id: number) => apiFetch("/recurring-rules/" + id + "/backfill", { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["finance-income"] }); qc.invalidateQueries({ queryKey: ["finance-expense"] }); qc.invalidateQueries({ queryKey: ["finance-overview"] }); },
  });

  const delMut = useMutation({
    mutationFn: (id: number) => apiFetch("/recurring-rules/" + id, { method: "DELETE" }),
    onSuccess: () => { setPendingRule(null); qc.invalidateQueries({ queryKey: ["finance-recurring-rules"] }); qc.invalidateQueries({ queryKey: ["finance-overview"] }); },
  });

  return (
    <FinanceLayout>
      <div className="p-6 space-y-4">
        <h1 className="text-xl font-bold">周期规则</h1>

        {/* NL 建规则 */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">自然语言建规则</span>
          </div>
          <div className="flex gap-2">
            <Input value={nlText} onChange={(e) => setNlText(e.target.value)} placeholder="如：每月31号发工资8万" onKeyDown={(e) => { if (e.key === "Enter" && nlText) parseMut.mutate(nlText); }} />
            <Button onClick={() => nlText && parseMut.mutate(nlText)} disabled={parseMut.isPending}>解析</Button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">生效起始日（可改，早于今天会提示补录）：</span>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-7 w-40" />
          </div>
          {pendingRule && (
            <div className="mt-3 p-3 rounded-md bg-muted/50 space-y-2">
              <div className="text-sm">
                ✓ 已解析并创建（暂停状态）：<span className="font-medium">{pendingRule.name}</span> ·{" "}
                {pendingRule.frequency}{pendingRule.dayOfMonth ? ` ${pendingRule.dayOfMonth}号` : ""} ·{" "}
                {money(pendingRule.amount)} ·{" "}
                {pendingRule.targetTable}
              </div>
              {pendingRule.backfillSuggestion && pendingRule.backfillSuggestion.length > 0 && (
                <div className="text-xs text-amber-600">
                  可补录 {pendingRule.backfillSuggestion.length} 期历史（{pendingRule.backfillSuggestion[0].date} ~ {pendingRule.backfillSuggestion[pendingRule.backfillSuggestion.length - 1].date}）
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={() => activateMut.mutate(pendingRule.id)} disabled={activateMut.isPending}>
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />激活规则
                </Button>
                {pendingRule.backfillSuggestion && pendingRule.backfillSuggestion.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => backfillMut.mutate(pendingRule.id)} disabled={backfillMut.isPending}>
                    <History className="w-3.5 h-3.5 mr-1" />补录 {pendingRule.backfillSuggestion.length} 期
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => delMut.mutate(pendingRule.id)}>删除</Button>
                <Button size="sm" variant="ghost" onClick={() => setPendingRule(null)}>关闭</Button>
              </div>
            </div>
          )}
        </Card>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{(rules || []).length} 条规则</span>
          <Button size="sm" onClick={() => setShowAdd(!showAdd)}><Plus className="w-4 h-4" />手动新增</Button>
        </div>

        {showAdd && (
          <Card className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="规则名" />
              <select value={addForm.frequency} onChange={(e) => setAddForm({ ...addForm, frequency: e.target.value })} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <Input type="number" value={addForm.day_of_month} onChange={(e) => setAddForm({ ...addForm, day_of_month: e.target.value })} placeholder="每月几号(1-31)" />
              <Input type="number" value={addForm.amount} onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })} placeholder="金额" />
              <Input value={addForm.category} onChange={(e) => setAddForm({ ...addForm, category: e.target.value })} placeholder="分类" />
              <select value={addForm.target_table} onChange={(e) => setAddForm({ ...addForm, target_table: e.target.value })} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="income">收入</option>
                <option value="expense">支出</option>
              </select>
              <Input value={addForm.source} onChange={(e) => setAddForm({ ...addForm, source: e.target.value })} placeholder="来源" />
              <Input value={addForm.note} onChange={(e) => setAddForm({ ...addForm, note: e.target.value })} placeholder="备注" />
            </div>
            <div className="flex gap-2 mt-2 items-center">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="生效起始日" className="w-44" />
              <Button size="sm" onClick={() => createMut.mutate(addForm)} disabled={createMut.isPending || !addForm.amount}>保存</Button>
            </div>
          </Card>
        )}

        {/* 规则列表 */}
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2">规则名</th>
                <th className="text-left p-2">频率</th>
                <th className="text-right p-2">金额</th>
                <th className="text-left p-2">分类</th>
                <th className="text-left p-2">下次入账</th>
                <th className="text-left p-2">状态</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {(rules || []).map((r) => (
                <tr key={r.id} className="border-t border-border/50 hover:bg-muted/30">
                  <td className="p-2 font-medium">{r.name}</td>
                  <td className="p-2"><Badge variant="secondary">{r.frequency}{r.dayOfMonth ? ` ${r.dayOfMonth}号` : ""}</Badge></td>
                  <td className="p-2 text-right font-medium text-emerald-600">{money(r.amount)}</td>
                  <td className="p-2">{r.category || "—"}</td>
                  <td className="p-2 text-muted-foreground">{r.nextRunDate}</td>
                  <td className="p-2">
                    {r.active ? <Badge className="bg-emerald-500/15 text-emerald-600">启用</Badge> : <Badge variant="secondary">暂停</Badge>}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" title={r.active ? "暂停" : "启用"} onClick={() => toggleActive.mutate(r)}>
                      {r.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 text-blue-500" />}
                    </Button>
                    <Button size="sm" variant="ghost" title="手动触发一次" onClick={() => runMut.mutate(r.id)} disabled={runMut.isPending}>
                      <Play className="w-3.5 h-3.5 text-emerald-500" />
                    </Button>
                    <Button size="sm" variant="ghost" title="补录历史" onClick={() => backfillMut.mutate(r.id)} disabled={backfillMut.isPending}>
                      <History className="w-3.5 h-3.5 text-amber-500" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => delMut.mutate(r.id)}>
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </Button>
                  </td>
                </tr>
              ))}
              {(rules || []).length === 0 && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">暂无周期规则</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
    </FinanceLayout>
  );
}
