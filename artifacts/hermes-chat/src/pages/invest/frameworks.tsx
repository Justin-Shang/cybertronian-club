// PIRS 投研框架管理：定义分析框架与 system prompt
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, BookMarked } from "lucide-react";
import InvestLayout from "./invest-layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { API, FRAMEWORK_TYPES, FRAMEWORK_TYPE_LABEL, type Framework } from "./shared";

interface FrameworkInput {
  id?: string;
  name: string;
  type: string;
  description: string;
  systemPrompt: string;
  isEnabled: boolean;
}

const EMPTY: FrameworkInput = { name: "", type: "value", description: "", systemPrompt: "", isEnabled: true };

export default function FrameworksPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Framework | null>(null);
  const [form, setForm] = useState<FrameworkInput>(EMPTY);

  const { data: rows = [], isLoading } = useQuery<Framework[]>({
    queryKey: ["invest-frameworks"],
    queryFn: async () => {
      const res = await fetch(`${API}/frameworks`);
      if (!res.ok) throw new Error("Failed to fetch frameworks");
      return res.json();
    },
  });

  const openNew = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (f: Framework) => {
    setEditing(f);
    setForm({ id: f.id, name: f.name, type: f.type, description: f.description || "", systemPrompt: f.systemPrompt, isEnabled: f.isEnabled });
    setOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const isEdit = !!editing;
      const url = isEdit ? `${API}/frameworks/${editing!.id}` : `${API}/frameworks`;
      const method = isEdit ? "PUT" : "POST";
      const body = isEdit ? form : { ...form, id: form.id || form.name };
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-frameworks"] });
      setOpen(false);
      toast({ title: editing ? "框架已更新" : "框架已创建" });
    },
    onError: (err: Error) => toast({ title: "保存失败", description: err.message, variant: "destructive" }),
  });

  const delMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/frameworks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "delete failed");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-frameworks"] });
      toast({ title: "框架已删除" });
    },
    onError: (err: Error) => toast({ title: "删除失败", description: err.message, variant: "destructive" }),
  });

  return (
    <InvestLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <BookMarked className="w-6 h-6 text-primary" /> 投研框架
            </h1>
            <p className="text-sm text-muted-foreground mt-1">定义分析框架与 agent system prompt，用于资源池分析与 A 股筛选</p>
          </div>
          <Button size="sm" onClick={openNew}><Plus className="w-4 h-4" /> 新建框架</Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : rows.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground text-sm">暂无框架。新建一个价值/成长/质量框架试试。</Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">{f.id}</TableCell>
                    <TableCell className="font-medium">
                      {f.name}
                      {f.description && <div className="text-xs text-muted-foreground font-normal">{f.description}</div>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{FRAMEWORK_TYPE_LABEL[f.type] || f.type}</Badge></TableCell>
                    <TableCell>
                      {f.isBuiltin ? <Badge className="bg-muted text-muted-foreground border-0">内置</Badge>
                        : f.isEnabled ? <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 border">启用</Badge>
                        : <Badge variant="secondary">停用</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(f)}><Pencil className="w-3.5 h-3.5" /></Button>
                        {!f.isBuiltin && (
                          <Button variant="ghost" size="sm" onClick={() => { if (confirm(`删除框架「${f.name}」？`)) delMutation.mutate(f.id); }}>
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑框架" : "新建框架"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">框架 ID（唯一标识）</Label>
                <Input
                  placeholder="如 value / growth / quality"
                  value={editing ? editing.id : form.id ?? ""}
                  disabled={!!editing}
                  onChange={(e) => setForm(s => ({ ...s, id: e.target.value.trim() }))}
                />
                {!editing && <p className="text-xs text-muted-foreground mt-1">用于笔记 frameworkId 字段关联</p>}
              </div>
              <div>
                <Label className="text-xs">名称</Label>
                <Input value={form.name} onChange={(e) => setForm(s => ({ ...s, name: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">类型</Label>
                <Select value={form.type} onValueChange={(v) => setForm(s => ({ ...s, type: v }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择框架类型" />
                  </SelectTrigger>
                  <SelectContent>
                    {FRAMEWORK_TYPES.map((t) => (
                      <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch checked={form.isEnabled} onCheckedChange={(v) => setForm(s => ({ ...s, isEnabled: v }))} id="fw-enabled" />
                <Label htmlFor="fw-enabled" className="text-sm cursor-pointer">启用</Label>
              </div>
            </div>
            <div>
              <Label className="text-xs">描述</Label>
              <Input value={form.description} onChange={(e) => setForm(s => ({ ...s, description: e.target.value }))} placeholder="一句话说明框架用途" />
            </div>
            <div>
              <Label className="text-xs">System Prompt（agent 分析时注入）</Label>
              <Textarea
                className="min-h-[180px] font-mono text-xs"
                placeholder="你是一位价值投资分析师，关注 ROE、护城河、估值安全边际……"
                value={form.systemPrompt}
                onChange={(e) => setForm(s => ({ ...s, systemPrompt: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.name.trim()}>
              {saveMutation.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </InvestLayout>
  );
}
