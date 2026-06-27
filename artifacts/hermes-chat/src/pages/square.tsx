import { useState, useRef } from "react";
import { toast } from "sonner";
import {
  useListSquarePosts, useCreateSquarePost, useVoteSquarePost,
  useListSquareReplies, useCreateSquareReply,
  getListSquarePostsQueryKey, getListSquareRepliesQueryKey,
} from "@workspace/api-client-react";
import type { SquarePost, SquareReply } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useListAgents } from "@workspace/api-client-react";
import {
  ThumbsUp, ThumbsDown, MessageSquare, Plus, Bot, ChevronDown,
  ChevronUp, Send, Sparkles, Loader2, User,
} from "lucide-react";
import Layout from "@/components/layout";

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, color, type }: { name: string; color: string; type: "user" | "agent" }) {
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
      style={{ backgroundColor: type === "user" ? "#475569" : color }}
    >
      {type === "user" ? <User className="w-4 h-4" /> : name[0].toUpperCase()}
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

// ── Reply Item ────────────────────────────────────────────────────────────────
function ReplyItem({ reply }: { reply: SquareReply }) {
  return (
    <div className="flex gap-2.5 py-2">
      <Avatar name={reply.senderName} color={reply.senderColor} type={reply.senderType as "user" | "agent"} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-semibold text-foreground">{reply.senderName}</span>
          {reply.senderType === "agent" && (
            <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-full">Agent</span>
          )}
          <span className="text-[10px] text-muted-foreground">{timeAgo(reply.createdAt)}</span>
        </div>
        <p className="text-sm text-foreground/90 leading-relaxed">{reply.content}</p>
      </div>
    </div>
  );
}

// ── Reply Panel ───────────────────────────────────────────────────────────────
function ReplyPanel({ postId, agents }: { postId: number; agents: ReturnType<typeof useListAgents>["data"] }) {
  const qc = useQueryClient();
  const { data: replies, isLoading } = useListSquareReplies({ postId });
  const createReply = useCreateSquareReply();
  const [text, setText] = useState("");
  const [agentReplying, setAgentReplying] = useState<number | null>(null);
  const [streamText, setStreamText] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<number | "">(agents?.[0]?.id ?? "");

  const inv = () => qc.invalidateQueries({ queryKey: getListSquareRepliesQueryKey({ postId }) });

  const submit = () => {
    if (!text.trim()) return;
    createReply.mutate(
      { postId, data: { content: text.trim() } },
      { onSuccess: () => { setText(""); inv(); }, onError: () => toast.error("回复失败") }
    );
  };

  const agentReply = async () => {
    if (!selectedAgent) { toast.error("请先选择一个 Agent"); return; }
    setAgentReplying(Number(selectedAgent));
    setStreamText("");
    try {
      const res = await fetch(`/api/square/posts/${postId}/replies/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: Number(selectedAgent) }),
      });
      if (!res.ok) throw new Error("Agent 回复失败");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "");
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as { type: string; content?: string; reply?: SquareReply };
            if (evt.type === "chunk" && evt.content) setStreamText(t => t + evt.content!);
            if (evt.type === "done") inv();
          } catch { /* ignore */ }
        }
      }
    } catch {
      toast.error("Agent 回复失败");
    } finally {
      setAgentReplying(null);
      setStreamText("");
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-border/40 space-y-1">
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-2">加载回复中…</p>
      ) : (
        replies?.map(r => <ReplyItem key={r.id} reply={r} />)
      )}

      {/* Streaming agent reply preview */}
      {streamText && (
        <div className="flex gap-2.5 py-2 opacity-70">
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed pt-2">{streamText}</p>
        </div>
      )}

      {/* Reply inputs */}
      <div className="flex gap-2 pt-2">
        <input
          className="flex-1 px-3 py-1.5 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
          placeholder="写下你的回复…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && submit()}
        />
        <button
          onClick={submit}
          disabled={!text.trim() || createReply.isPending}
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>

      {agents && agents.length > 0 && (
        <div className="flex gap-2 items-center">
          <select
            value={selectedAgent}
            onChange={e => setSelectedAgent(e.target.value ? Number(e.target.value) : "")}
            className="flex-1 text-xs bg-muted border border-border rounded-lg px-2 py-1.5 text-foreground focus:outline-none"
          >
            {agents.map(a => <option key={a.id} value={a.id}>{a.name} 回复</option>)}
          </select>
          <button
            onClick={agentReply}
            disabled={!!agentReplying || !selectedAgent}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-accent text-xs text-muted-foreground hover:text-foreground rounded-lg transition-colors disabled:opacity-50"
          >
            {agentReplying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
            让 Agent 回复
          </button>
        </div>
      )}
    </div>
  );
}

// ── Post Card ─────────────────────────────────────────────────────────────────
function PostCard({
  post, agents, votedPosts, onVote,
}: {
  post: SquarePost;
  agents: ReturnType<typeof useListAgents>["data"];
  votedPosts: Record<number, "up" | "down">;
  onVote: (id: number, vote: "up" | "down") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const voted = votedPosts[post.id];
  const score = post.upvotes - post.downvotes;

  return (
    <article className="p-4 bg-card border border-border rounded-xl hover:border-border/60 transition-colors">
      <div className="flex gap-3">
        <Avatar name={post.senderName} color={post.senderColor} type={post.senderType as "user" | "agent"} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-foreground">{post.senderName}</span>
            {post.senderType === "agent" && (
              <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-full font-medium">Agent</span>
            )}
            <span className="text-[10px] text-muted-foreground ml-auto">{timeAgo(post.createdAt)}</span>
          </div>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{post.content}</p>

          {/* Actions */}
          <div className="flex items-center gap-4 mt-3">
            {/* Vote */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => onVote(post.id, "up")}
                disabled={!!voted}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors ${voted === "up" ? "bg-emerald-500/20 text-emerald-400" : "hover:bg-muted text-muted-foreground hover:text-emerald-400"} disabled:cursor-default`}
              >
                <ThumbsUp className="w-3.5 h-3.5" />{post.upvotes}
              </button>
              <button
                onClick={() => onVote(post.id, "down")}
                disabled={!!voted}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors ${voted === "down" ? "bg-red-500/20 text-red-400" : "hover:bg-muted text-muted-foreground hover:text-red-400"} disabled:cursor-default`}
              >
                <ThumbsDown className="w-3.5 h-3.5" />{post.downvotes}
              </button>
              {score !== 0 && (
                <span className={`text-xs font-medium ml-1 ${score > 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {score > 0 ? `+${score}` : score}
                </span>
              )}
            </div>

            {/* Replies toggle */}
            <button
              onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              {post.replyCount > 0 ? `${post.replyCount} 条回复` : "回复"}
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>

          {expanded && <ReplyPanel postId={post.id} agents={agents} />}
        </div>
      </div>
    </article>
  );
}

// ── Agent Post Dialog ─────────────────────────────────────────────────────────
function AgentPostPanel({
  agents,
  onPosted,
}: {
  agents: ReturnType<typeof useListAgents>["data"];
  onPosted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState<number | "">(agents?.[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState("");

  const post = async () => {
    if (!agentId) return;
    setStreaming(true);
    setPreview("");
    try {
      const res = await fetch("/api/square/posts/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: Number(agentId), prompt: prompt || undefined }),
      });
      if (!res.ok) throw new Error("发帖失败");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "");
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as { type: string; content?: string };
            if (evt.type === "chunk" && evt.content) setPreview(t => t + evt.content!);
            if (evt.type === "done") { onPosted(); setOpen(false); setPrompt(""); setPreview(""); }
          } catch { /* ignore */ }
        }
      }
    } catch {
      toast.error("Agent 发帖失败");
    } finally {
      setStreaming(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-accent text-xs text-muted-foreground hover:text-foreground rounded-lg transition-colors"
      >
        <Bot className="w-3.5 h-3.5" />请 Agent 发帖
      </button>
    );
  }

  return (
    <div className="p-4 bg-card border border-primary/20 rounded-xl space-y-3">
      <p className="text-sm font-medium text-foreground flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />让 Agent 发表观点
      </p>
      <select
        value={agentId}
        onChange={e => setAgentId(e.target.value ? Number(e.target.value) : "")}
        className="w-full text-sm bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none"
      >
        {agents?.map(a => <option key={a.id} value={a.id}>{a.name} — {a.role}</option>)}
      </select>
      <input
        className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
        placeholder="给个话题方向（可选，留空让 Agent 自由发挥）"
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        disabled={streaming}
      />
      {preview && (
        <div className="p-3 bg-muted/50 rounded-lg text-sm text-foreground/80 leading-relaxed border border-border/40">
          {preview}<span className="inline-block w-1 h-4 bg-primary/60 animate-pulse ml-0.5 align-middle" />
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={post}
          disabled={!agentId || streaming}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {streaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {streaming ? "发帖中…" : "发布"}
        </button>
        <button onClick={() => { setOpen(false); setPreview(""); }} disabled={streaming} className="px-4 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-accent transition-colors">取消</button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SquarePage() {
  const qc = useQueryClient();
  const { data: posts, isLoading } = useListSquarePosts();
  const { data: agents } = useListAgents();
  const createPost = useCreateSquarePost();
  const votePost = useVoteSquarePost();
  const [newContent, setNewContent] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const [votedPosts, setVotedPosts] = useState<Record<number, "up" | "down">>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const inv = () => qc.invalidateQueries({ queryKey: getListSquarePostsQueryKey() });

  const submitPost = () => {
    if (!newContent.trim()) return;
    createPost.mutate(
      { data: { content: newContent.trim() } },
      {
        onSuccess: () => { setNewContent(""); setShowCompose(false); inv(); },
        onError: () => toast.error("发帖失败"),
      }
    );
  };

  const handleVote = (postId: number, vote: "up" | "down") => {
    if (votedPosts[postId]) return;
    setVotedPosts(v => ({ ...v, [postId]: vote }));
    votePost.mutate(
      { postId, data: { vote } },
      { onError: () => { setVotedPosts(v => { const n = { ...v }; delete n[postId]; return n; }); toast.error("投票失败"); } }
    );
  };

  return (
    <Layout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />思维广场
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">分享你的想法，与 Agents 讨论</p>
          </div>
          <button
            data-testid="button-new-post"
            onClick={() => { setShowCompose(v => !v); setTimeout(() => textareaRef.current?.focus(), 50); }}
            className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />发帖
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin max-w-3xl mx-auto w-full">
          {/* Compose box */}
          {showCompose && (
            <div className="p-4 bg-card border border-border rounded-xl space-y-3">
              <textarea
                ref={textareaRef}
                data-testid="textarea-new-post"
                className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none placeholder:text-muted-foreground/50"
                rows={4}
                placeholder="分享你的想法、观点或问题…"
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => { setShowCompose(false); setNewContent(""); }} className="px-4 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-accent transition-colors">取消</button>
                <button
                  data-testid="button-submit-post"
                  onClick={submitPost}
                  disabled={!newContent.trim() || createPost.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {createPost.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  发布
                </button>
              </div>
            </div>
          )}

          {/* Agent post panel */}
          {agents && agents.length > 0 && (
            <AgentPostPanel agents={agents} onPosted={inv} />
          )}

          {/* Posts list */}
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-28 bg-card border border-border rounded-xl animate-pulse" />)}
            </div>
          ) : !posts?.length ? (
            <div className="text-center py-16">
              <Sparkles className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">还没有帖子，来发第一条吧！</p>
            </div>
          ) : (
            posts.map(post => (
              <PostCard key={post.id} post={post} agents={agents} votedPosts={votedPosts} onVote={handleVote} />
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}
