import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AuthedImage } from "@/components/wiki/authed-image";
import { WikiLayout } from "@/components/wiki/layout";
import { CategoryBadge } from "@/components/wiki/page-card";
import { Button } from "@/components/ui/button";
import { useDeletePage, useGetPage, getGetPageQueryKey, getListPagesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Copy, Edit, Trash2, MessageSquare, Send, Loader2, Check, AlertCircle, X } from "lucide-react";
import { Link, useLocation, useParams } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useState, useRef, useEffect, useCallback } from "react";

const AGENTS = [
  { id: "arcee", name: "阿尔茜（教育专家）" },
  { id: "optimus", name: "擎天柱（投研专家）" },
  { id: "tongtianxiao", name: "通天晓（OPC经营）" },
  { id: "hotrod", name: "补天士（智算GPU）" },
  { id: "bumblebee", name: "大黄蜂（全栈杂学）" },
];

interface Comment {
  id: number;
  pageId: number;
  selectedText: string;
  comment: string;
  mentionedAgent: string;
  status: string;
  result: string | null;
  errorMessage: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export default function WikiPageView() {
  const { id } = useParams();
  const pageId = parseInt(id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: page, isLoading } = useGetPage(pageId, {
    query: { enabled: !!pageId, queryKey: getGetPageQueryKey(pageId) },
  });

  const deleteMutation = useDeletePage({
    mutation: {
      onSuccess: () => {
        toast({ title: "Page deleted" });
        queryClient.invalidateQueries({ queryKey: getListPagesQueryKey() });
        setLocation("/wiki/pages");
      },
      onError: () => { toast({ title: "Failed to delete page", variant: "destructive" }); },
    },
  });

  // ── Comment feature ──
  const proseRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [commentText, setCommentText] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("arcee");
  const [submitting, setSubmitting] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const prevStatusRef = useRef<string>("");

  const loadComments = useCallback(async () => {
    if (!pageId) return;
    try {
      const resp = await fetch(`/api/pages/${pageId}/comments`, { credentials: "include" });
      if (resp.ok) setComments(await resp.json());
    } catch { /* ignore */ }
  }, [pageId]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // Poll when there are pending comments
  useEffect(() => {
    const hasPending = comments.some(c => c.status === "pending" || c.status === "processing");
    if (!hasPending) return;
    const timer = setInterval(loadComments, 3000);
    return () => clearInterval(timer);
  }, [comments, loadComments]);

  // Auto-refresh page when a comment resolves
  useEffect(() => {
    const currentStatus = comments.map(c => `${c.id}:${c.status}`).join(",");
    if (prevStatusRef.current && prevStatusRef.current !== currentStatus) {
      if (comments.some(c => c.status === "done")) {
        queryClient.invalidateQueries({ queryKey: getGetPageQueryKey(pageId) });
        toast({ title: "Agent 已完成修改", description: "页面已更新" });
      }
    }
    prevStatusRef.current = currentStatus;
  }, [comments, pageId, queryClient, toast]);

  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim().length < 2) { setSelection(null); return; }
    if (!proseRef.current?.contains(sel.anchorNode)) { setSelection(null); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setSelection({ text: sel.toString().trim(), x: rect.left + rect.width / 2, y: rect.bottom + 10 });
  };

  const submitComment = async () => {
    if (!selection || !commentText.trim()) return;
    setSubmitting(true);
    try {
      const resp = await fetch(`/api/pages/${pageId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ selectedText: selection.text, comment: commentText.trim(), mentionedAgent: selectedAgent }),
      });
      if (!resp.ok) throw new Error("Failed");
      toast({ title: "评论已提交", description: `${AGENTS.find(a => a.id === selectedAgent)?.name} 正在处理...` });
      setSelection(null); setCommentText("");
      loadComments();
    } catch {
      toast({ title: "提交失败", variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(page?.content || "");
    toast({ title: "已拷贝到剪贴板" });
  };

  if (isLoading) {
    return (
      <WikiLayout>
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-muted w-1/4 rounded"></div>
          <div className="h-12 bg-muted w-3/4 rounded"></div>
          <div className="space-y-3">
            <div className="h-4 bg-muted rounded"></div>
            <div className="h-4 bg-muted rounded"></div>
            <div className="h-4 bg-muted w-5/6 rounded"></div>
          </div>
        </div>
      </WikiLayout>
    );
  }

  if (!page) {
    return (
      <WikiLayout>
        <div className="text-center py-20">
          <h2 className="text-xl font-bold mb-2">Page not found</h2>
          <Link href="/wiki/pages" className="text-primary hover:underline">Return to pages</Link>
        </div>
      </WikiLayout>
    );
  }

  return (
    <WikiLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center gap-2">
          <Link href="/wiki/pages" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
            <ArrowLeft className="w-4 h-4" />
            Back to pages
          </Link>
        </div>

        <header className="border-b border-border pb-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">{page.title}</h1>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" className="gap-2" onClick={handleCopy}>
                <Copy className="w-4 h-4" />
                Copy
              </Button>
              <Link href={`/wiki/pages/${page.id}/edit`}>
                <Button variant="outline" size="sm" className="gap-2">
                  <Edit className="w-4 h-4" />
                  Edit
                </Button>
              </Link>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 text-destructive border-destructive/20 hover:bg-destructive/10">
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. This will permanently delete the page.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => deleteMutation.mutate({ id: pageId })}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <CategoryBadge category={page.category} />
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="font-medium text-foreground">{page.author}</span>
              <span>·</span>
              <time dateTime={page.createdAt}>Created {format(new Date(page.createdAt), "MMM d, yyyy")}</time>
              {page.updatedAt !== page.createdAt && (
                <>
                  <span>·</span>
                  <time dateTime={page.updatedAt}>Updated {format(new Date(page.updatedAt), "MMM d, yyyy")}</time>
                </>
              )}
            </div>
          </div>

          {page.tags && page.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {page.tags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 bg-secondary text-secondary-foreground rounded-md text-xs font-mono">#{tag}</span>
              ))}
            </div>
          )}
        </header>

        <div
          ref={proseRef}
          className="prose dark:prose-invert max-w-none prose-img:rounded-lg prose-img:border prose-img:border-border"
          onMouseUp={handleMouseUp}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: (props) => <AuthedImage {...props} src={props.src ?? ""} /> }}>
            {page.content}
          </ReactMarkdown>
        </div>

        {/* Comments section */}
        {comments.length > 0 && (
          <div className="border-t border-border pt-6 space-y-3">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              Comments ({comments.length})
            </h3>
            {comments.slice().reverse().map((c) => (
              <div key={c.id} className="border border-border rounded-lg p-3 space-y-2 bg-card">
                <div className="flex items-center gap-2 text-sm">
                  {c.status === "pending" && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                  {c.status === "processing" && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
                  {c.status === "done" && <Check className="w-4 h-4 text-green-500" />}
                  {c.status === "error" && <AlertCircle className="w-4 h-4 text-red-500" />}
                  <span className="font-medium">{AGENTS.find(a => a.id === c.mentionedAgent)?.name || c.mentionedAgent}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground text-xs">{format(new Date(c.createdAt), "MMM d, HH:mm")}</span>
                </div>
                <div className="text-sm">
                  <div className="text-muted-foreground text-xs mb-1">选中：</div>
                  <div className="bg-muted/50 rounded px-2 py-1 text-xs font-mono line-clamp-2">{c.selectedText}</div>
                </div>
                <div className="text-sm">
                  <div className="text-muted-foreground text-xs mb-1">评论：</div>
                  <div>{c.comment}</div>
                </div>
                {c.status === "done" && c.result && (
                  <div className="text-sm">
                    <div className="text-green-600 dark:text-green-400 text-xs mb-1">修改结果：</div>
                    <div className="bg-green-50 dark:bg-green-950/30 rounded px-2 py-1 text-xs font-mono line-clamp-3">{c.result}</div>
                  </div>
                )}
                {c.status === "error" && c.errorMessage && (
                  <div className="text-sm text-red-500"><span className="text-xs">错误：{c.errorMessage}</span></div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating comment popover */}
      {selection && (
        <div
          className="fixed z-50 w-80 bg-card border border-border rounded-lg shadow-lg p-3 space-y-2"
          style={{ left: Math.min(Math.max(selection.x - 160, 10), window.innerWidth - 330), top: selection.y }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium flex items-center gap-1"><MessageSquare className="w-4 h-4" />添加评论</span>
            <button onClick={() => { setSelection(null); setCommentText(""); }}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
          <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 line-clamp-2">
            "{selection.text.slice(0, 80)}{selection.text.length > 80 ? "..." : ""}"
          </div>
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="输入评论要求..."
            className="w-full text-sm bg-background border border-border rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            rows={3}
            autoFocus
          />
          <div className="flex items-center gap-2">
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="text-xs bg-background border border-border rounded px-2 py-1 focus:outline-none"
            >
              {AGENTS.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
            </select>
            <Button size="sm" className="ml-auto gap-1" disabled={!commentText.trim() || submitting} onClick={submitComment}>
              {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              提交
            </Button>
          </div>
        </div>
      )}
    </WikiLayout>
  );
}
