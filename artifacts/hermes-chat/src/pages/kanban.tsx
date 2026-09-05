import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListAgents } from "@workspace/api-client-react";
import { toast } from "sonner";
import {
  Plus, Trash2, Pencil, GripVertical, X, Check, Loader2,
  Columns2, Clock, Calendar
} from "lucide-react";
import Layout from "@/components/layout";

// ---------- types ----------
interface KanbanColumn {
  id: number;
  title: string;
  agentId: number | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  _virtual?: boolean;
}

interface KanbanCard {
  id: number;
  title: string;
  description: string;
  columnId: number;
  agentId: number | null;
  position: number;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BoardData {
  columns: KanbanColumn[];
  cards: KanbanCard[];
  waitingCardIds: number[];
}

const API = "/api/kanban";

async function fetchBoard(): Promise<BoardData> {
  const res = await fetch(API + "/board");
  if (!res.ok) throw new Error("Failed to fetch board");
  return res.json();
}

async function createColumn(title: string): Promise<KanbanColumn> {
  const res = await fetch(API + "/columns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to create column");
  return res.json();
}

async function deleteColumn(id: number): Promise<void> {
  const res = await fetch(API + "/columns/" + id, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete column");
}

async function createCard(data: {
  title: string;
  description: string;
  columnId: number;
  agentId: number | null;
  dueDate: string | null;
}): Promise<KanbanCard> {
  const res = await fetch(API + "/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create card");
  return res.json();
}

async function updateCard(
  id: number,
  data: Partial<{
    title: string;
    description: string;
    columnId: number;
    agentId: number | null;
    position: number;
    dueDate: string | null;
  }>
): Promise<KanbanCard> {
  const res = await fetch(API + "/cards/" + id, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update card");
  return res.json();
}

async function deleteCard(id: number): Promise<void> {
  const res = await fetch(API + "/cards/" + id, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete card");
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(now);
  dayAfter.setDate(dayAfter.getDate() + 2);

  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  if (d.toDateString() === dayAfter.toDateString()) return "Day after";

  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isOverdue(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return d < now;
}

// ---------- Card Dialog ----------
function CardDialog({
  open,
  onClose,
  agents,
  columnId,
  editCard,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  agents: { id: number; name: string; color: string }[];
  columnId: number;
  editCard: KanbanCard | null;
  onSave: (data: {
    title: string;
    description: string;
    columnId: number;
    agentId: number | null;
    dueDate: string | null;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [agentId, setAgentId] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (editCard) {
      setTitle(editCard.title);
      setDesc(editCard.description);
      setAgentId(editCard.agentId);
      setDueDate(editCard.dueDate ? editCard.dueDate.slice(0, 16) : "");
    } else {
      setTitle("");
      setDesc("");
      setAgentId(null);
      setDueDate("");
    }
  }, [editCard, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            {editCard ? "Edit Card" : "New Card"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Title
            </label>
            <input
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Card title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) {
                  if (!title.trim()) return;
                  onSave({
                    title: title.trim(),
                    description: desc.trim(),
                    columnId,
                    agentId,
                    dueDate: dueDate || null,
                  });
                  onClose();
                }
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Description
            </label>
            <textarea
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              rows={3}
              placeholder="Optional description"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Assignee
              </label>
              <select
                className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={agentId ?? ""}
                onChange={(e) => setAgentId(e.target.value ? parseInt(e.target.value) : null)}
              >
                <option value="">Unassigned</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Due Date
              </label>
              <input
                type="datetime-local"
                className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={() => {
              if (!title.trim()) return;
              onSave({
                title: title.trim(),
                description: desc.trim(),
                columnId,
                agentId,
                dueDate: dueDate || null,
              });
              onClose();
            }}
            disabled={!title.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Check className="w-4 h-4" />
            {editCard ? "Save" : "Create"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-accent transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Column ----------
function Column({
  col,
  cards,
  agents,
  isWaiting,
  waitingCardIds,
  onDrop,
  onAddCard,
  onEditCard,
  onDeleteCard,
  onDeleteColumn,
}: {
  col: KanbanColumn;
  cards: KanbanCard[];
  agents: { id: number; name: string; color: string }[];
  isWaiting: boolean;
  waitingCardIds: number[];
  onDrop: (cardId: number, columnId: number) => void;
  onAddCard: (columnId: number) => void;
  onEditCard: (card: KanbanCard) => void;
  onDeleteCard: (id: number) => void;
  onDeleteColumn: (id: number) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={"flex-shrink-0 w-72 flex flex-col rounded-xl border " +
        (isWaiting
          ? "bg-amber-50/30 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30"
          : "bg-muted/30 border-border/50")}
      onDragOver={(e) => {
        if (isWaiting) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (isWaiting) return;
        e.preventDefault();
        setDragOver(false);
        const cardId = parseInt(e.dataTransfer.getData("cardId"), 10);
        if (cardId) onDrop(cardId, col.id);
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <div className={"w-2 h-2 rounded-full " + (isWaiting ? "bg-amber-500" : "bg-primary/60")} />
          <h3 className="text-sm font-semibold text-foreground">{col.title}</h3>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            {cards.length}
          </span>
        </div>
        {!isWaiting && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onAddCard(col.id)}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Add card"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                if (confirm("Delete column \"" + col.title + "\" and all its cards?")) {
                  onDeleteColumn(col.id);
                }
              }}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="Delete column"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      <div
        className={"flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px] transition-colors " +
          (dragOver && !isWaiting ? "bg-primary/5" : "")}
      >
        {cards
          .sort((a, b) => a.position - b.position)
          .map((card) => {
            const agent = agents.find((a) => a.id === card.agentId);
            const inWaiting = waitingCardIds.includes(card.id);
            const overdue = card.dueDate && isOverdue(card.dueDate);

            return (
              <div
                key={card.id}
                className={"group border rounded-lg p-3 transition-all " +
                  (isWaiting
                    ? "bg-card border-amber-200/60 dark:border-amber-800/40 hover:border-amber-300/80 dark:hover:border-amber-700/60"
                    : "bg-card border-border hover:border-primary/30 hover:shadow-sm cursor-grab active:cursor-grabbing")}
                draggable={!isWaiting}
                onDragStart={(e) => {
                  if (isWaiting) return;
                  e.dataTransfer.setData("cardId", String(card.id));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onEditCard(card)}
              >
                <div className="flex items-start gap-2">
                  {!isWaiting && (
                    <GripVertical className="w-3.5 h-3.5 mt-0.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {card.title}
                    </p>
                    {card.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {card.description}
                      </p>
                    )}

                    {/* Due date badge */}
                    {card.dueDate && (
                      <div className={"flex items-center gap-1 mt-2 text-[11px] " +
                        (overdue ? "text-red-500" : inWaiting ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                        <Clock className="w-3 h-3" />
                        <span>{formatDate(card.dueDate)}</span>
                      </div>
                    )}

                    {/* Agent badge */}
                    {agent && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <div
                          className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                          style={{ backgroundColor: agent.color }}
                        >
                          {agent.name[0]}
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {agent.name}
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCard(card.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all shrink-0"
                    title="Delete card"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        {cards.length === 0 && (
          <div className="flex items-center justify-center h-full min-h-[80px]">
            <p className="text-xs text-muted-foreground/50">
              {isWaiting ? "No upcoming tasks" : "Drop cards here"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Main Page ----------
export default function KanbanPage() {
  const qc = useQueryClient();
  const { data: agents } = useListAgents();
  const agentList = agents ?? [];

  const { data: board, isLoading, error } = useQuery<BoardData>({
    queryKey: ["kanban", "board"],
    queryFn: fetchBoard,
    refetchInterval: 10_000,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogColumnId, setDialogColumnId] = useState<number>(0);
  const [editingCard, setEditingCard] = useState<KanbanCard | null>(null);
  const [newColumnName, setNewColumnName] = useState("");
  const [showColInput, setShowColInput] = useState(false);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["kanban", "board"] });
  }, [qc]);

  const handleAddColumn = useCallback(async () => {
    if (!newColumnName.trim()) return;
    try {
      await createColumn(newColumnName.trim());
      setNewColumnName("");
      setShowColInput(false);
      invalidate();
    } catch {
      toast.error("Failed to create column");
    }
  }, [newColumnName, invalidate]);

  const handleDeleteColumn = useCallback(
    async (id: number) => {
      try {
        await deleteColumn(id);
        invalidate();
        toast.success("Column deleted");
      } catch {
        toast.error("Failed to delete column");
      }
    },
    [invalidate]
  );

  const handleDrop = useCallback(
    async (cardId: number, columnId: number) => {
      if (!board) return;
      const cardsInCol = board.cards.filter((c) => c.columnId === columnId);
      const newPosition = cardsInCol.length;
      try {
        await updateCard(cardId, { columnId, position: newPosition });
        invalidate();
      } catch {
        toast.error("Failed to move card");
      }
    },
    [board, invalidate]
  );

  const handleSaveCard = useCallback(
    async (data: {
      title: string;
      description: string;
      columnId: number;
      agentId: number | null;
      dueDate: string | null;
    }) => {
      try {
        if (editingCard) {
          await updateCard(editingCard.id, {
            ...data,
            columnId: editingCard.columnId,
          });
          toast.success("Card updated");
        } else {
          await createCard(data);
          toast.success("Card created");
        }
        invalidate();
      } catch {
        toast.error("Failed to save card");
      }
    },
    [editingCard, invalidate]
  );

  const handleDeleteCard = useCallback(
    async (id: number) => {
      try {
        await deleteCard(id);
        invalidate();
        toast.success("Card deleted");
      } catch {
        toast.error("Failed to delete card");
      }
    },
    [invalidate]
  );

  const openNewCard = (columnId: number) => {
    setEditingCard(null);
    setDialogColumnId(columnId);
    setDialogOpen(true);
  };

  const openEditCard = (card: KanbanCard) => {
    setEditingCard(card);
    setDialogColumnId(card.columnId);
    setDialogOpen(true);
  };

  // Auto-create default columns on first load
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (initialized || isLoading || error) return;
    if (board && board.columns.length === 1 && board.columns[0]._virtual) {
      // Only virtual Waiting column exists, create defaults
      const defaults = ["Backlog", "To Do", "In Progress", "Review", "Done"];
      Promise.all(defaults.map((t) => createColumn(t))).then(() => {
        setInitialized(true);
        invalidate();
      });
    } else {
      setInitialized(true);
    }
  }, [board, isLoading, error, initialized, invalidate]);

  const waitingCardIds = board?.waitingCardIds ?? [];

  return (
    <Layout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Columns2 className="w-5 h-5 text-primary" />
              Kanban
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Drag & drop cards across columns · Waiting shows tasks due within 3 days
            </p>
          </div>
          <div className="flex items-center gap-2">
            {showColInput ? (
              <div className="flex items-center gap-2">
                <input
                  className="w-40 px-3 py-1.5 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="Column name"
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddColumn();
                    if (e.key === "Escape") setShowColInput(false);
                  }}
                  autoFocus
                />
                <button
                  onClick={handleAddColumn}
                  disabled={!newColumnName.trim()}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setShowColInput(false)}
                  className="px-3 py-1.5 bg-muted text-muted-foreground rounded-lg text-xs hover:bg-accent transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowColInput(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" /> Add Column
              </button>
            )}
          </div>
        </div>

        {/* Board */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-6">
          {isLoading ? (
            <div className="flex gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="w-72 h-96 bg-card border border-border rounded-xl animate-pulse shrink-0" />
              ))}
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">Failed to load board. Is the API running?</p>
            </div>
          ) : (
            <div className="flex gap-4 h-full items-start pb-4">
              {(board?.columns ?? []).map((col) => {
                const isWaiting = col._virtual === true;
                const displayCards = isWaiting
                  ? (board?.cards ?? []).filter((c) => waitingCardIds.includes(c.id))
                  : (board?.cards ?? []).filter((c) => c.columnId === col.id);

                return (
                  <Column
                    key={col.id}
                    col={col}
                    cards={displayCards}
                    agents={agentList}
                    isWaiting={isWaiting}
                    waitingCardIds={waitingCardIds}
                    onDrop={handleDrop}
                    onAddCard={openNewCard}
                    onEditCard={openEditCard}
                    onDeleteCard={handleDeleteCard}
                    onDeleteColumn={handleDeleteColumn}
                  />
                );
              })}
              {(!board || board.columns.length === 0) && (
                <div className="flex items-center justify-center w-full h-64">
                  <div className="text-center">
                    <Columns2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No columns yet.</p>
                    <button
                      onClick={() => setShowColInput(true)}
                      className="mt-2 text-primary text-sm hover:underline"
                    >
                      Create your first column
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Card Dialog */}
        <CardDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          agents={agentList}
          columnId={dialogColumnId}
          editCard={editingCard}
          onSave={handleSaveCard}
        />
      </div>
    </Layout>
  );
}
