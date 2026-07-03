import { useState } from "react";
import Layout from "@/components/layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, CheckSquare, Lightbulb, Map, ExternalLink, BookOpen, Trash2, Check, ChevronDown, ChevronUp, Link2 } from "lucide-react";
import { format } from "date-fns";

type FutureLink = { label: string; url: string; kind: "wiki" | "external" };
type FutureItem = {
  id: number;
  type: "todo" | "idea" | "plan";
  title: string;
  body: string;
  status: "active" | "done" | "archived";
  links: FutureLink[];
  tags: string[];
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const TYPE_META = {
  todo:  { label: "Todo",  icon: CheckSquare, color: "text-blue-400",   bg: "bg-blue-400/10 border-blue-400/20" },
  idea:  { label: "Idea",  icon: Lightbulb,   color: "text-yellow-400", bg: "bg-yellow-400/10 border-yellow-400/20" },
  plan:  { label: "Plan",  icon: Map,         color: "text-emerald-400",bg: "bg-emerald-400/10 border-emerald-400/20" },
} as const;

type ItemType = keyof typeof TYPE_META;

function LinkChip({ link }: { link: FutureLink }) {
  const isWiki = link.kind === "wiki";
  const href = isWiki ? `${BASE}/wiki/pages/${link.url}` : link.url;
  return (
    <a
      href={href}
      target={isWiki ? undefined : "_blank"}
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {isWiki ? <BookOpen className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
      {link.label}
    </a>
  );
}

function ItemCard({ item, onToggle, onDelete }: { item: FutureItem; onToggle: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TYPE_META[item.type as ItemType];
  const Icon = meta.icon;
  const done = item.status === "done";
  const links = (item.links as FutureLink[]) ?? [];

  return (
    <div className={`rounded-lg border p-3 transition-all ${done ? "opacity-50" : ""} ${meta.bg}`}>
      <div className="flex items-start gap-2">
        {item.type === "todo" ? (
          <button onClick={onToggle} className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${done ? "bg-blue-400 border-blue-400" : "border-muted-foreground hover:border-blue-400"}`}>
            {done && <Check className="w-3 h-3 text-white" />}
          </button>
        ) : (
          <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.color}`} />
        )}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium leading-snug ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
            {item.title}
          </p>
          {item.dueDate && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {format(new Date(item.dueDate), "MMM d, yyyy")}
            </p>
          )}
          {(item.body || links.length > 0) && (
            <button onClick={() => setExpanded(!expanded)} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "收起" : `展开${item.body ? "详情" : ""}${links.length > 0 ? `·${links.length}个链接` : ""}`}
            </button>
          )}
          {expanded && (
            <div className="mt-2 space-y-2">
              {item.body && <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{item.body}</p>}
              {links.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {links.map((l, i) => <LinkChip key={i} link={l} />)}
                </div>
              )}
            </div>
          )}
        </div>
        <button onClick={onDelete} className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function AddForm({ type, onAdd, onCancel }: { type: ItemType; onAdd: (data: Partial<FutureItem>) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkKind, setLinkKind] = useState<"wiki" | "external">("external");
  const [links, setLinks] = useState<FutureLink[]>([]);

  const addLink = () => {
    if (!linkUrl.trim()) return;
    setLinks([...links, { label: linkLabel || linkUrl, url: linkUrl.trim(), kind: linkKind }]);
    setLinkLabel(""); setLinkUrl("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd({ title: title.trim(), body, dueDate: dueDate || undefined, links });
  };

  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-card p-3 space-y-2 text-sm">
      <input
        autoFocus
        placeholder="标题…"
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="w-full bg-transparent text-foreground placeholder:text-muted-foreground outline-none font-medium"
      />
      <textarea
        placeholder="详情（可选）"
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={2}
        className="w-full bg-transparent text-muted-foreground placeholder:text-muted-foreground outline-none resize-none text-xs"
      />
      {type === "todo" && (
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
          className="bg-transparent text-muted-foreground outline-none text-xs w-full" />
      )}

      {/* Link adder */}
      <div className="space-y-1 border-t border-border pt-2">
        <p className="text-xs text-muted-foreground flex items-center gap-1"><Link2 className="w-3 h-3" />附加链接</p>
        <div className="flex gap-1">
          <select value={linkKind} onChange={e => setLinkKind(e.target.value as "wiki" | "external")}
            className="bg-muted text-xs rounded px-1.5 py-1 text-foreground outline-none">
            <option value="external">外部链接</option>
            <option value="wiki">Wiki 页面 ID</option>
          </select>
          <input placeholder={linkKind === "wiki" ? "Wiki 页面 ID" : "URL"} value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            className="flex-1 bg-muted rounded px-2 py-1 text-xs outline-none placeholder:text-muted-foreground" />
          <input placeholder="标签（可选）" value={linkLabel} onChange={e => setLinkLabel(e.target.value)}
            className="w-24 bg-muted rounded px-2 py-1 text-xs outline-none placeholder:text-muted-foreground" />
          <button type="button" onClick={addLink}
            className="px-2 py-1 rounded bg-muted text-xs hover:bg-muted/80">
            添加
          </button>
        </div>
        {links.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {links.map((l, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {l.label}
                <button type="button" onClick={() => setLinks(links.filter((_, j) => j !== i))} className="hover:text-destructive">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1">取消</button>
        <button type="submit" disabled={!title.trim()}
          className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded hover:opacity-90 disabled:opacity-40">
          添加
        </button>
      </div>
    </form>
  );
}

function Column({ type, items, onAdd, onToggle, onDelete }: {
  type: ItemType;
  items: FutureItem[];
  onAdd: (data: Partial<FutureItem>) => void;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  const active = items.filter(i => i.status !== "done");
  const done = items.filter(i => i.status === "done");

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${meta.color}`} />
          <span className="font-semibold text-sm text-foreground">{meta.label}</span>
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-1.5">{active.length}</span>
        </div>
        <button onClick={() => setAdding(true)}
          className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {adding && (
        <AddForm type={type} onAdd={(data) => { onAdd(data); setAdding(false); }} onCancel={() => setAdding(false)} />
      )}

      <div className="space-y-2">
        {active.map(item => (
          <ItemCard key={item.id} item={item} onToggle={() => onToggle(item.id)} onDelete={() => onDelete(item.id)} />
        ))}
      </div>

      {done.length > 0 && (
        <details className="group">
          <summary className="text-xs text-muted-foreground cursor-pointer list-none flex items-center gap-1 py-1">
            <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
            已完成 ({done.length})
          </summary>
          <div className="space-y-2 mt-2">
            {done.map(item => (
              <ItemCard key={item.id} item={item} onToggle={() => onToggle(item.id)} onDelete={() => onDelete(item.id)} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export default function FuturePage() {
  const qc = useQueryClient();

  const { data: items = [] } = useQuery<FutureItem[]>({
    queryKey: ["future"],
    queryFn: () => apiFetch("/api/future"),
  });

  const create = useMutation({
    mutationFn: (data: Partial<FutureItem>) => apiFetch("/api/future", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["future"] }),
  });

  const update = useMutation({
    mutationFn: ({ id, ...data }: Partial<FutureItem> & { id: number }) =>
      apiFetch(`/api/future/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["future"] }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/future/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["future"] }),
  });

  const byType = (type: ItemType) => items.filter(i => i.type === type);

  const handleAdd = (type: ItemType) => (data: Partial<FutureItem>) => {
    create.mutate({ ...data, type });
  };

  const handleToggle = (item: FutureItem) => {
    update.mutate({ id: item.id, status: item.status === "done" ? "active" : "done" });
  };

  const handleDelete = (id: number) => {
    if (confirm("删除这条记录？")) remove.mutate(id);
  };

  return (
    <Layout>
      <div className="h-full flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold text-foreground">Future</h1>
          <p className="text-xs text-muted-foreground mt-0.5">记录想法、计划和待办</p>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl">
            {(["todo", "idea", "plan"] as const).map(type => (
              <Column
                key={type}
                type={type}
                items={byType(type)}
                onAdd={handleAdd(type)}
                onToggle={(id) => handleToggle(items.find(i => i.id === id)!)}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
