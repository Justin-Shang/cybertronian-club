// Finance 资产负债快照页
import { useState } from "react";
import FinanceLayout from "./finance-layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { API, type NetWorth, money, pct, apiFetch } from "./shared";
import { NetWorthTrend } from "./components/Charts";

export default function FinanceNetWorth() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ snapshot_date: "", total_assets: "", total_liabilities: "", cash: "", investment: "", real_estate: "", other_assets: "", note: "" });
  const { data: rows } = useQuery<NetWorth[]>({ queryKey: ["finance-net-worth"], queryFn: async () => (await fetch(API + "/net-worth")).json() });
  const addMut = useMutation({
    mutationFn: (f: typeof form) => apiFetch("/net-worth", { method: "POST", body: JSON.stringify(f) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["finance-net-worth"] }); qc.invalidateQueries({ queryKey: ["finance-overview"] }); setShowAdd(false); setForm({ snapshot_date: "", total_assets: "", total_liabilities: "", cash: "", investment: "", real_estate: "", other_assets: "", note: "" }); },
  });
  const delMut = useMutation({ mutationFn: (id: number) => apiFetch("/net-worth/" + id, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["finance-net-worth"] }) });

  return (
    <FinanceLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">资产负债快照</h1>
          <Button size="sm" onClick={() => setShowAdd(!showAdd)}><Plus className="w-4 h-4" />新增快照</Button>
        </div>
        {(rows || []).length > 0 && (
          <Card className="p-4"><h3 className="font-semibold mb-2">净资产走势</h3><NetWorthTrend data={(rows || []).reverse().map((r) => ({ year: new Date(r.snapshotDate).getFullYear(), netAssets: r.netAssets }))} /></Card>
        )}
        {showAdd && (
          <Card className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Input type="date" value={form.snapshot_date} onChange={(e) => setForm({ ...form, snapshot_date: e.target.value })} placeholder="快照日期" />
              <Input type="number" value={form.total_assets} onChange={(e) => setForm({ ...form, total_assets: e.target.value })} placeholder="总资产" />
              <Input type="number" value={form.total_liabilities} onChange={(e) => setForm({ ...form, total_liabilities: e.target.value })} placeholder="总负债" />
              <Input type="number" value={form.cash} onChange={(e) => setForm({ ...form, cash: e.target.value })} placeholder="现金" />
              <Input type="number" value={form.investment} onChange={(e) => setForm({ ...form, investment: e.target.value })} placeholder="投资" />
              <Input type="number" value={form.real_estate} onChange={(e) => setForm({ ...form, real_estate: e.target.value })} placeholder="房产" />
              <Input type="number" value={form.other_assets} onChange={(e) => setForm({ ...form, other_assets: e.target.value })} placeholder="其他资产" />
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="备注" />
            </div>
            <Button className="mt-2" size="sm" onClick={() => addMut.mutate(form)} disabled={addMut.isPending || !form.snapshot_date || !form.total_assets}>保存</Button>
          </Card>
        )}
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr><th className="text-left p-2">日期</th><th className="text-right p-2">总资产</th><th className="text-right p-2">总负债</th><th className="text-right p-2">净资产</th><th className="text-right p-2">现金</th><th className="text-right p-2">投资</th><th className="text-right p-2">房产</th><th className="p-2"></th></tr></thead>
            <tbody>
              {(rows || []).map((r) => (
                <tr key={r.id} className="border-t border-border/50 hover:bg-muted/30">
                  <td className="p-2">{r.snapshotDate}</td>
                  <td className="p-2 text-right">{money(r.totalAssets)}</td>
                  <td className="p-2 text-right text-red-600">{money(r.totalLiabilities)}</td>
                  <td className="p-2 text-right font-medium text-emerald-600">{money(r.netAssets)}</td>
                  <td className="p-2 text-right text-muted-foreground">{money(r.cash)}</td>
                  <td className="p-2 text-right text-muted-foreground">{money(r.investment)}</td>
                  <td className="p-2 text-right text-muted-foreground">{money(r.realEstate)}</td>
                  <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => delMut.mutate(r.id)}><Trash2 className="w-3.5 h-3.5 text-red-500" /></Button></td>
                </tr>
              ))}
              {(rows || []).length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">暂无快照数据</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
    </FinanceLayout>
  );
}
