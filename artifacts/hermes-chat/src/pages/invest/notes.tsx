// PIRS 全部投研笔记：按框架/作者/代码筛选，可删除
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Trash2, Search } from "lucide-react";
import InvestLayout from "./invest-layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { API, type InvestNote, type Framework } from "./shared";

const AUTHOR_COLOR: Record<string, string> = {
  agent: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  workflow: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  user: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
};

function NoteItem({ note, onDelete }: { note: InvestNote; onDelete: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className="p-4 hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/invest/stocks/${note.code}`} className="font-mono text-sm text-primary hover:underline">{note.code}</Link>
            {note.title && <span className="font-medium text-foreground text-sm">{note.title}</span>}
            {note.frameworkId && <Badge variant="outline" className="text-xs">{note.frameworkId}</Badge>}
            <Badge variant="outline" className={"text-xs " + (AUTHOR_COLOR[note.author] || "")}>{note.author}</Badge>
          </div>
          <div className="text-sm text-foreground mt-1">{note.conclusion}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { if (confirm("删除这条笔记？")) onDelete(note.id); }} className="shrink-0">
          <Trash2 className="w-3.5 h-3.5 text-destructive" />
        </Button>
      </div>
      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
        <span>{note.agentName || note.author} · {new Date(note.createdAt).toLocaleString("zh-CN")}</span>
        <button onClick={() => setExpanded(v => !v)} className="text-primary hover:underline">{expanded ? "收起" : "展开"}</button>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-border text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{note.content}</div>
      )}
    </Card>
  );
}

export default function NotesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [author, setAuthor] = useState<string>("all");
  const [frameworkId, setFrameworkId] = useState<string>("all");
  const [q, setQ] = useState("");

  const { data: notes = [], isLoading } = useQuery<InvestNote[]>({
    queryKey: ["invest-notes", author, frameworkId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (author !== "all") params.set("author", author);
      if (frameworkId !== "all") params.set("frameworkId", frameworkId);
      const res = await fetch(`${API}/notes${params.size ? "?" + params : ""}`);
      if (!res.ok) throw new Error("Failed to fetch notes");
      return res.json();
    },
  });

  const { data: frameworks = [] } = useQuery<Framework[]>({
    queryKey: ["invest-frameworks"],
    queryFn: async () => {
      const res = await fetch(`${API}/frameworks`);
      if (!res.ok) throw new Error("Failed to fetch frameworks");
      return res.json();
    },
  });

  const delMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API}/notes/${id}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "delete failed"); }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invest-notes"] });
      qc.invalidateQueries({ queryKey: ["invest-overview"] });
      toast({ title: "笔记已删除" });
    },
    onError: (err: Error) => toast({ title: "删除失败", description: err.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    if (!q.trim()) return notes;
    const k = q.trim().toLowerCase();
    return notes.filter(n =>
      n.code.includes(k) || (n.title || "").toLowerCase().includes(k) ||
      n.conclusion.toLowerCase().includes(k) || n.content.toLowerCase().includes(k)
    );
  }, [notes, q]);

  return (
    <InvestLayout>
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-emerald-500" /> 投研笔记
          </h1>
          <p className="text-sm text-muted-foreground mt-1">chat 与 workflow 写入的全部结构化笔记</p>
        </div>

        {/* 筛选栏 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="搜索代码/标题/结论/正文" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8 w-64" />
          </div>
          <Select value={author} onValueChange={setAuthor}>
            <SelectTrigger className="w-32"><SelectValue placeholder="作者" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部作者</SelectItem>
              <SelectItem value="agent">agent</SelectItem>
              <SelectItem value="workflow">workflow</SelectItem>
              <SelectItem value="user">user</SelectItem>
            </SelectContent>
          </Select>
          <Select value={frameworkId} onValueChange={setFrameworkId}>
            <SelectTrigger className="w-36"><SelectValue placeholder="框架" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部框架</SelectItem>
              {frameworks.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground ml-auto">{filtered.length} 条</span>
        </div>

        {isLoading ? (
          <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        ) : filtered.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground text-sm">
            暂无笔记。和擎天柱讨论股票或执行投研工作流后，结论会自动记录到这里。
          </Card>
        ) : (
          <div className="space-y-3">{filtered.map(n => <NoteItem key={n.id} note={n} onDelete={delMutation.mutate} />)}</div>
        )}
      </div>
    </InvestLayout>
  );
}
