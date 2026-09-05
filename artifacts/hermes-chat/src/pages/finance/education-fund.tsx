// Finance 教育基金页（按 child_name 分组）
import { useState } from "react";
import FinanceLayout from "./finance-layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { API, type EducationFund, EDUCATION_DIRECTIONS, money, apiFetch } from "./shared";

export default function FinanceEducationFund() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ tx_date: "", amount: "", direction: "存入", child_name: "大宝", note: "" });
  const { data: rows } = useQuery<EducationFund[]>({ queryKey: ["finance-edu"], queryFn: async () => (await fetch(API + "/education-fund")).json() });
  const addMut = useMutation({
    mutationFn: (f: typeof form) => apiFetch("/education-fund", { method: "POST", body: JSON.stringify(f) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["finance-edu"] }); setShowAdd(false); setForm({ tx_date: "", amount: "", direction: "存入", child_name: "大宝", note: "" }); },
  });
  const delMut = useMutation({ mutationFn: (id: number) => apiFetch("/education-fund/" + id, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-edu"] }) });

  const grouped = (rows || []).reduce((acc, r) => { (acc[r.childName] = acc[r.childName] || []).push(r); return acc; }, {} as Record<string, EducationFund[]>);
  const totals = Object.entries(grouped).map(([name, items]) => ({
    name, balance: items.reduce((s, r) => s + (r.direction === "存入" || r.direction === "收益" ? r.amount : -r.amount), 0), count: items.length,
  }));

  return (
    <FinanceLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between"><h1 className="text-xl font-bold">教育基金</h1><Button size="sm" onClick={() => setShowAdd(!showAdd)}><Plus className="w-4 h-4" />新增</Button></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {totals.map((t) => (
            <Card key={t.name} className="p-4"><div className="text-xs text-muted-foreground">{t.name}</div><div className="text-xl font-bold mt-1">{money(t.balance)}</div><div className="text-xs text-muted-foreground mt-0.5">{t.count} 笔记录</div></Card>
          ))}
          {totals.length === 0 && <div className="text-sm text-muted-foreground col-span-4 py-4 text-center">暂无教育基金记录</div>}
        </div>
        {showAdd && (
          <Card className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <Input type="date" value={form.tx_date} onChange={(e) => setForm({ ...form, tx_date: e.target.value })} />
              <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="金额" />
              <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} className="h-9 rounded-md border border-input bg-background px-3 text-sm">{EDUCATION_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
              <Input value={form.child_name} onChange={(e) => setForm({ ...form, child_name: e.target.value })} placeholder="孩子" />
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="备注" />
            </div>
            <Button className="mt-2" size="sm" onClick={() => addMut.mutate(form)} disabled={addMut.isPending || !form.amount}>保存</Button>
          </Card>
        )}
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr><th className="text-left p-2">日期</th><th className="text-right p-2">金额</th><th className="text-left p-2">方向</th><th className="text-left p-2">孩子</th><th className="text-left p-2">备注</th><th className="p-2"></th></tr></thead>
            <tbody>
              {(rows || []).map((r) => (
                <tr key={r.id} className="border-t border-border/50 hover:bg-muted/30">
                  <td className="p-2">{r.txDate}</td>
                  <td className="p-2 text-right font-medium">{money(r.amount)}</td>
                  <td className="p-2"><Badge variant={r.direction === "取出" ? "destructive" : "secondary"}>{r.direction}</Badge></td>
                  <td className="p-2">{r.childName}</td>
                  <td className="p-2 text-muted-foreground">{r.note || "—"}</td>
                  <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => delMut.mutate(r.id)}><Trash2 className="w-3.5 h-3.5 text-red-500" /></Button></td>
                </tr>
              ))}
              {(rows || []).length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">暂无记录</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
    </FinanceLayout>
  );
}
