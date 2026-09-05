import { useState, useRef } from "react";
import Layout from "@/components/layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Lightbulb, MapIcon, CheckSquare, ExternalLink, BookOpen,
  Trash2, Check, ChevronRight, ChevronDown, Link2, Pencil, Calendar,
  Archive, ArchiveRestore, ListTree,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

type FutureLink = { label: string; url: string; kind: "wiki" | "external" };
type FutureStatus = "not_started" | "preparing" | "in_progress" | "done";
type FutureItem = {
  id: number;
  type: "todo" | "idea" | "plan";
  title: string;
  body: string;
  status: FutureStatus;
  links: FutureLink[];
  tags: string[];
  dueDate: string | null;
  startMonth: string | null;
  endMonth: string | null;
  parentId: number | null;
  backlog: boolean;
  createdAt: string;
  updatedAt: string;
};

type TabKey = "tree" | "backlog" | "completed";

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
  idea: { label: "Idea", icon: Lightbulb,   color: "text-yellow-400",    border: "border-yellow-400/30",    bg: "bg-yellow-400/5" },
  plan: { label: "Plan", icon: MapIcon,     color: "text-emerald-400",   border: "border-emerald-400/30",   bg: "bg-emerald-400/5" },
  todo: { label: "Todo", icon: CheckSquare,  color: "text-blue-400",      border: "border-blue-400/30",      bg: "bg-blue-400/5" },
} as const;

type ItemType = keyof typeof TYPE_META;

const CHILD_TYPE: Record<ItemType, ItemType | null> = {
  idea: "plan",
  plan: "todo",
  todo: null,
};

const STATUS_META: Record<FutureStatus, { label: string; dot: string; text: string; bg: string }> = {
  not_started: { label: "未开始", dot: "bg-gray-400",    text: "text-gray-400",    bg: "bg-gray-400/10" },
  preparing:   { label: "准备中", dot: "bg-amber-400",   text: "text-amber-400",   bg: "bg-amber-400/10" },
  in_progress: { label: "进行中", dot: "bg-blue-400",    text: "text-blue-400",    bg: "bg-blue-400/10" },
  done:        { label: "完成",   dot: "bg-emerald-400", text: "text-emerald-400", bg: "bg-emerald-400/10" },
};

function formatMonth(month: string | null): string {
  if (!month) return "";
  const [year, m] = month.split("-");
  return `${year}年${parseInt(m)}月`;
}

function formatMonthRange(start: string | null, end: string | null): string {
  if (start && end) return `${formatMonth(start)} ~ ${formatMonth(end)}`;
  if (start) return `${formatMonth(start)} 起`;
  if (end) return `至 ${formatMonth(end)}`;
  return "";
}

// ---------- LinkChip ----------
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

// ---------- WikiPagePicker ----------
type WikiTreeNode = { id: number; title: string; children?: WikiTreeNode[] };

function flattenTree(nodes: WikiTreeNode[], depth = 0): { id: number; title: string; depth: number }[] {
  const result: { id: number; title: string; depth: number }[] = [];
  for (const n of nodes) {
    result.push({ id: n.id, title: n.title, depth });
    if (n.children?.length) result.push(...flattenTree(n.children, depth + 1));
  }
  return result;
}

