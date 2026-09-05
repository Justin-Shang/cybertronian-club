// Finance 收入页：NL 录入 + 表格 CRUD + 筛选
import { useState } from "react";
import FinanceLayout from "./finance-layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Plus, Trash2, Search } from "lucide-react";
import { API, type Income, INCOME_CATEGORIES, money, apiFetch } from "./shared";

export default function FinanceIncome() {
  const qc = useQueryClient();
  const [nlText, setNlText] = useState("");
  const [nlResult, setNlResult] = useState<{ fields: Record<string, unknown>; confirm_token: string; warnings: string[] } | null>(null);
  const [filter, setFilter] = useState({ from: "", to: "", category: "", q: "" });
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ tx_date: "", amount: "", category: "工资", source: "", note: "" });

  const queryStr = new URLSearchParams(Object.entries(filter).filter(([, v]) => v).map(([k, v]) => [k, v])).toString();
  const { data: rows } = useQuery<Income[]>({
    queryKey: ["finance-income", filter],
    queryFn: async () => (await fetch(API + "/income?" + queryStr)).json(),
  });

  const nlParse = useMutation({
    mutationFn: (text: string) => apiFetch<{ fields: Record<string, unknown>; confirm_token: string; warnings: string[] }>("/nl", { method: "POST", body: JSON.stringify({ text }) }),
    onSuccess: setNlResult,
  });
  const nlConfirm = useMutation({
    mutationFn: (token: string) => apiFetch("/nl/confirm", { method: "POST", body: JSON.stringify({ confirm_token: token }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["finance-income"] }); qc.invalidateQueries({ queryKey: ["finance-overview"] }); setNlResult(null); setNlText(""); },
  });
  const addMut = useMutation({
    mutationFn: (f: typeof addForm) => apiFetch("/income", { method: "POST", body: JSON.stringify(f) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["finance-income"] }); qc.invalidateQueries({ queryKey: ["finance-overview"] }); setShowAdd(false); setAddForm({ tx_date: "", amount: "", category: "工资", source: "", note: "" }); },
  });
  const delMut = useMutation({
    mutationFn: (id: number) => apiFetch("/income/" + id, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["finance-income"] }); qc.invalidateQueries({ queryKey: ["finance-overview"] }); },
  });

  return (
    <FinanceLayout>
      <div className="p-6 space-y-4">
        <h1 className="text-xl font-bold">收入明细</h1>

        {/* NL 录入 */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">自然语言记账</span>
          </div>
          <div className="flex gap-2">
            <Input value={nlText} onChange={(e) => setNlText(e.target.value)} placeholder="如：8月3号发工资8万" onKeyDown={(e) => { if (e.key === "Enter" && nlText) nlParse.mutate(nlText); }} />
            <Button onClick={() => nlText && nlParse.mutate(nlText)} disabled={nlParse.isPending}>解析</Button>
          </div>
          {nlResult && (
            <div className="mt-3 p-3 rounded-md bg-muted/50 space-y-2">
              <div className="text-sm">已识别：{String(nlResult.fields.category || "")} · {money(Number(nlResult.fields.amount) || 0)} · {String(nlResult.fields.tx_date || "")}</div>
              {nlResult.warnings.length > 0 && <div className="text-xs text-amber-600">{nlResult.warnings.join("；")}</div>}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => nlConfirm.mutate(nlResult.confirm_token)} disabled={nlConfirm.isPending}>确认入库</Button>
                <Button size="sm" variant="outline" onClick={() => setNlResult(null)}>取消</Button>
              </div>
            </div>
          )}
        </Card>

        {/* 筛选 + 新增 */}
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} className="w-40" />
          <Input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} className="w-40" />
          <select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">全部分类</option>
            {INCOME_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <Input value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="搜索备注/来源" className="w-44" />
          <Button variant="outline" size="sm" onClick={() => setFilter({ from: "", to: "", category: "", q: "" })}><Search className="w-4 h-4" />清空</Button>
          <Button size="sm" onClick={() => setShowAdd(!showAdd)} className="ml-auto"><Plus className="w-4 h-4" />手动新增</Button>
        </div>

        {showAdd && (
          <Card className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <Input type="date" value={addForm.tx_date} onChange={(e) => setAddForm({ ...addForm, tx_date: e.target.value })} placeholder="日期" />
              <Input type="number" value={addForm.amount} onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })} placeholder="金额" />
              <select value={addForm.category} onChange={(e) => setAddForm({ ...addForm, category: e.target.value })} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                {INCOME_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <Input value={addForm.source} onChange={(e) => setAddForm({ ...addForm, source: e.target.value })} placeholder="来源" />
              <Input value={addForm.note} onChange={(e) => setAddForm({ ...addForm, note: e.target.value })} placeholder="备注" />
            </div>
            <Button className="mt-2" size="sm" onClick={() => addMut.mutate(addForm)} disabled={addMut.isPending || !addForm.amount}>保存</Button>
          </Card>
        )}

        {/* 表格 */}
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2">日期</th>
                <th className="text-right p-2">金额</th>
                <th className="text-left p-2">分类</th>
                <th className="text-left p-2">来源</th>
                <th className="text-left p-2">备注</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {(rows || []).map((r) => (
                <tr key={r.id} className="border-t border-border/50 hover:bg-muted/30">
                  <td className="p-2">{r.txDate}</td>
                  <td className="p-2 text-right font-medium text-emerald-600">{money(r.amount)}</td>
                  <td className="p-2"><Badge variant="secondary">{r.category}</Badge>{r.generated && <span className="ml-1 text-xs text-muted-foreground">自动</span>}</td>
                  <td className="p-2 text-muted-foreground">{r.source || "—"}</td>
                  <td className="p-2 text-muted-foreground">{r.note || "—"}</td>
                  <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => delMut.mutate(r.id)}><Trash2 className="w-3.5 h-3.5 text-red-500" /></Button></td>
                </tr>
              ))}
              {(rows || []).length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">暂无收入记录</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
    </FinanceLayout>
  );
}
