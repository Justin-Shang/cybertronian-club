// Finance 债务明细页
import { useState } from "react";
import FinanceLayout from "./finance-layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { API, type Debt, DEBT_DIRECTIONS, money, apiFetch } from "./shared";

export default function FinanceDebt() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ tx_date: "", amount: "", direction: "借入", lender: "", interest_rate: "", due_date: "", note: "" });
  const { data: rows } = useQuery<Debt[]>({ queryKey: ["finance-debt"], queryFn: async () => (await fetch(API + "/debt")).json() });
  const addMut = useMutation({
    mutationFn: (f: typeof form) => apiFetch("/debt", { method: "POST", body: JSON.stringify(f) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["finance-debt"] }); setShowAdd(false); setForm({ tx_date: "", amount: "", direction: "借入", lender: "", interest_rate: "", due_date: "", note: "" }); },
  });
  const delMut = useMutation({ mutationFn: (id: number) => apiFetch("/debt/" + id, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-debt"] }) });

  const borrowed = (rows || []).filter((r) => r.direction === "借入").reduce((s, r) => s + r.amount, 0);
  const repaid = (rows || []).filter((r) => r.direction === "还款").reduce((s, r) => s + r.amount, 0);
  const balance = borrowed - repaid;

  return (
    <FinanceLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between"><h1 className="text-xl font-bold">债务明细</h1><Button size="sm" onClick={() => setShowAdd(!showAdd)}><Plus className="w-4 h-4" />新增</Button></div>
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-4"><div className="text-xs text-muted-foreground">累计借入</div><div className="text-xl font-bold mt-1 text-red-600">{money(borrowed)}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">累计还款</div><div className="text-xl font-bold mt-1 text-emerald-600">{money(repaid)}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">当前余额</div><div className="text-xl font-bold mt-1">{money(balance)}</div></Card>
        </div>
        {showAdd && (
          <Card className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Input type="date" value={form.tx_date} onChange={(e) => setForm({ ...form, tx_date: e.target.value })} />
              <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="金额" />
              <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} className="h-9 rounded-md border border-input bg-background px-3 text-sm">{DEBT_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
              <Input value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} placeholder="债权人" />
              <Input type="number" value={form.interest_rate} onChange={(e) => setForm({ ...form, interest_rate: e.target.value })} placeholder="利率%" />
              <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} placeholder="到期日" />
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="备注" />
            </div>
            <Button className="mt-2" size="sm" onClick={() => addMut.mutate(form)} disabled={addMut.isPending || !form.amount}>保存</Button>
          </Card>
        )}
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr><th className="text-left p-2">日期</th><th className="text-right p-2">金额</th><th className="text-left p-2">方向</th><th className="text-left p-2">债权人</th><th className="text-right p-2">利率</th><th className="text-left p-2">到期日</th><th className="text-left p-2">备注</th><th className="p-2"></th></tr></thead>
            <tbody>
              {(rows || []).map((r) => (
                <tr key={r.id} className="border-t border-border/50 hover:bg-muted/30">
                  <td className="p-2">{r.txDate}</td>
                  <td className="p-2 text-right font-medium">{money(r.amount)}</td>
                  <td className="p-2"><Badge variant={r.direction === "还款" ? "secondary" : "destructive"}>{r.direction}</Badge></td>
                  <td className="p-2">{r.lender || "—"}</td>
                  <td className="p-2 text-right text-muted-foreground">{r.interestRate ? r.interestRate + "%" : "—"}</td>
                  <td className="p-2 text-muted-foreground">{r.dueDate || "—"}</td>
                  <td className="p-2 text-muted-foreground">{r.note || "—"}</td>
                  <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => delMut.mutate(r.id)}><Trash2 className="w-3.5 h-3.5 text-red-500" /></Button></td>
                </tr>
              ))}
              {(rows || []).length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">暂无债务记录</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
    </FinanceLayout>
  );
}