function WikiPagePicker({ links, onToggleWiki }: {
  links: FutureLink[];
  onToggleWiki: (pageId: string, pageTitle: string) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: tree = [] } = useQuery<WikiTreeNode[]>({
    queryKey: ["wiki-pages-tree"],
    queryFn: () => apiFetch("/api/pages/tree"),
    staleTime: 60_000,
  });

  const selectedWikiIds = new Set(
    links.filter(l => l.kind === "wiki").map(l => l.url),
  );

  const flat = flattenTree(tree);
  const isSearching = search.trim().length > 0;
  const visible = isSearching
    ? flat
        .filter(p => p.title.toLowerCase().includes(search.toLowerCase()))
        .map(p => ({ ...p, depth: 0 }))
    : flat;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button"
          className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <BookOpen className="w-3 h-3" />
          选择Wiki页面
          {selectedWikiIds.size > 0 && (
            <span className="ml-0.5 px-1 rounded-full bg-primary/20 text-primary text-[10px] leading-none flex items-center" style={{ minWidth: "14px", height: "14px", justifyContent: "center" }}>
              {selectedWikiIds.size}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-2 border-b border-border">
          <input
            placeholder="搜索页面标题…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-muted text-xs rounded px-2 py-1 outline-none placeholder:text-muted-foreground text-foreground"
          />
        </div>
        <ScrollArea className="h-72">
          {visible.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              {flat.length === 0 ? "加载中…" : "无匹配页面"}
            </p>
          ) : (
            visible.map(({ id, title, depth }) => {
              const selected = selectedWikiIds.has(String(id));
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onToggleWiki(String(id), title)}
                  style={{ paddingLeft: `${12 + depth * 16}px` }}
                  className={`w-full flex items-center gap-2 pr-3 py-1.5 text-xs hover:bg-muted/50 transition-colors ${
                    selected ? "text-primary" : "text-foreground"
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0 opacity-60" />
                  <span className="flex-1 truncate text-left">{title}</span>
                  {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              );
            })
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// ---------- ItemForm ----------
function ItemForm({ type, initial, onSave, onCancel, mode }: {
  type: ItemType;
  initial?: Partial<FutureItem>;
  onSave: (data: Partial<FutureItem>) => void;
  onCancel: () => void;
  mode: "add" | "edit";
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [statusV, setStatusV] = useState<FutureStatus>((initial?.status as FutureStatus) ?? "not_started");
  const [startMonth, setStartMonth] = useState(initial?.startMonth ?? "");
  const [endMonth, setEndMonth] = useState(initial?.endMonth ?? "");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [links, setLinks] = useState<FutureLink[]>(Array.isArray(initial?.links) ? initial.links : []);

  const hasStatus = type === "plan" || type === "todo";

  const addLink = () => {
    if (!linkUrl.trim()) return;
    const url = linkUrl.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) return;
    setLinks([...links, { label: linkLabel || url, url, kind: "external" }]);
    setLinkLabel(""); setLinkUrl("");
  };

  const toggleWikiLink = (pageId: string, pageTitle: string) => {
    const existing = links.find(l => l.kind === "wiki" && l.url === pageId);
    if (existing) {
      setLinks(links.filter(l => !(l.kind === "wiki" && l.url === pageId)));
    } else {
      setLinks([...links, { label: pageTitle, url: pageId, kind: "wiki" }]);
    }
  };

  const monthInvalid = startMonth && endMonth && startMonth > endMonth;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || monthInvalid) return;
    const data: Partial<FutureItem> = {
      title: title.trim(),
      body: body,
      links: links,
    };
    if (hasStatus) {
      data.status = statusV;
      data.startMonth = startMonth || null;
      data.endMonth = endMonth || null;
    }
    onSave(data);
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

      {hasStatus && (
        <div className="flex flex-wrap gap-2 items-center border-t border-border pt-2">
          <select value={statusV} onChange={e => setStatusV(e.target.value as FutureStatus)}
            className="bg-muted text-xs rounded px-2 py-1 text-foreground outline-none">
            <option value="not_started">未开始</option>
            <option value="preparing">准备中</option>
            <option value="in_progress">进行中</option>
            <option value="done">完成</option>
          </select>
          <input type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)}
            className="bg-muted text-xs rounded px-2 py-1 text-foreground outline-none" />
          <span className="text-muted-foreground text-xs">~</span>
          <input type="month" value={endMonth} onChange={e => setEndMonth(e.target.value)}
            className="bg-muted text-xs rounded px-2 py-1 text-foreground outline-none" />
          {monthInvalid && <span className="text-xs text-destructive">结束月早于开始月</span>}
        </div>
      )}

      <div className="space-y-1.5 border-t border-border pt-2">
        <p className="text-xs text-muted-foreground flex items-center gap-1"><Link2 className="w-3 h-3" />附加链接</p>

        <WikiPagePicker links={links} onToggleWiki={toggleWikiLink} />

        <div className="flex gap-1">
          <input placeholder="https://外部链接URL" value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            className="flex-1 bg-muted rounded px-2 py-1 text-xs outline-none placeholder:text-muted-foreground" />
          <input placeholder="标签" value={linkLabel} onChange={e => setLinkLabel(e.target.value)}
            className="w-24 bg-muted rounded px-2 py-1 text-xs outline-none placeholder:text-muted-foreground" />
          <button type="button" onClick={addLink}
            className="px-2 py-1 rounded bg-muted text-xs hover:bg-muted/80">添加</button>
        </div>

        {links.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {links.map((l, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {l.kind === "wiki" && <BookOpen className="w-3 h-3" />}
                {l.label}
                <button type="button" onClick={() => setLinks(links.filter((_, j) => j !== i))} className="hover:text-destructive">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1">取消</button>
        <button type="submit" disabled={!title.trim() || monthInvalid}
          className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded hover:opacity-90 disabled:opacity-40">
          {mode === "edit" ? "保存" : "添加"}
        </button>
      </div>
    </form>
  );
}

// ---------- FlatCard (Backlog & Completed 使用的平铺卡片) ----------
function FlatCard({ item, onEdit, onDelete, onToggle, onMoveToTree, actionLabel,
  actionIcon: ActionIcon, actionClass }: {
  item: FutureItem;
  onEdit: (id: number, data: Partial<FutureItem>) => void;
  onDelete: (id: number) => void;
  onToggle?: (item: FutureItem) => void;
  onMoveToTree?: (id: number) => void;
  actionLabel: string;
  actionIcon: React.ComponentType<{ className?: string }>;
  actionClass: string;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const meta = TYPE_META[item.type as ItemType];
  const Icon = meta.icon;
  const statusMeta = STATUS_META[item.status as FutureStatus];
  const isDone = item.status === "done";
  const timeRange = formatMonthRange(item.startMonth, item.endMonth);
  const links = Array.isArray(item.links) ? item.links : [];
  const hasStatus = item.type === "plan" || item.type === "todo";

  if (editing) {
    return (
      <ItemForm
        type={item.type as ItemType}
        initial={item}
        mode="edit"
        onSave={(data) => { onEdit(item.id, data); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className={`rounded-lg border ${meta.border} ${meta.bg} p-3 ${isDone ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 mt-1 shrink-0 ${meta.color}`} />
        {item.type === "todo" && onToggle && (
          <button onClick={() => onToggle(item)}
            onMouseDown={(e) => e.stopPropagation()}
            className={`mt-1 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${isDone ? "bg-blue-400 border-blue-400" : "border-muted-foreground hover:border-blue-400"}`}>
            {isDone && <Check className="w-3 h-3 text-white" />}
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : "text-foreground"}`}>
              {item.title}
            </p>
            {hasStatus && (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs ${statusMeta.bg} ${statusMeta.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
                {statusMeta.label}
              </span>
            )}
          </div>
          {hasStatus && timeRange && (
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {timeRange}
            </p>
          )}
          {item.body && (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed mt-1">{item.body}</p>
          )}
          {links.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {links.map((l, i) => <LinkChip key={i} link={l} />)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {onMoveToTree && (
            <button onClick={() => onMoveToTree(item.id)}
              className={`w-6 h-6 rounded flex items-center justify-center ${actionClass} transition-colors`}
              title={actionLabel}>
              <ActionIcon className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => setEditing(true)}
            className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            title="编辑">
            <Pencil className="w-3 h-3" />
          </button>
          {confirmDelete ? (
            <button onClick={() => { onDelete(item.id); setConfirmDelete(false); }}
              className="px-2 h-6 rounded flex items-center text-xs bg-destructive text-white hover:opacity-90 transition-all"
              title="确认删除">
              确认删除?
            </button>
          ) : (
            <button onClick={() => { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }}
              className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="删除">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- TreeNode (递归) ----------
function TreeNode({ item, allItems, draggingType, dropTargetId,
  dragTypeRef, onSetDragging, onSetDropTarget, onClearDrag, onMove,
  onEdit, onDelete, onAddChild, onToggle, onSendToBacklog }: {
  item: FutureItem;
  allItems: FutureItem[];
  draggingType: ItemType | null;
  dropTargetId: number | null;
  dragTypeRef: React.MutableRefObject<ItemType | null>;
  onSetDragging: (type: ItemType) => void;
  onSetDropTarget: (id: number) => void;
  onClearDrag: () => void;
  onMove: (id: number, parentId: number) => void;
  onEdit: (id: number, data: Partial<FutureItem>) => void;
  onDelete: (id: number) => void;
  onAddChild: (parentId: number, type: ItemType, data: Partial<FutureItem>) => void;
  onToggle: (item: FutureItem) => void;
  onSendToBacklog: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const childType = CHILD_TYPE[item.type as ItemType];
  const children = allItems.filter(i => i.parentId === item.id);
  const meta = TYPE_META[item.type as ItemType];
  const Icon = meta.icon;
  const statusMeta = STATUS_META[item.status as FutureStatus];
  const hasChildren = children.length > 0;
  const hasStatus = item.type === "plan" || item.type === "todo";
  const timeRange = formatMonthRange(item.startMonth, item.endMonth);
  const isDone = item.status === "done";
  const links = Array.isArray(item.links) ? item.links : [];

  const canDrag = item.type === "plan" || item.type === "todo";
  const canDropRender =
    (draggingType === "plan" && item.type === "idea") ||
    (draggingType === "todo" && item.type === "plan");
  const isDropTarget = canDropRender && dropTargetId === item.id;

  const checkCanDrop = () => {
    const dt = dragTypeRef.current;
    return (dt === "plan" && item.type === "idea") ||
           (dt === "todo" && item.type === "plan");
  };

  if (editing) {
    return (
      <ItemForm
        type={item.type as ItemType}
        initial={item}
        mode="edit"
        onSave={(data) => { onEdit(item.id, data); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div>
      <div
        draggable={canDrag}
        onDragStart={(e) => {
          if (!canDrag) { e.preventDefault(); return; }
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(item.id));
          dragTypeRef.current = item.type as ItemType;
          onSetDragging(item.type as ItemType);
        }}
        onDragEnd={onClearDrag}
        onDragOver={(e) => {
          e.stopPropagation();
          if (!checkCanDrop()) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          onSetDropTarget(item.id);
        }}
        onDrop={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (!checkCanDrop()) return;
          const draggedId = Number(e.dataTransfer.getData("text/plain"));
          if (draggedId !== item.id) onMove(draggedId, item.id);
          onClearDrag();
        }}
        className={`rounded-lg border ${meta.border} ${meta.bg} p-3 transition-all ${
          isDropTarget ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
        } ${isDone ? "opacity-60" : ""} ${canDrag ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        <div className="flex items-start gap-2">
          {hasChildren ? (
            <button onClick={() => setExpanded(!expanded)} onMouseDown={(e) => e.stopPropagation()} className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground">
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          ) : (
            <Icon className={`w-4 h-4 mt-1 shrink-0 ${meta.color}`} />
          )}

          {item.type === "todo" && (
            <button onClick={() => onToggle(item)}
              onMouseDown={(e) => e.stopPropagation()}
              className={`mt-1 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${isDone ? "bg-blue-400 border-blue-400" : "border-muted-foreground hover:border-blue-400"}`}>
              {isDone && <Check className="w-3 h-3 text-white" />}
            </button>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : "text-foreground"}`}>
                {item.title}
              </p>
              {hasStatus && (
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs ${statusMeta.bg} ${statusMeta.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
                  {statusMeta.label}
                </span>
              )}
              {canDrag && (
                <span className="text-xs text-muted-foreground/40 hidden sm:inline select-none">⠿</span>
              )}
            </div>
            {hasStatus && timeRange && (
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {timeRange}
              </p>
            )}
            {item.body && (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed mt-1">{item.body}</p>
            )}
            {links.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {links.map((l, i) => <LinkChip key={i} link={l} />)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            {(item.type === "plan" || item.type === "todo") && (
              <button onClick={() => onSendToBacklog(item.id)}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10 transition-colors"
                title="移到 Backlog">
                <Archive className="w-3 h-3" />
              </button>
            )}
            <button onClick={() => setEditing(true)}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="编辑">
              <Pencil className="w-3 h-3" />
            </button>
            {childType && (
              <button onClick={() => setAddingChild(true)}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title={`添加${TYPE_META[childType].label}`}>
                <Plus className="w-3 h-3" />
              </button>
            )}
            {confirmDelete ? (
              <button onClick={() => { onDelete(item.id); setConfirmDelete(false); }}
                className="px-2 h-6 rounded flex items-center text-xs bg-destructive text-white hover:opacity-90 transition-all"
                title="确认删除">
                确认删除?
              </button>
            ) : (
              <button onClick={() => { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="删除">
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {addingChild && childType && (
        <div className="ml-4 mt-1 border-l-2 border-border/40">
          <div className="relative pl-8 py-2">
            <div className="absolute left-0 top-7 h-px w-8 bg-border/40" />
            <ItemForm
              type={childType}
              mode="add"
              onSave={(data) => { onAddChild(item.id, childType, data); setAddingChild(false); }}
              onCancel={() => setAddingChild(false)}
            />
          </div>
        </div>
      )}

      {hasChildren && expanded && (
        <div className="ml-4 mt-1 border-l-2 border-border/40">
          {children.map(child => (
            <div key={child.id} className="relative pl-8 py-2">
              <div className="absolute left-0 top-7 h-px w-8 bg-border/40" />
              <TreeNode
                item={child}
                allItems={allItems}
                draggingType={draggingType}
                dropTargetId={dropTargetId}
                dragTypeRef={dragTypeRef}
                onSetDragging={onSetDragging}
                onSetDropTarget={onSetDropTarget}
                onClearDrag={onClearDrag}
                onMove={onMove}
                onEdit={onEdit}
                onDelete={onDelete}
                onAddChild={onAddChild}
                onToggle={onToggle}
                onSendToBacklog={onSendToBacklog}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Page ----------
export default function FuturePage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>("tree");
  const [addingIdea, setAddingIdea] = useState(false);
  const [draggingType, setDraggingType] = useState<ItemType | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const dragTypeRef = useRef<ItemType | null>(null);

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

  // ---- 数据切片 ----
  const treeItems = items.filter(i => !i.backlog && i.status !== "done");
  const backlogItems = items.filter(i => i.backlog);
  const completedItems = items.filter(i => i.status === "done");

  const topLevelIdeas = treeItems.filter(i => i.type === "idea" && i.parentId == null);
  const orphanPlans = treeItems.filter(i => i.type === "plan" && i.parentId == null);
  const orphanTodos = treeItems.filter(i => i.type === "todo" && i.parentId == null);
  const hasOrphans = orphanPlans.length > 0 || orphanTodos.length > 0;

  const clearDrag = () => {
    dragTypeRef.current = null;
    setDraggingType(null);
    setDropTargetId(null);
  };

  const treeProps = {
    allItems: treeItems,
    draggingType,
    dropTargetId,
    dragTypeRef,
    onSetDragging: (type: ItemType) => {
      dragTypeRef.current = type;
      setDraggingType(type);
    },
    onSetDropTarget: setDropTargetId,
    onClearDrag: clearDrag,
    onMove: (id: number, parentId: number) => update.mutate({ id, parentId }),
    onEdit: (id: number, data: Partial<FutureItem>) => update.mutate({ id, ...data }),
    onDelete: (id: number) => remove.mutate(id),
    onAddChild: (parentId: number, type: ItemType, data: Partial<FutureItem>) => create.mutate({ ...data, type, parentId }),
    onToggle: (item: FutureItem) => update.mutate({
      id: item.id,
      status: item.status === "done" ? "in_progress" : "done",
    }),
    onSendToBacklog: (id: number) => update.mutate({ id, backlog: true }),
  };

  const tabs: { key: TabKey; label: string; count: number; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: "tree", label: "主树", count: treeItems.length, icon: ListTree },
    { key: "backlog", label: "Backlog", count: backlogItems.length, icon: Archive },
    { key: "completed", label: "已完成", count: completedItems.length, icon: CheckSquare },
  ];

  return (
    <Layout>
      <div className="h-full flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-border shrink-0 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Future</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Idea → Plan → Todo · 思维导图 · 拖拽关联</p>
          </div>
          {activeTab === "tree" && (
            <button onClick={() => setAddingIdea(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90">
              <Plus className="w-4 h-4" />
              添加 Idea
            </button>
          )}
        </div>

        {/* Tab 栏 */}
        <div className="px-6 border-b border-border shrink-0 flex gap-0">
          {tabs.map(tab => {
            const active = activeTab === tab.key;
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors ${
                  active
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                {tab.count > 0 && (
                  <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-4xl space-y-4">

            {/* ====== 主树 Tab ====== */}
            {activeTab === "tree" && (
              <>
                {addingIdea && (
                  <ItemForm
                    type="idea"
                    mode="add"
                    onSave={(data) => { create.mutate({ ...data, type: "idea" }); setAddingIdea(false); }}
                    onCancel={() => setAddingIdea(false)}
                  />
                )}

                {topLevelIdeas.length === 0 && !addingIdea && !hasOrphans ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Lightbulb className="w-8 h-8 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">还没有任何想法，点击右上角"添加 Idea"开始</p>
                  </div>
                ) : (
                  topLevelIdeas.map(item => (
                    <TreeNode key={item.id} item={item} {...treeProps} />
                  ))
                )}

                {hasOrphans && (
                  <div className="mt-8 pt-4 border-t border-dashed border-border/60">
                    <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                      <span className="opacity-60">未关联</span>
                      <span className="opacity-40">— 拖拽 Plan 到 Idea 上，或拖拽 Todo 到 Plan 上进行关联</span>
                    </p>
                    <div className="space-y-2">
                      {orphanPlans.map(item => (
                        <TreeNode key={item.id} item={item} {...treeProps} />
                      ))}
                      {orphanTodos.map(item => (
                        <TreeNode key={item.id} item={item} {...treeProps} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ====== Backlog Tab ====== */}
            {activeTab === "backlog" && (
              <>
                {backlogItems.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Archive className="w-8 h-8 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">Backlog 为空</p>
                    <p className="text-xs mt-1 opacity-60">在「主树」中点击 <Archive className="w-3 h-3 inline" /> 按钮将 Plan/Todo 移到 Backlog 备忘</p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mb-3">
                      暂存的想法和计划，随时可以移回主树继续
                    </p>
                    <div className="space-y-2">
                      {backlogItems.map(item => (
                        <FlatCard
                          key={item.id}
                          item={item}
                          onEdit={(id, data) => update.mutate({ id, ...data })}
                          onDelete={(id) => remove.mutate(id)}
                          onToggle={(item) => update.mutate({ id: item.id, status: item.status === "done" ? "in_progress" : "done" })}
                          onMoveToTree={(id) => update.mutate({ id, backlog: false })}
                          actionLabel="移回主树"
                          actionIcon={ArchiveRestore}
                          actionClass="text-muted-foreground hover:text-emerald-400 hover:bg-emerald-400/10"
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {/* ====== 已完成 Tab ====== */}
            {activeTab === "completed" && (
              <>
                {completedItems.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <CheckSquare className="w-8 h-8 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">还没有完成的项目</p>
                    <p className="text-xs mt-1 opacity-60">将 Plan 或 Todo 的状态设为「完成」后，它们会出现在这里</p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mb-3">
                      已完成 {completedItems.length} 项
                    </p>
                    <div className="space-y-2">
                      {completedItems.map(item => (
                        <FlatCard
                          key={item.id}
                          item={item}
                          onEdit={(id, data) => update.mutate({ id, ...data })}
                          onDelete={(id) => remove.mutate(id)}
                          actionLabel=""
                          actionIcon={ArchiveRestore}
                          actionClass=""
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
