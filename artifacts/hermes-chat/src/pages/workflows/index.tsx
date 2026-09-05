import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Plus, Play, Trash2, Eye, Clock, Workflow, Loader2, Search,
  CheckSquare, Square, Power, PowerOff,
} from "lucide-react";
import Layout from "@/components/layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Workflow {
  id: number;
  name: string;
  description: string;
  definition: { nodes: unknown[]; edges: unknown[] };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function WorkflowsList() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deleting, setDeleting] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const { data: workflows = [], isLoading } = useQuery<Workflow[]>({
    queryKey: ["workflows"],
    queryFn: async () => {
      const res = await fetch("/api/workflows");
      if (!res.ok) throw new Error("Failed to fetch workflows");
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workflows;
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        (w.description || "").toLowerCase().includes(q)
    );
  }, [workflows, query]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((w) => selected.has(w.id));

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach((w) => next.delete(w.id));
      } else {
        filtered.forEach((w) => next.add(w.id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/workflows/${id}/execute`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to execute");
      return res.json();
    },
    onSuccess: (data) => {
      setLocation(`/workflows/execution/${data.id}`);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(
        ids.map((id) => fetch(`/api/workflows/${id}`, { method: "DELETE" }))
      );
    },
    onSuccess: () => {
      const n = selected.size;
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      clearSelection();
      setBulkDeleteOpen(false);
      toast({ title: `已删除 ${n} 个工作流` });
    },
    onError: () => toast({ title: "批量删除失败", variant: "destructive" }),
  });

  const bulkToggleMutation = useMutation({
    mutationFn: async ({ ids, enabled }: { ids: number[]; enabled: boolean }) => {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/workflows/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled }),
          })
        )
      );
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      toast({
        title: `已${vars.enabled ? "启用" : "禁用"} ${vars.ids.length} 个工作流`,
      });
    },
    onError: () => toast({ title: "操作失败", variant: "destructive" }),
  });

  const handleDelete = async (id: number) => {
    setDeleting(id);
    await deleteMutation.mutateAsync(id);
    setDeleting(null);
  };

  return (
    <Layout>
      <div className="p-6 h-full overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-3">
                <Workflow className="w-7 h-7 text-primary" />
                Workflows
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Define and orchestrate multi-agent collaboration pipelines
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search workflows..."
                  className="pl-8 w-60"
                />
              </div>
              <Link href="/workflows/new">
                <Button className="gap-2">
                  <Plus className="w-4 h-4" />
                  New Workflow
                </Button>
              </Link>
            </div>
          </div>

          {/* 批量操作条 */}
          {filtered.length > 0 && (
            <div className="flex items-center justify-between mb-3 px-1">
              <button
                onClick={toggleSelectAll}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {allFilteredSelected ? (
                  <CheckSquare className="w-4 h-4 text-primary" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                {allFilteredSelected ? "取消全选" : "全选"}
              </button>
              <span className="text-xs text-muted-foreground">
                {filtered.length} 个工作流
              </span>
            </div>
          )}

          {selected.size > 0 && (
            <div className="flex items-center justify-between mb-4 p-3 bg-primary/5 border border-primary/30 rounded-lg">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">
                  已选中 {selected.size} 项
                </span>
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  清除选择
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={bulkToggleMutation.isPending}
                  onClick={() =>
                    bulkToggleMutation.mutate({
                      ids: [...selected],
                      enabled: true,
                    })
                  }
                >
                  <Power className="w-3.5 h-3.5" />
                  启用
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={bulkToggleMutation.isPending}
                  onClick={() =>
                    bulkToggleMutation.mutate({
                      ids: [...selected],
                      enabled: false,
                    })
                  }
                >
                  <PowerOff className="w-3.5 h-3.5" />
                  禁用
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  删除
                </Button>
              </div>
            </div>
          )}

          {/* 列表 */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              {query ? (
                <>
                  <Search className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p className="text-lg mb-1">未找到匹配的工作流</p>
                  <p className="text-sm">尝试其他关键词</p>
                </>
              ) : (
                <>
                  <Workflow className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p className="text-lg mb-2">No workflows yet</p>
                  <p className="text-sm mb-6">
                    Create your first workflow to orchestrate multi-agent collaboration
                  </p>
                  <Link href="/workflows/new">
                    <Button className="gap-2">
                      <Plus className="w-4 h-4" />
                      Create Workflow
                    </Button>
                  </Link>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((wf) => {
                const isChecked = selected.has(wf.id);
                return (
                  <div
                    key={wf.id}
                    className={`border rounded-lg p-5 transition-colors bg-card ${
                      isChecked
                        ? "border-primary ring-1 ring-primary/30"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <button
                        onClick={() => toggleSelect(wf.id)}
                        className="mt-0.5 shrink-0"
                        title={isChecked ? "取消选择" : "选择"}
                      >
                        {isChecked ? (
                          <CheckSquare className="w-4 h-4 text-primary" />
                        ) : (
                          <Square className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <Link href={`/workflows/${wf.id}`}>
                          <h3 className="font-semibold text-lg truncate cursor-pointer hover:text-primary transition-colors">
                            {wf.name}
                          </h3>
                        </Link>
                        <p className="text-sm text-muted-foreground truncate mt-1">
                          {wf.description || "No description"}
                        </p>
                      </div>
                      {!wf.enabled && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                          已禁用
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(wf.updatedAt).toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        {wf.definition.nodes?.length || 0} nodes
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => executeMutation.mutate(wf.id)}
                        disabled={executeMutation.isPending || !wf.enabled}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-md text-sm hover:bg-primary/20 transition-colors disabled:opacity-50"
                        title={!wf.enabled ? "工作流已禁用" : "运行"}
                      >
                        {executeMutation.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                        Run
                      </button>
                      <Link href={`/workflows/${wf.id}`}>
                        <button className="px-3 py-1.5 border border-border rounded-md text-sm hover:bg-accent transition-colors">
                          Edit
                        </button>
                      </Link>
                      <button
                        onClick={() => handleDelete(wf.id)}
                        disabled={deleting === wf.id}
                        className="px-3 py-1.5 border border-border rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                      >
                        {deleting === wf.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 批量删除确认 */}
        <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>批量删除工作流？</AlertDialogTitle>
              <AlertDialogDescription>
                此操作将永久删除选中的 {selected.size} 个工作流及其所有执行记录，不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground"
                disabled={bulkDeleteMutation.isPending}
                onClick={() => bulkDeleteMutation.mutate([...selected])}
              >
                {bulkDeleteMutation.isPending ? "删除中..." : "删除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  );
}
